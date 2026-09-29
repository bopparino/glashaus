import Foundation
import EventKit
import AppKit

// Small native bridge: JSON on stdin/stdout; no shell or mail
// access. Calendar access is granted in the Mac's standard permission dialog.
@main struct GlashausCalendar {
    static func main() async {
        do {
            let data = FileHandle.standardInput.readDataToEndOfFile()
            guard let input = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw Failure("Invalid request.") }
            let command = input["command"] as? String ?? ""
            let deadline = input["deadline"] as? Double ?? 0
            let arguments = CommandLine.arguments
            guard let index = arguments.firstIndex(of: "--request-file"), arguments.count > index + 1 else { throw Failure("Launch Calendar through Glashaus Settings.") }
            let requestFile = arguments[index + 1]
            func checkRequest() throws {
                guard deadline > Date().timeIntervalSince1970 * 1000, FileManager.default.fileExists(atPath: requestFile) else { throw Failure("This Calendar request expired. Try again from Glashaus.") }
            }
            try checkRequest()
            // open -W may be cancelled while macOS is showing permission. Bound
            // the independently launched app as well as the server request.
            DispatchQueue.global().asyncAfter(deadline: .now() + min(command == "authorize" ? 120 : 20, (deadline / 1000) - Date().timeIntervalSince1970)) { exit(0) }
            if command == "settings" {
                let opened = NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Calendars")!)
                try output(["opened": opened]); return
            }
            let status = EKEventStore.authorizationStatus(for: .event)
            if command == "status" { try output(["authorization": status.rawValue]); return }
            if status == .restricted { throw Failure("Calendar access is restricted on this Mac. Check its Screen Time or management settings.") }
            if status == .denied { throw Failure("Calendar access is off on your Mac. Open Calendar permissions on Mac and enable Glashaus Calendar, then tap Connect Calendar again. macOS does not repeat a declined prompt.") }
            let store = EKEventStore()
            if command == "authorize" && status != .fullAccess {
                guard try await store.requestFullAccessToEvents() else { throw Failure("Calendar access was declined. Enable Glashaus Calendar in Mac System Settings → Privacy & Security → Calendars.") }
            }
            guard EKEventStore.authorizationStatus(for: .event) == .fullAccess else { throw Failure("Calendar access is not enabled. Tap Connect Calendar and allow access on your Mac.") }
            func string(_ key: String) -> String { input[key] as? String ?? "" }
            func date(_ key: String) throws -> Date {
                let formatter = ISO8601DateFormatter(); formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
                guard let date = formatter.date(from: string(key)) ?? ISO8601DateFormatter().date(from: string(key)) else { throw Failure("Invalid event time.") }; return date
            }
            func stamp(_ date: Date?) -> String { let formatter = ISO8601DateFormatter(); formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]; return date.map { formatter.string(from: $0) } ?? "" }
            func eventInfo(_ event: EKEvent) -> [String: Any] {
                ["id": event.eventIdentifier ?? "", "calendarId": event.calendar.calendarIdentifier, "calendarName": event.calendar.title,
                 "title": event.title ?? "Untitled", "start": stamp(event.startDate), "end": stamp(event.endDate),
                 "location": event.location ?? "", "notes": String((event.notes ?? "").prefix(5000)), "allDay": event.isAllDay,
                 "modified": stamp(event.lastModifiedDate), "recurring": event.hasRecurrenceRules, "hasAttendees": event.hasAttendees]
            }
            var result: [String: Any]
            switch string("command") {
            case "authorize", "calendars":
                result = ["calendars": store.calendars(for: .event).map { ["id": $0.calendarIdentifier, "name": $0.title, "source": $0.source.title, "writable": $0.allowsContentModifications] as [String: Any] }]
            case "events":
                let ids = input["calendarIds"] as? [String] ?? []
                let calendars = store.calendars(for: .event).filter { ids.contains($0.calendarIdentifier) }
                guard !calendars.isEmpty else { throw Failure("Selected calendars are no longer available. Select them again in Settings.") }
                let start = try date("start"), end = try date("end")
                result = ["events": store.events(matching: store.predicateForEvents(withStart: start, end: end, calendars: calendars)).sorted { $0.startDate < $1.startDate }.prefix(100).map(eventInfo), "calendars": calendars.map { ["id": $0.calendarIdentifier, "name": $0.title, "source": $0.source.title, "writable": $0.allowsContentModifications] as [String: Any] }, "checkedAt": stamp(Date())]
            case "preview":
                guard let calendar = store.calendar(withIdentifier: string("calendarId")), calendar.allowsContentModifications else { throw Failure("This calendar is unavailable or read-only.") }
                let start = try date("start"), end = try date("end")
                let ids = input["calendarIds"] as? [String] ?? []
                let calendars = store.calendars(for: .event).filter { ids.contains($0.calendarIdentifier) }
                let conflicts = store.events(matching: store.predicateForEvents(withStart: start, end: end, calendars: calendars)).filter { $0.eventIdentifier != string("eventId") }
                result = ["calendarName": calendar.title, "calendarSource": calendar.source.title, "conflicts": conflicts.prefix(20).map(eventInfo), "checkedAt": stamp(Date())]
                if string("operation") != "create" {
                    guard let existing = store.event(withIdentifier: string("eventId")), existing.calendar.calendarIdentifier == calendar.calendarIdentifier else { throw Failure("The original event no longer exists in this calendar.") }
                    guard stamp(existing.lastModifiedDate) == string("expectedModified") else { throw Failure("This event changed. Read Calendar again before preparing a proposal.") }
                    guard !existing.hasRecurrenceRules, !existing.hasAttendees, !existing.isAllDay, (existing.notes ?? "").count <= 5000 else { throw Failure("Edit all-day events, repeating events, invitations, and events with long notes in Apple Calendar.") }
                    result["currentEvent"] = eventInfo(existing)
                }
            case "write":
                try checkRequest()
                guard let calendar = store.calendar(withIdentifier: string("calendarId")), calendar.allowsContentModifications else { throw Failure("This calendar is unavailable or read-only.") }
                let operation = string("operation"), start = try date("start"), end = try date("end")
                guard end > start else { throw Failure("Choose an end time after the start.") }
                let event: EKEvent
                if operation == "create" {
                    let marker = "glashaus://action/" + string("actionId")
                    let existing = store.events(matching: store.predicateForEvents(withStart: start.addingTimeInterval(-1), end: end.addingTimeInterval(1), calendars: [calendar])).first { $0.url?.absoluteString == marker }
                    if let existing { result = ["event": eventInfo(existing), "message": "Event already saved."]; try output(result); return }
                    event = EKEvent(eventStore: store); event.calendar = calendar; event.url = URL(string: marker)
                } else {
                    guard let existing = store.event(withIdentifier: string("eventId")), existing.calendar.calendarIdentifier == calendar.calendarIdentifier else { throw Failure("The original event no longer exists in this calendar.") }
                    guard stamp(existing.lastModifiedDate) == string("expectedModified") else { throw Failure("This event changed since the draft. Refresh and review a new proposal.") }
                    guard !existing.hasRecurrenceRules, !existing.hasAttendees, !existing.isAllDay, (existing.notes ?? "").count <= 5000 else { throw Failure("Edit all-day events, repeating events, invitations, and events with long notes in Apple Calendar.") }
                    event = existing
                }
                if operation == "delete" { try store.remove(event, span: .thisEvent, commit: true); result = ["message": "Event removed from Calendar."] }
                else {
                    guard operation == "create" || operation == "update" else { throw Failure("Unknown calendar operation.") }
                    event.title = string("title"); event.startDate = start; event.endDate = end; event.location = string("location"); event.notes = string("notes")
                    try store.save(event, span: .thisEvent, commit: true)
                    result = ["event": eventInfo(event), "message": "Saved to Calendar. iCloud sync is handled by macOS."]
                }
            default: throw Failure("Unknown calendar request.")
            }
            try output(result)
        } catch { try? output(["error": error.localizedDescription]) }
    }
    static func output(_ value: [String: Any]) throws { FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject: value)) }
    struct Failure: LocalizedError { let message: String; init(_ message: String) { self.message = message }; var errorDescription: String? { message } }
}
