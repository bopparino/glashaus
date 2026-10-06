import Foundation

final class APIClient: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    let base: URL
    private let token: String?
    private lazy var session: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 180
        config.timeoutIntervalForResource = 600
        config.httpShouldSetCookies = false
        config.urlCache = nil
        return URLSession(configuration: config, delegate: self, delegateQueue: nil)
    }()
    init(address: String, token: String? = nil) throws {
        self.base = try ConnectionAddress.parse(address)
        self.token = token
        super.init()
    }
    func close() { session.invalidateAndCancel() }
    // Never follow a redirect with a pairing code or authorization header.
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest,
                    completionHandler: @escaping @Sendable (URLRequest?) -> Void) {
        completionHandler(nil)
    }
    func request(path: String, method: String = "GET", body: Data? = nil) -> URLRequest {
        var request = URLRequest(url: base.appendingPathComponent("mobile").appendingPathComponent(path))
        request.httpMethod = method
        request.httpBody = body
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if body != nil { request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        return request
    }
    private func validate(_ response: URLResponse, data: Data) throws {
        guard let response = response as? HTTPURLResponse else {
            throw ClientError.message("The computer returned an unreadable response.")
        }
        guard (200..<300).contains(response.statusCode) else {
            struct Failure: Decodable { let error: String }
            let message = (try? JSONDecoder().decode(Failure.self, from: data).error)
                ?? "The computer could not finish this request (\(response.statusCode))."
            throw ClientError.rejected(response.statusCode, message)
        }
    }
    func data(_ path: String) async throws -> Data {
        let (data, response) = try await session.data(for: request(path: path))
        try validate(response, data: data)
        return data
    }
    func get<T: Decodable>(_ path: String) async throws -> T {
        try JSONDecoder().decode(T.self, from: await data(path))
    }
    func send<B: Encodable, T: Decodable>(_ path: String, method: String = "POST", body: B) async throws -> T {
        let (data, response) = try await session.data(for: request(path: path, method: method, body: JSONEncoder().encode(body)))
        try validate(response, data: data)
        return try JSONDecoder().decode(T.self, from: data)
    }
    func chat(_ message: PendingMessage, onEvent: @MainActor (ChatEvent) -> Void) async throws {
        struct Message: Encodable { var id, text: String }
        var request = request(path: "chat", method: "POST", body: try JSONEncoder().encode(Message(id: message.id, text: message.text)))
        request.setValue("application/x-ndjson", forHTTPHeaderField: "Accept")
        let (bytes, response) = try await session.bytes(for: request)
        guard let response = response as? HTTPURLResponse else { throw ClientError.message("The reply could not be read.") }
        if !(200..<300).contains(response.statusCode) {
            var data = Data()
            for try await byte in bytes { data.append(byte); if data.count >= 100_000 { break } }
            try validate(response, data: data)
        }
        guard response.mimeType == "application/x-ndjson" else { throw ClientError.message("This address does not serve the GlasHaus phone connection.") }
        var complete = false
        for try await line in bytes.lines {
            try Task.checkCancellation()
            if line.isEmpty { continue }
            guard line.utf8.count < 1_000_000 else { throw ClientError.message("The reply is too large to read.") }
            let event = try JSONDecoder().decode(ChatEvent.self, from: Data(line.utf8))
            if event.type == "error" { throw ClientError.message(event.text ?? "The reply stopped. You can retry it.") }
            if event.type == "done" {
                guard let turn = event.turn, turn.id == message.serverID, turn.status == "complete" else {
                    throw ClientError.message("The reply could not be matched to your message. Refresh before retrying.")
                }
                complete = true
            }
            await onEvent(event)
        }
        if !complete { throw ClientError.message("The connection ended before the reply finished. Retry to pick it up.") }
    }
}
