// Compile with ios/Glashaus/{Models,Connection}.swift. Input is a JSON object
// containing only a server URL and public certificate pin. No device token is
// used: HTTP 401 proves TLS completed, and no companion data is requested.
import Foundation

@main struct TransportProbe {
    struct Input: Decodable { let server: String; let pin: String }
    struct Empty: Decodable {}
    static func attempt(_ client: PinnedSession, stream: Bool) async -> String {
        do {
            if stream {
                try await client.chat(PendingMessage(id: "transport-probe", text: "transport-probe")) { _ in }
            } else {
                let _: Empty = try await client.fetch("/state")
            }
            return "unexpected success without a device credential"
        } catch ClientError.revoked { return "authenticated TLS; HTTP 401" }
        catch { let e = error as NSError; return "\(e.domain):\(e.code)" }
    }
    static func main() async throws {
        let input = try JSONDecoder().decode(Input.self, from: FileHandle.standardInput.readDataToEndOfFile())
        var failures: [String] = []
        var checked = 0
        for _ in 0..<12 {
            let client = PinnedSession(server: input.server, pin: input.pin)
            for stream in [false, true, false, true] {
                let result = await attempt(client, stream: stream)
                checked += 1
                if result != "authenticated TLS; HTTP 401" { failures.append(result) }
            }
            client.close()
        }
        let wrong = PinnedSession(server: input.server, pin: String(repeating: "0", count: 64))
        let rejected = await attempt(wrong, stream: false)
        wrong.close()
        let mismatchRejected = rejected != "authenticated TLS; HTTP 401" && rejected != "unexpected success without a device credential"
        print("Valid-pin requests: \(checked); failures: \(failures.count); wrong pin rejected: \(mismatchRejected)")
        if !failures.isEmpty { print("Failure codes: \(Array(Set(failures)).sorted())") }
        if !failures.isEmpty || !mismatchRejected { exit(1) }
    }
}
