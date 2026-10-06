import XCTest
@testable import GlasHausCore

final class ConnectionTests: XCTestCase {
    func testRejectsAddressesThatCouldExposeCredentials() {
        for address in ["http://host.test", "https://user:pass@host.test", "https://host.test/mobile", "https://host.test?token=x", "https://host.test/#code", "file:///private/key", "https://", "https://host.test:0"] {
            XCTAssertThrowsError(try ConnectionAddress.parse(address), address)
        }
    }
    func testRequestKeepsTokenInHeaderAndCodeInBody() throws {
        let client = try APIClient(address: " https://pc.example.ts.net/ ", token: "example-token")
        defer { client.close() }
        let request = client.request(path: "pair", method: "POST", body: Data("{\"code\":\"ABCDE-23456\"}".utf8))
        XCTAssertEqual(request.url?.absoluteString, "https://pc.example.ts.net/mobile/pair")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer example-token")
        XCTAssertFalse(request.url!.absoluteString.contains("example-token"))
        XCTAssertFalse(request.url!.absoluteString.contains("ABCDE"))
        XCTAssertEqual(request.httpMethod, "POST")
    }
    func testPendingRetryPreservesIdAcrossRestart() throws {
        let pending = PendingMessage(id: "abc-123", text: "Hello", deviceID: "phone-456")
        let restored = try JSONDecoder().decode(PendingMessage.self, from: JSONEncoder().encode(pending))
        XCTAssertEqual(restored.serverID, "mobile:phone-456:abc-123")
        XCTAssertEqual(restored.text, pending.text)
    }
    func testStreamEventMatchesHostContract() throws {
        let raw = #"{"type":"done","turn":{"id":"mobile:phone:message","userText":"Hello","reply":"I am here.","channel":"web","status":"complete","delivered":1,"error":"","createdAt":"2026-10-05T12:00:00.000Z"}}"#
        let event = try JSONDecoder().decode(ChatEvent.self, from: Data(raw.utf8))
        XCTAssertEqual(event.turn?.reply, "I am here.")
        XCTAssertEqual(event.turn?.status, "complete")
    }
}
