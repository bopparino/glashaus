import SwiftUI

@MainActor @Observable final class CompanionModel {
    var pairing = Credentials.load()
    var snapshot: Snapshot?
    var history: [Turn] = []
    var olderCursor: String?
    var connected = false
    var syncing = false
    var sending = false
    var working = false
    var reply = ""
    var replyStatus = ""
    var error: String?
    var pending: PendingMessage?
    var pairingLink = ""
    var showingPairing = false
    var composer = ""
    var selectedTab = 1
    var showingVoice = false
    private struct ChatViewState: Codable { let companionID: String; let hiddenThrough: Date; let preservedTurnID: String? }
    private var chatViewState: ChatViewState?
    private var client: PinnedSession?
    private var chatTask: Task<Void, Never>?
    private var connectionGeneration = UUID()
    init() {
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("-ui-test-reset") { Credentials.clear(); LocalFiles.clear(); pairing = nil }
        if let index = ProcessInfo.processInfo.arguments.firstIndex(of: "-pairing-link"), ProcessInfo.processInfo.arguments.count > index + 1 { pairingLink = ProcessInfo.processInfo.arguments[index + 1] }
        #endif
        if let pairing {
            client = PinnedSession(server: pairing.server, pin: pairing.pin, token: pairing.token)
            snapshot = LocalFiles.load("snapshot.json"); pending = LocalFiles.load("pending.json")
            history = snapshot?.turns ?? []; olderCursor = snapshot?.olderCursor
            chatViewState = LocalFiles.load("chat-view.json")
        }
    }
    var name: String { snapshot?.companion?.name ?? "Your companion" }
    var checkIns: [CheckIn] { snapshot?.checkIns ?? [] }
    var timeline: [ConversationEntry] {
        allTimeline.filter { entry in
            guard let state = chatViewState, state.companionID == snapshot?.companion?.id else { return true }
            return entry.id == pending?.id || entry.id == state.preservedTurnID || (parseDate(entry.createdAt).map { $0 > state.hiddenThrough } ?? true)
        }
    }
    private var allTimeline: [ConversationEntry] { (history.map { ConversationEntry(turn: $0, checkIn: nil) } + checkIns.filter { $0.status == "seen" }.map { ConversationEntry(turn: nil, checkIn: $0) }).sorted { $0.createdAt < $1.createdAt } }
    var hasHiddenChat: Bool { chatViewState != nil && chatViewState?.companionID == snapshot?.companion?.id }
    func clearChatView() {
        guard !sending, let companion = snapshot?.companion, let latest = allTimeline.compactMap({ parseDate($0.createdAt) }).max() else { return }
        let state = ChatViewState(companionID: companion.id, hiddenThrough: latest, preservedTurnID: pending?.id)
        do { try LocalFiles.save(state, "chat-view.json"); chatViewState = state; selectedTab = 0 }
        catch { self.error = "Couldn’t save your chat view on this iPhone. Try again after freeing some storage." }
    }
    func showHiddenChat() { LocalFiles.remove("chat-view.json"); chatViewState = nil }
    var canAct: Bool { connected && !working && snapshot?.companion != nil }
    func fetch<T: Decodable>(_ path: String, method: String = "GET", body: [String: Any]? = nil) async throws -> T {
        guard let client else { throw ClientError.message("Connect to your Mac first.") }
        return try await client.fetch(path, method: method, body: body)
    }
    func audio(body: [String: Any]) async throws -> Data {
        guard let client, connected else { throw ClientError.message("Reconnect to your Mac to use voice.") }
        return try await client.audio(body: body)
    }
    func updateAddress(_ address: String) async -> Bool {
        guard let old = pairing, !sending, !working else { error = "Stop the active reply before changing the Mac address."; return false }
        guard let parts = URLComponents(string: address.trimmingCharacters(in: .whitespacesAndNewlines)), parts.scheme == "https", let host = parts.host, Enrollment.localHost(host), parts.user == nil, parts.password == nil, parts.path.isEmpty, parts.query == nil, parts.fragment == nil else { error = "Enter the Mac’s HTTPS Wi-Fi or Tailscale address, including port 7784."; return false }
        working = true; defer { working = false }
        let nextClient = PinnedSession(server: parts.string!, pin: old.pin, token: old.token)
        do {
            let next: Snapshot = try await nextClient.fetch("/state")
            guard next.companion?.id == snapshot?.companion?.id else { throw ClientError.message("This address belongs to a different companion. Use a fresh pairing link.") }
            let nextPairing = Pairing(server: parts.string!, pin: old.pin, token: old.token, id: old.id)
            try Credentials.save(nextPairing); client?.close(); client = nextClient; pairing = nextPairing; connectionGeneration = UUID(); await refresh(); return true
        } catch { nextClient.close(); self.error = error.localizedDescription; return false }
    }
    func pair() async {
        guard !sending, pending == nil else { error = "Finish or set aside the pending reply before updating this connection."; return }
        working = true; defer { working = false }
        do {
            let enrollment = try Enrollment(link: pairingLink)
            let enrollmentClient = PinnedSession(server: enrollment.server, pin: enrollment.pin)
            defer { enrollmentClient.close() }
            struct Result: Decodable { let id: String; let token: String }
            let result: Result = try await enrollmentClient.fetch("/pair", method: "POST", body: ["code": enrollment.code, "name": UIDevice.current.name])
            let value = Pairing(server: enrollment.server, pin: enrollment.pin, token: result.token, id: result.id)
            let nextClient = PinnedSession(server: value.server, pin: value.pin, token: value.token)
            let next: Snapshot
            do { next = try await nextClient.fetch("/state"); try Credentials.save(value) }
            catch { nextClient.close(); throw error }
            pairing = value; pairingLink = ""; error = nil
            client?.close(); client = nextClient
            connectionGeneration = UUID()
            if snapshot?.companion?.id != next.companion?.id { LocalFiles.clear(); history = []; chatViewState = nil }
            let ids = Set(next.turns.map(\.id))
            history = history.filter { !ids.contains($0.id) } + next.turns
            snapshot = next; olderCursor = next.olderCursor; connected = true; showingPairing = false
            try? LocalFiles.save(next, "snapshot.json")
        } catch { self.error = error.localizedDescription }
    }
    func refresh() async {
        guard let client, !syncing else { return }
        syncing = true; let generation = connectionGeneration
        defer { syncing = false }
        do {
            let next: Snapshot = try await client.fetch("/state")
            guard generation == connectionGeneration else { return }
            // A reset must never splice a new companion into a previous history.
            let changedCompanion = snapshot != nil && snapshot?.companion?.id != next.companion?.id
            if changedCompanion { chatViewState = nil; LocalFiles.remove("chat-view.json"); history = []; pending = nil; LocalFiles.remove("pending.json"); olderCursor = nil }
            let nextIDs = Set(next.turns.map(\.id))
            let retained = history.filter { !nextIDs.contains($0.id) }
            history = retained + next.turns
            if retained.isEmpty { olderCursor = next.olderCursor }
            snapshot = next; connected = true
            if let pending, next.turns.contains(where: { $0.id == pending.id && $0.status == "complete" }) { self.pending = nil; LocalFiles.remove("pending.json") }
            try? LocalFiles.save(next, "snapshot.json")
        } catch {
            guard generation == connectionGeneration else { return }
            connected = false
            if case ClientError.revoked = error { forgetLocally(); self.error = error.localizedDescription }
        }
    }
    func older() async {
        guard let client, let cursor = olderCursor, !working else { return }
        working = true; defer { working = false }
        do {
            let page: History = try await client.fetch("/history?before=" + cursor)
            let ids = Set(history.map(\.id)); history = page.turns.filter { !ids.contains($0.id) } + history; olderCursor = page.olderCursor
        } catch { self.error = error.localizedDescription }
    }
    func send() {
        guard connected, !sending, pending == nil else { return }
        let text = composer.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, text.count <= 16_000 else { error = "Enter a message of up to 16,000 characters."; return }
        let value = PendingMessage(id: "ios:" + UUID().uuidString, text: text)
        do { try LocalFiles.save(value, "pending.json"); pending = value; composer = ""; retry() }
        catch { self.error = "Your message could not be saved on this iPhone. Free some storage, then try again." }
    }
    func retry(_ turn: Turn? = nil) {
        guard let client, connected, !sending else { return }
        if let turn {
            guard pending == nil || pending?.id == turn.id else { error = "Finish or set aside the pending message first."; return }
            let value = PendingMessage(id: turn.id, text: turn.userText)
            do { try LocalFiles.save(value, "pending.json"); pending = value } catch { self.error = error.localizedDescription; return }
        }
        guard let pending else { return }
        sending = true; reply = ""; replyStatus = "Thinking…"
        chatTask = Task {
            defer { sending = false; chatTask = nil }
            do {
                try await client.chat(pending) { event in
                    if event.type == "token" { self.reply += event.text ?? "" }
                    if event.type == "status" { self.replyStatus = event.text ?? "" }
                    if event.type == "done" { self.pending = nil; LocalFiles.remove("pending.json") }
                }
            } catch {
                if Task.isCancelled { self.replyStatus = "Reply stopped. You can retry." }
                else { self.error = error.localizedDescription }
            }
            await refresh()
        }
    }
    func stop() { chatTask?.cancel() }
    func setAside() { pending = nil; LocalFiles.remove("pending.json"); reply = "" }
    func mutate(_ path: String, method: String = "PATCH", body: [String: Any]? = nil) async -> Bool {
        guard let client, canAct else { return false }
        working = true; defer { working = false }
        do { let _: Empty = try await client.fetch(path, method: method, body: body); await refresh(); return true }
        catch { self.error = error.localizedDescription; await refresh(); return false }
    }
    func update(_ reminder: Reminder, action: String) async { _ = await mutate("/reminders/" + reminder.id, body: ["revision": reminder.revision, "action": action]) }
    func unpair() async {
        guard let client else { forgetLocally(); return }
        do { let _: Empty = try await client.fetch("/device", method: "DELETE"); forgetLocally() }
        catch { self.error = "The Mac could not revoke access. Reconnect and try again, or use Forget this Mac to remove this iPhone’s local copy." }
    }
    func forgetLocally() {
        connectionGeneration = UUID(); chatTask?.cancel(); client?.close(); client = nil
        Credentials.clear(); LocalFiles.clear(); chatViewState = nil; pairing = nil; snapshot = nil; history = []; pending = nil; connected = false; reply = ""; showingPairing = false
    }
    private struct Empty: Decodable {}
}
