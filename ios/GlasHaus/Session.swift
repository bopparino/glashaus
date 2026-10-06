import SwiftUI

@MainActor final class Session: ObservableObject {
    @Published private(set) var credentials: Credentials?
    @Published private(set) var snapshot: Snapshot?
    @Published private(set) var online = false
    @Published private(set) var refreshing = false
    @Published private(set) var sending = false
    @Published private(set) var pending: PendingMessage?
    @Published var reply = ""
    @Published var status = ""
    @Published var error: String?
    @Published var draft = ""
    private(set) var client: APIClient?
    private var chatTask: Task<Void, Never>?

    init() { restoreConnection() }
    func restoreConnection() {
        do {
            credentials = try SecureStorage.read("connection", as: Credentials.self)
            if let credentials {
                client = try APIClient(address: credentials.address, token: credentials.token)
                let saved = try SecureStorage.read("pending", as: PendingMessage.self)
                pending = saved?.deviceID == credentials.deviceID ? saved : nil
            }
        } catch { self.error = error.localizedDescription }
    }
    func pair(address: String, code: String) async throws {
        struct PairBody: Encodable { var name, code: String }
        let pairing = try APIClient(address: address)
        defer { pairing.close() }
        let result: PairReply = try await pairing.send("pair", body: PairBody(name: UIDevice.current.name, code: code))
        let saved = Credentials(address: pairing.base.absoluteString, deviceID: result.id, token: result.token)
        try SecureStorage.save(saved, key: "connection")
        client?.close()
        client = try APIClient(address: saved.address, token: saved.token)
        credentials = saved
        pending = nil; snapshot = nil; error = nil
        await refresh()
    }
    func refresh() async {
        guard let client, !refreshing, !sending else { return }
        refreshing = true
        defer { refreshing = false }
        do {
            let value: Snapshot = try await client.get("state")
            guard self.client === client else { return }
            snapshot = value; online = true; error = nil
            if let pending, value.turns.contains(where: { $0.id == pending.serverID && $0.status == "complete" }) {
                try SecureStorage.delete("pending")
                self.pending = nil; reply = ""
            }
        } catch {
            guard self.client === client else { return }
            online = false; self.error = error.localizedDescription
        }
    }
    func send() {
        guard !sending, pending == nil, let credentials else { return }
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, text.utf16.count <= 16_000 else { return }
        let next = PendingMessage(id: UUID().uuidString, text: text, deviceID: credentials.deviceID)
        do { try SecureStorage.save(next, key: "pending") }
        catch { self.error = error.localizedDescription; return }
        pending = next; draft = ""
        retry()
    }
    func retry() {
        guard !sending, let pending, let client else { return }
        sending = true; reply = ""; error = nil; status = "Connecting…"
        chatTask = Task {
            defer { sending = false; status = ""; chatTask = nil }
            do {
                try await client.chat(pending) { [weak self] event in
                    guard let self else { return }
                    if event.type == "status" { status = event.text ?? "" }
                    if event.type == "token" { reply += event.text ?? "" }
                    if event.type == "done", let turn = event.turn {
                        snapshot?.turns.removeAll { $0.id == turn.id }
                        snapshot?.turns.append(turn)
                    }
                }
                try SecureStorage.delete("pending")
                self.pending = nil; reply = ""; online = true
            } catch {
                self.error = Task.isCancelled ? "Reply stopped. Retry to continue this message." : error.localizedDescription
            }
        }
    }
    func stop() { chatTask?.cancel() }
    func discardPending() throws {
        guard !sending else { return }
        try SecureStorage.delete("pending")
        pending = nil; reply = ""; error = nil
    }
    func saveIdentity(_ value: Companion) async throws {
        guard let client else { return }
        let saved: Companion = try await client.send("identity", body: value)
        snapshot?.companion = saved
    }
    func saveSettings(_ value: PhoneSettings) async throws {
        guard let client else { return }
        let saved: PhoneSettings = try await client.send("settings", body: value)
        snapshot?.settings = saved
    }
    func disconnect(revoke: Bool) async throws {
        if revoke, let client {
            let _: OKReply = try await client.send("disconnect", body: EmptyBody())
        }
        chatTask?.cancel()
        client?.close()
        try SecureStorage.delete("pending")
        try SecureStorage.delete("connection")
        credentials = nil; client = nil; snapshot = nil; pending = nil
        reply = ""; draft = ""; online = false; error = nil
    }
}
