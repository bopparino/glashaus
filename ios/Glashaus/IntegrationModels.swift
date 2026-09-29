import Foundation

enum JSONValue: Codable {
    case string(String), number(Double), bool(Bool), object([String: JSONValue]), array([JSONValue]), null
    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null }
        else if let v = try? c.decode(String.self) { self = .string(v) }
        else if let v = try? c.decode(Bool.self) { self = .bool(v) }
        else if let v = try? c.decode(Double.self) { self = .number(v) }
        else if let v = try? c.decode([String: JSONValue].self) { self = .object(v) }
        else { self = .array(try c.decode([JSONValue].self)) }
    }
    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self { case .string(let v): try c.encode(v); case .number(let v): try c.encode(v); case .bool(let v): try c.encode(v); case .object(let v): try c.encode(v); case .array(let v): try c.encode(v); case .null: try c.encodeNil() }
    }
    var string: String { if case .string(let v) = self { return v }; return "" }
    var pretty: String { guard let data = try? JSONEncoder().encode(self), let object = try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed]), let output = try? JSONSerialization.data(withJSONObject: object, options: [.prettyPrinted, .sortedKeys, .fragmentsAllowed]) else { return string }; return String(decoding: output, as: UTF8.self) }
}
struct Proposal: Codable, Identifiable {
    let id: String; let kind: String; let title: String; let payload: [String: JSONValue]; let status: String; let revision: Int; let createdAt: String; let result: String
}
struct VoiceStatus: Codable { let ready: Bool; let month: String; let used: Int; let limit: Int; let voiceId: String; let model: String }
struct IntegrationSettings: Decodable {
    struct Voice: Decodable { let voiceId: String; let model: String; let monthlyCharacters: Int; let hasKey: Bool }
    struct Mail: Decodable { let address: String; let enabled: Bool; let hasPassword: Bool }
    struct Calendar: Decodable { let ids: [String]; let enabled: Bool }
    struct Connector: Decodable, Identifiable { let id: String; let name: String; let url: String; let tools: [String]; let readTools: [String]; let hasToken: Bool }
    let voice: Voice; let mail: Mail; let calendar: Calendar; let connectors: [Connector]; let revision: Int
}
struct CloudVoice: Decodable, Identifiable { let id: String; let name: String; let description: String }
struct VoiceList: Decodable { let voices: [CloudVoice] }
struct NativeCalendar: Decodable, Identifiable { let id: String; let name: String; let source: String; let writable: Bool }
struct CalendarList: Decodable { let calendars: [NativeCalendar] }
struct CalendarEvent: Decodable, Identifiable {
    let id: String; let calendarId: String; let calendarName: String; let title: String; let start: String; let end: String; let location: String; let notes: String; let allDay: Bool; let modified: String; let recurring: Bool; let hasAttendees: Bool
}
struct EventList: Decodable { let events: [CalendarEvent] }
struct InboxMessage: Decodable, Identifiable { let id: String; let subject: String; let from: String; let date: String?; let unread: Bool }
struct InboxList: Decodable { let messages: [InboxMessage] }
struct EmailContent: Decodable { let subject: String; let from: String; let text: String; let date: String? }
struct MCPTool: Decodable, Identifiable { let name: String; let description: String; let inputSchema: JSONValue; let readOnlyHint: Bool; var id: String { name } }
struct MCPTools: Decodable { let tools: [MCPTool] }
