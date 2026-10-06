import Foundation

struct Companion: Codable, Identifiable {
    var id: String
    var name, pronouns, mode, work, summary, personality, voice, backstory, values: String
    var uncertainties: [String]
    var claims: [Claim]
    var sources: [Source]
    var userName, relationship, createdAt: String
    var revision: Int
    var continuity: Continuity?
}
struct Claim: Codable { var text: String; var sourceIds: [String]; var kind: String }
struct Source: Codable { var id, title, url, excerpt, fetchedAt: String }
struct Continuity: Codable {
    var userContext = ""
    var lexicon = ""
    var dialogue = ""
}
struct PhoneSettings: Codable, Equatable {
    var model, utilityModel: String
    var contextSize: Int
    var reflectionEnabled: Bool
}
struct Turn: Codable, Identifiable {
    var id, userText, reply, channel, status, error, createdAt: String
    var delivered: Int
}
struct Memory: Codable, Identifiable {
    var id, kind, subject, text, evidence, createdAt, updatedAt: String
    var turnId: String?
    var active: Int
}
struct Reflection: Codable, Identifiable {
    var id, content, createdAt: String
    var sourceTurnIds: [String]
}
struct Snapshot: Codable {
    var companion: Companion?
    var settings: PhoneSettings
    var turns: [Turn]
    var memories: [Memory]
    var reflections: [Reflection]
    var serverTime: String
}
struct ModelInfo: Codable, Identifiable {
    var name: String
    var id: String { name }
}
struct ChatEvent: Codable {
    var type: String
    var text: String?
    var turn: Turn?
}
struct PairReply: Codable { var id, token, companionId: String }
struct Credentials: Codable {
    var address, deviceID, token: String
}
struct PendingMessage: Codable {
    var id, text, deviceID: String
    var serverID: String { "mobile:\(deviceID):\(id)" }
}
struct EmptyBody: Codable {}
struct OKReply: Codable { var ok: Bool }

enum ClientError: LocalizedError {
    case message(String)
    case rejected(Int, String)
    var errorDescription: String? {
        switch self {
        case .message(let message), .rejected(_, let message): return message
        }
    }
}

enum ConnectionAddress {
    static func parse(_ input: String) throws -> URL {
        let value = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let parts = URLComponents(string: value), parts.scheme?.lowercased() == "https",
              let host = parts.host, !host.isEmpty, parts.user == nil, parts.password == nil,
              parts.query == nil, parts.fragment == nil,
              parts.path.isEmpty || parts.path == "/",
              parts.port == nil || (1...65535).contains(parts.port!),
              let url = parts.url else {
            throw ClientError.message("Enter your computer’s HTTPS address without a path, pairing code, or password.")
        }
        return url
    }
}
