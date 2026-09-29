import Foundation
import Security
import CryptoKit

final class PinnedSession: NSObject, URLSessionDelegate, URLSessionTaskDelegate, @unchecked Sendable {
    let server: String
    let pin: String
    let token: String
    lazy var session: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 150; config.timeoutIntervalForResource = 180
        config.httpShouldSetCookies = false; config.urlCache = nil
        return URLSession(configuration: config, delegate: self, delegateQueue: nil)
    }()
    init(server: String, pin: String, token: String = "") { self.server = server; self.pin = pin; self.token = token }
    func close() { session.invalidateAndCancel() }
    func urlSession(_ session: URLSession, didReceive challenge: URLAuthenticationChallenge, completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        authenticate(challenge, completionHandler: completionHandler)
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, didReceive challenge: URLAuthenticationChallenge, completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        authenticate(challenge, completionHandler: completionHandler)
    }
    private func authenticate(_ challenge: URLAuthenticationChallenge, completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        guard challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
              challenge.protectionSpace.host == URL(string: server)?.host,
              let trust = challenge.protectionSpace.serverTrust,
              let cert = (SecTrustCopyCertificateChain(trust) as? [SecCertificate])?.first else { completionHandler(.cancelAuthenticationChallenge, nil); return }
        let data = SecCertificateCopyData(cert) as Data
        let actual = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
        guard actual == pin else { completionHandler(.cancelAuthenticationChallenge, nil); return }
        // A one-use link copied from the local Mac supplies the trust anchor.
        // Exact certificate pinning binds the server; Basic X.509 also checks
        // certificate validity. Never accept arbitrary self-signed certificates.
        SecTrustSetPolicies(trust, SecPolicyCreateBasicX509())
        SecTrustSetAnchorCertificates(trust, [cert] as CFArray)
        SecTrustSetAnchorCertificatesOnly(trust, true)
        SecTrustSetNetworkFetchAllowed(trust, false)
        guard SecTrustEvaluateWithError(trust, nil) else { completionHandler(.cancelAuthenticationChallenge, nil); return }
        completionHandler(.useCredential, URLCredential(trust: trust))
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
    func request(_ path: String, method: String = "GET", body: [String: Any]? = nil) throws -> URLRequest {
        guard let url = URL(string: server + "/v1" + path) else { throw ClientError.message("The Mac address is invalid. Pair again.") }
        var request = URLRequest(url: url); request.httpMethod = method
        request.timeoutInterval = path == "/chat" || path == "/calendar/authorize" ? 150 : path == "/state" ? 8 : 60
        if !token.isEmpty { request.setValue("Bearer " + token, forHTTPHeaderField: "Authorization") }
        if let body { request.setValue("application/json", forHTTPHeaderField: "Content-Type"); request.httpBody = try JSONSerialization.data(withJSONObject: body) }
        return request
    }
    func fetch<T: Decodable>(_ path: String, method: String = "GET", body: [String: Any]? = nil) async throws -> T {
        let (data, response) = try await session.data(for: request(path, method: method, body: body), delegate: self)
        try check(response, data: data)
        return try JSONDecoder().decode(T.self, from: data)
    }
    func audio(body: [String: Any]) async throws -> Data {
        let (data, response) = try await session.data(for: request("/voice/speak", method: "POST", body: body), delegate: self)
        try check(response, data: data)
        guard data.count <= 12_000_000 else { throw ClientError.message("This voice reply is too large.") }
        return data
    }
    func check(_ response: URLResponse, data: Data = Data()) throws {
        guard let response = response as? HTTPURLResponse else { throw ClientError.message("The Mac returned an unreadable response.") }
        if response.statusCode == 401 { throw ClientError.revoked }
        guard (200...299).contains(response.statusCode) else {
            let details = (try? JSONSerialization.jsonObject(with: data)) as? [String: String]
            throw ClientError.message(details?["error"] ?? "The Mac could not complete this request (\(response.statusCode)).")
        }
    }
    func chat(_ pending: PendingMessage, receive: @MainActor (StreamEvent) -> Void) async throws {
        let (bytes, response) = try await session.bytes(for: request("/chat", method: "POST", body: ["id": pending.id, "text": pending.text]), delegate: self)
        if (response as? HTTPURLResponse)?.statusCode != 200 {
            var data = Data(); for try await byte in bytes { if data.count < 24_000 { data.append(byte) } }
            try check(response, data: data)
        }
        var done = false
        for try await line in bytes.lines {
            try Task.checkCancellation()
            if line.isEmpty { continue }
            guard line.utf8.count < 250_000 else { throw ClientError.message("The reply exceeded this app’s message limit.") }
            let event = try JSONDecoder().decode(StreamEvent.self, from: Data(line.utf8))
            if event.type == "error" { throw ClientError.message(event.text ?? "The reply stopped. You can retry.") }
            if event.type == "done" { done = true }
            await receive(event)
        }
        if !done { throw ClientError.message("The connection ended before the reply finished. Reconnect, then retry this message.") }
    }
}

enum Credentials {
    static let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "net.glashaus.companion", kSecAttrAccount as String: "paired-mac"]
    static func load() -> Pairing? {
        var request = query; request[kSecReturnData as String] = true; request[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        guard SecItemCopyMatching(request as CFDictionary, &result) == errSecSuccess, let data = result as? Data else { return nil }
        return try? JSONDecoder().decode(Pairing.self, from: data)
    }
    static func save(_ value: Pairing) throws {
        let data = try JSONEncoder().encode(value)
        let attributes: [String: Any] = [kSecValueData as String: data, kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly]
        let update = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if update == errSecSuccess { return }
        guard update == errSecItemNotFound else { throw ClientError.message("The iPhone could not save its pairing securely.") }
        var request = query; attributes.forEach { request[$0.key] = $0.value }
        guard SecItemAdd(request as CFDictionary, nil) == errSecSuccess else { throw ClientError.message("The iPhone could not save its pairing securely.") }
    }
    static func clear() { SecItemDelete(query as CFDictionary) }
}

enum LocalFiles {
    static var folder: URL { FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("Glashaus", isDirectory: true) }
    static func load<T: Decodable>(_ name: String) -> T? { guard let data = try? Data(contentsOf: folder.appendingPathComponent(name)) else { return nil }; return try? JSONDecoder().decode(T.self, from: data) }
    static func save<T: Encodable>(_ value: T, _ name: String) throws {
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        var root = folder; var values = URLResourceValues(); values.isExcludedFromBackup = true; try root.setResourceValues(values)
        try JSONEncoder().encode(value).write(to: folder.appendingPathComponent(name), options: [.atomic, .completeFileProtection])
    }
    static func remove(_ name: String) { try? FileManager.default.removeItem(at: folder.appendingPathComponent(name)) }
    static func clear() { try? FileManager.default.removeItem(at: folder) }
}
