import Foundation

struct Companion: Codable {
    let id: String; let name: String; let userName: String
    let summary: String?; let personality: String?; let voice: String?; let backstory: String?; let values: String?; let relationship: String?
}
struct CheckIn: Codable, Identifiable {
    let id: String; let sourceTurnId: String; let content: String; let reason: String; let evidence: String
    let status: String; let createdAt: String; let expiresAt: String
}
struct CheckInPolicy: Codable {
    let enabled: Bool; let quietStart: Int; let quietEnd: Int; let maxPerDay: Int
    let timeZone: String; let conversationGapMinutes: Int; let checkInGapMinutes: Int; let delivery: String
}
struct ConversationEntry: Identifiable {
    let turn: Turn?; let checkIn: CheckIn?
    var id: String { turn?.id ?? checkIn!.id }
    var createdAt: String { turn?.createdAt ?? checkIn!.createdAt }
}
struct Source: Codable, Identifiable { let id: String; let title: String; let url: String }
struct Turn: Codable, Identifiable {
    let id: String; let userText: String; let reply: String; let status: String
    let error: String; let createdAt: String; let sources: [Source]?
}
struct Reminder: Codable, Identifiable {
    let id: String; let turnId: String?; let title: String; let dueAt: String; let timeZone: String
    let status: String; let revision: Int
    let recurrence: String?; let anchorAt: String?
    var repeatLabel: String { switch recurrence ?? "none" { case "daily": "Every day"; case "weekdays": "Every weekday"; case "weekly": "Every week"; case "monthly": "Every month"; default: "Does not repeat" } }
    var date: Date { parseDate(dueAt) ?? .distantPast }
    var zone: TimeZone { TimeZone(identifier: timeZone) ?? .gmt }
    var needsConfirmation: Bool { status == "draft" || status == "paused" }
    var closed: Bool { status == "completed" || status == "cancelled" }
    var statusLabel: String {
        switch status { case "draft": "Needs your confirmation"; case "paused": "Paused · review to schedule"; case "scheduled": "Scheduled"; case "due": "Due now"; case "completed": "Completed"; case "cancelled": "Cancelled"; default: status }
    }
    func formatted(_ format: String) -> String {
        let formatter = DateFormatter(); formatter.timeZone = zone; formatter.dateFormat = format
        return formatter.string(from: date)
    }
}
struct Memory: Codable, Identifiable { let id: String; let text: String; let subject: String; let kind: String; let evidence: String }
struct Reflection: Codable, Identifiable { let id: String; let content: String; let createdAt: String }
struct Snapshot: Codable {
    let companion: Companion?; var turns: [Turn]; let reminders: [Reminder]; let memories: [Memory]
    let reflections: [Reflection]; let timeZone: String; let serverTime: String; let olderCursor: String?
    let checkIns: [CheckIn]?; let checkInPolicy: CheckInPolicy?
    let proposals: [Proposal]?; let voice: VoiceStatus?
}
struct History: Decodable { let turns: [Turn]; let olderCursor: String? }
struct StreamEvent: Decodable { let type: String; let text: String?; let turn: Turn? }
struct PendingMessage: Codable { let id: String; let text: String }
struct Pairing: Codable {
    let server: String; let pin: String; let token: String; let id: String
}
struct Enrollment {
    let server: String; let pin: String; let code: String
    init(link: String) throws {
        guard let parts = URLComponents(string: link.trimmingCharacters(in: .whitespacesAndNewlines)), parts.scheme == "glashaus", parts.host == "pair" else { throw ClientError.message("Paste the pairing link created in Settings on your Mac.") }
        func item(_ name: String) -> String? { parts.queryItems?.first(where: { $0.name == name })?.value }
        guard let server = item("server"), let url = URLComponents(string: server), url.scheme == "https", let host = url.host, url.user == nil, url.password == nil, url.query == nil, url.fragment == nil, url.path.isEmpty,
              Self.localHost(host), let pin = item("pin"), pin.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil,
              let code = item("code"), code.range(of: "^[A-Za-z0-9_-]{43}$", options: .regularExpression) != nil else { throw ClientError.message("This pairing link is incomplete or does not point to a local Mac.") }
        self.server = server; self.pin = pin; self.code = code
    }
    static func localHost(_ host: String) -> Bool {
        let bytes = host.split(separator: ".").compactMap { Int($0) }
        guard bytes.count == 4, bytes.allSatisfy({ (0...255).contains($0) }) else { return false }
        return bytes[0] == 10 || bytes[0] == 127 || (bytes[0] == 192 && bytes[1] == 168) || (bytes[0] == 172 && (16...31).contains(bytes[1])) || (bytes[0] == 100 && (64...127).contains(bytes[1]))
    }
}
enum ClientError: LocalizedError {
    case message(String), revoked
    var errorDescription: String? {
        switch self { case .message(let text): text; case .revoked: "This iPhone’s access was revoked. Pair again from your Mac." }
    }
}
func parseDate(_ value: String) -> Date? {
    let formatter = ISO8601DateFormatter(); formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter.date(from: value) ?? ISO8601DateFormatter().date(from: value)
}
