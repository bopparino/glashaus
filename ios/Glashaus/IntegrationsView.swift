import SwiftUI

struct ConnectionsView: View {
    @Bindable var model: CompanionModel
    @State private var settings: IntegrationSettings?
    var body: some View {
        List {
            Section {
                NavigationLink { MailSettingsView(model: model) } label: { Label("iCloud Mail", systemImage: "envelope") }
                NavigationLink { CalendarSettingsView(model: model) } label: { Label("Calendar", systemImage: "calendar") }
                NavigationLink { ConnectorSettingsView(model: model) } label: { Label("Tool servers", systemImage: "point.3.connected.trianglepath.dotted") }
            } footer: { Text("You choose what \(model.name) can read. Emails and calendar changes are prepared for your review in Home.") }
            Section { NavigationLink { ProposalHistoryView(model: model) } label: { Label("Reviewed actions", systemImage: "checklist") } }
        }.pastoralBackground(reading: true).navigationTitle("Connections").navigationBarTitleDisplayMode(.inline)
    }
}
struct MailSettingsView: View {
    @Bindable var model: CompanionModel
    @State private var settings: IntegrationSettings?
    @State private var address = ""
    @State private var password = ""
    @State private var enabled = false
    @State private var busy = false
    @State private var message = ""
    var body: some View {
        Form {
            Section("iCloud account") {
                TextField("Email address", text: $address, prompt: Text("Email address").foregroundColor(FieldStyle.secondaryInk)).textContentType(.emailAddress).keyboardType(.emailAddress).textInputAutocapitalization(.never).autocorrectionDisabled()
                SecureField("App-specific password", text: $password, prompt: Text(settings?.mail.hasPassword == true ? "Password saved · enter to replace" : "App-specific password").foregroundColor(FieldStyle.secondaryInk)).textContentType(.password)
                Toggle("Allow inbox access", isOn: $enabled)
            }
            Section {
                Button(busy ? "Saving…" : "Save connection") { Task { await save() } }.disabled(busy || settings == nil || address.isEmpty)
                Button("Test inbox") { Task { busy = true; defer { busy = false }; do { let result: InboxList = try await model.fetch("/mail/inbox"); message = "Connected. \(result.messages.count) recent messages available." } catch { message = error.localizedDescription } } }.disabled(busy || settings?.mail.enabled != true)
                if !message.isEmpty { Text(message).font(.subheadline).textSelection(.enabled) }
            }
            Section {
                Link("Create an app-specific password", destination: URL(string: "https://account.apple.com")!)
                Text("Use an Apple app-specific password, never your Apple Account password. The credential stays in this Mac’s private Glashaus data. Inbox reads do not mark messages read; sends always require review.").font(.footnote)
                Text("Mail you ask \(model.name) to read is sent to your configured conversation model. Disconnecting stops access; previous conversation receipts remain in your history.").font(.footnote)
            }
        }.pastoralBackground(reading: true).navigationTitle("iCloud Mail").navigationBarTitleDisplayMode(.inline)
            .task { do { let s: IntegrationSettings = try await model.fetch("/integrations"); settings = s; address = s.mail.address; enabled = s.mail.enabled } catch { message = error.localizedDescription } }
    }
    private func save() async {
        guard let settings else { return }; busy = true; defer { busy = false }
        var mail: [String: Any] = ["address": address, "enabled": enabled]; if !password.isEmpty { mail["password"] = password }
        do { self.settings = try await model.fetch("/integrations", method: "PATCH", body: ["revision": settings.revision, "mail": mail]); password = ""; message = "Connection saved."; await model.refresh() } catch { message = error.localizedDescription }
    }
}
struct CalendarSettingsView: View {
    @Bindable var model: CompanionModel
    @State private var settings: IntegrationSettings?
    @State private var calendars: [NativeCalendar] = []
    @State private var selected = Set<String>()
    @State private var enabled = false
    @State private var busy = false
    @State private var message = ""
    var body: some View {
        Form {
            Section {
                Button(busy ? "Waiting for Mac…" : "Connect Calendar") { Task { await load(authorize: true) } }.disabled(busy)
                Text("Allow Glashaus Calendar in the permission dialog on your Mac. Its Calendar app must already have your iCloud account enabled.").font(.footnote)
                Button("Open Calendar permissions on Mac") { Task {
                    busy = true; defer { busy = false }
                    struct Result: Decodable { let opened: Bool }
                    do { let result: Result = try await model.fetch("/calendar/settings", method: "POST", body: [:]); message = result.opened ? "On your Mac, enable Glashaus Calendar under Privacy & Security → Calendars, then tap Connect Calendar again." : "Open Mac System Settings → Privacy & Security → Calendars and enable Glashaus Calendar." } catch { message = error.localizedDescription }
                } }.disabled(busy)
                if !message.isEmpty { Text(message).font(.subheadline) }
            }
            Section("Calendars \(model.name) may access") {
                ForEach(calendars) { calendar in
                    Toggle(isOn: Binding(get: { selected.contains(calendar.id) }, set: { if $0 { selected.insert(calendar.id) } else { selected.remove(calendar.id) } })) {
                        VStack(alignment: .leading) { Text(calendar.name); Text("\(calendar.source)\(calendar.writable ? "" : " · read only")").font(.caption).foregroundStyle(FieldStyle.secondaryInk) }
                    }
                }
                Toggle("Allow calendar access", isOn: $enabled)
            }
            Section {
                Button("Save calendars") { Task { guard let settings else { return }; busy = true; defer { busy = false }; do { self.settings = try await model.fetch("/integrations", method: "PATCH", body: ["revision": settings.revision, "calendar": ["ids": Array(selected), "enabled": enabled]]); message = "Calendar choices saved."; await model.refresh() } catch { message = error.localizedDescription } } }.disabled(busy || settings == nil || (enabled && selected.isEmpty))
            } footer: { Text("\(model.name) reads the next two weeks when asked. New events, edits, and deletions need your review. Manage invitations and repeating calendar events in Apple Calendar.") }
        }.pastoralBackground(reading: true).navigationTitle("Calendar access").navigationBarTitleDisplayMode(.inline)
            .task { await load(authorize: false) }
    }
    private func load(authorize: Bool) async {
        busy = true; defer { busy = false }
        do { let s: IntegrationSettings = try await model.fetch("/integrations"); settings = s; selected = Set(s.calendar.ids); enabled = s.calendar.enabled
            let result: CalendarList = try await model.fetch(authorize ? "/calendar/authorize" : "/calendar/calendars", method: authorize ? "POST" : "GET", body: authorize ? [:] : nil); calendars = result.calendars; message = ""
        } catch { message = error.localizedDescription }
    }
}
struct InboxView: View {
    @Bindable var model: CompanionModel
    @State private var messages: [InboxMessage] = []
    @State private var busy = false
    @State private var error = ""
    var body: some View {
        List {
            if busy { ProgressView("Reading inbox…") }
            if !error.isEmpty { Section { Text(error); NavigationLink("Mail settings") { MailSettingsView(model: model) }; Button("Retry") { Task { await load() } } } }
            ForEach(messages) { item in NavigationLink { EmailView(item: item, model: model) } label: {
                VStack(alignment: .leading, spacing: 6) { Text(item.subject).fontWeight(item.unread ? .semibold : .regular); Text(item.from).font(.caption).foregroundStyle(FieldStyle.secondaryInk); if let date = item.date.flatMap(parseDate) { Text(date.formatted(date: .abbreviated, time: .shortened)).font(.caption) } }.padding(.vertical, 4)
            } }
            if !busy && error.isEmpty && messages.isEmpty { ContentUnavailableView("Inbox is clear", systemImage: "tray") }
        }.pastoralBackground(reading: true).navigationTitle("Inbox").navigationBarTitleDisplayMode(.inline).task { await load() }.refreshable { await load() }
    }
    private func load() async { busy = true; defer { busy = false }; do { let result: InboxList = try await model.fetch("/mail/inbox"); messages = result.messages; error = "" } catch { self.error = error.localizedDescription } }
}
struct EmailView: View {
    let item: InboxMessage
    @Bindable var model: CompanionModel
    @State private var content: EmailContent?
    @State private var error = ""
    var body: some View {
        ScrollView { VStack(alignment: .leading, spacing: 20) {
            Text(item.subject).font(.title2.weight(.semibold)); Text(item.from).font(.subheadline).foregroundStyle(FieldStyle.secondaryInk)
            if let content { Text(content.text).textSelection(.enabled) } else if error.isEmpty { ProgressView("Reading message…") }
            if !error.isEmpty { Text(error) }
            Button("Discuss with \(model.name)") { model.composer = "Read inbox message \(item.id) and help me understand it."; model.selectedTab = 0 }.frame(minHeight: 44)
        }.padding(20).frame(maxWidth: .infinity, alignment: .leading) }.pastoralBackground(reading: true).navigationTitle("Message").navigationBarTitleDisplayMode(.inline)
            .task { do { content = try await model.fetch("/mail/messages/" + item.id) } catch { self.error = error.localizedDescription } }
    }
}
struct CalendarAgendaView: View {
    @Bindable var model: CompanionModel
    @State private var events: [CalendarEvent] = []
    @State private var busy = false
    @State private var error = ""
    var body: some View {
        List {
            if busy { ProgressView("Reading calendar…") }
            if !error.isEmpty { Section { Text(error); NavigationLink("Calendar settings") { CalendarSettingsView(model: model) }; Button("Retry") { Task { await load() } } } }
            ForEach(events) { event in
                VStack(alignment: .leading, spacing: 8) { Text(event.title).font(.headline); if let start = parseDate(event.start) { Text(event.allDay ? start.formatted(date: .abbreviated, time: .omitted) + " · All day" : start.formatted(date: .abbreviated, time: .shortened)) }; Text(event.calendarName).font(.caption).foregroundStyle(FieldStyle.secondaryInk); if !event.location.isEmpty { Text(event.location).font(.subheadline) } }.padding(.vertical, 6)
            }
            if !busy && error.isEmpty && events.isEmpty { ContentUnavailableView("Room in your calendar", systemImage: "calendar", description: Text("No events in your selected calendars for the next two weeks.")) }
        }.pastoralBackground(reading: true).navigationTitle("Calendar").navigationBarTitleDisplayMode(.inline).task { await load() }.refreshable { await load() }
    }
    private func load() async { busy = true; defer { busy = false }; do { let result: EventList = try await model.fetch("/calendar/events"); events = result.events; error = "" } catch { self.error = error.localizedDescription } }
}
struct ProposalView: View {
    let proposal: Proposal
    @Bindable var model: CompanionModel
    @Environment(\.dismiss) private var dismiss
    @State private var confirming = false
    var current: Proposal { model.snapshot?.proposals?.first { $0.id == proposal.id } ?? proposal }
    private let detailKeys = ["calendarId", "eventId", "expectedModified", "connectorId", "checkedAt"]
    private var visibleKeys: [String] {
        let order = ["from", "to", "subject", "body", "operation", "calendarName", "calendarSource", "title", "start", "end", "location", "notes", "currentEvent", "conflicts", "name", "arguments"]
        return current.payload.keys.filter { !detailKeys.contains($0) }.sorted { (order.firstIndex(of: $0) ?? 99) < (order.firstIndex(of: $1) ?? 99) }
    }
    var body: some View {
        List {
            Section { Text(verbatim: current.title).typesettingLanguage(.init(languageCode: .unavailable)).font(.title2); Text(current.status == "draft" ? "Nothing has been sent or changed." : current.status.capitalized).font(.subheadline) }
            Section("Exact proposal") {
                ForEach(visibleKeys, id: \.self) { key in
                    if let value = current.payload[key], value.pretty != "\"\"" {
                        VStack(alignment: .leading, spacing: 6) { Text(label(key)).font(.caption).foregroundStyle(FieldStyle.secondaryInk); if current.kind == "email" && ["from", "to"].contains(key) {
                            Text(verbatim: reviewText(key, value)).typesettingLanguage(.init(languageCode: .unavailable)).textSelection(.enabled)
                        } else { Text(reviewText(key, value)).textSelection(.enabled) } }.padding(.vertical, 4)
                    }
                }
            }
            Section { DisclosureGroup("Record details") { ForEach(detailKeys.filter { current.payload[$0]?.string.isEmpty == false }, id: \.self) { key in Text(label(key) + ": " + (current.payload[key]?.string ?? "")).font(.caption).textSelection(.enabled) } } }
            if current.status == "draft" {
                Section { Button(current.kind == "email" ? "Send this email" : "Confirm this action") { confirming = true }.disabled(!model.canAct); Button("Cancel proposal", role: .destructive) { Task { _ = await model.mutate("/proposals/" + current.id, body: ["revision": current.revision, "action": "cancel"]) } }.disabled(!model.canAct) }
            }
            if !current.result.isEmpty { Section("Outcome") { Text(outcome).font(.subheadline).textSelection(.enabled) } }
        }.pastoralBackground(reading: true).navigationTitle("Review").navigationBarTitleDisplayMode(.inline)
            .confirmationDialog(current.kind == "email" ? "Send this exact email?" : "Apply this exact change?", isPresented: $confirming, titleVisibility: .visible) {
                Button(current.kind == "email" ? "Send email" : "Confirm") { Task { _ = await model.mutate("/proposals/" + current.id, body: ["revision": current.revision, "action": "confirm"]) } }
            } message: { Text("This acts on your connected account. Check the destination and details above before confirming.") }
    }
    private var outcome: String {
        guard current.status == "complete", let data = current.result.data(using: .utf8), let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return current.result }
        if let message = object["message"] as? String { return message }
        return current.kind == "email" ? "Accepted by the mail server. Delivery to the recipient is handled by their mail service." : current.kind == "calendar" ? "Saved to Calendar. iCloud sync is handled by macOS." : "The tool returned a result.\n" + current.result
    }
    private func reviewText(_ key: String, _ value: JSONValue) -> String {
        func event(_ fields: [String: JSONValue]) -> String {
            [fields["title"]?.string ?? "Event", display("start", fields["start"]?.string ?? ""), fields["calendarName"]?.string ?? ""].filter { !$0.isEmpty }.joined(separator: "\n")
        }
        if key == "currentEvent", case .object(let fields) = value { return event(fields) }
        if key == "conflicts", case .array(let events) = value { return events.isEmpty ? "No overlapping events when checked." : events.map { if case .object(let fields) = $0 { return event(fields) }; return $0.pretty }.joined(separator: "\n\n") }
        return value.string.isEmpty ? value.pretty : display(key, value.string)
    }
    private func label(_ key: String) -> String { ["from": "From", "to": "To", "body": "Message", "subject": "Subject", "calendarId": "Calendar ID", "calendarName": "Calendar", "calendarSource": "Account", "currentEvent": "Current event", "conflicts": "Calendar conflicts", "checkedAt": "Calendar checked", "eventId": "Event ID", "expectedModified": "Last modified", "start": "Starts", "end": "Ends", "operation": "Change", "connectorId": "Tool server", "name": "Tool" ][key] ?? key.capitalized }
    private func display(_ key: String, _ value: String) -> String { if ["start", "end"].contains(key), let date = parseDate(value) { return date.formatted(date: .complete, time: .shortened) + "\n" + TimeZone.current.identifier }; return value }
}
struct ProposalHistoryView: View {
    @Bindable var model: CompanionModel
    var body: some View {
        List {
            ForEach(model.snapshot?.proposals ?? []) { proposal in NavigationLink { ProposalView(proposal: proposal, model: model) } label: { VStack(alignment: .leading, spacing: 6) { Text(proposal.title); Text(proposal.status.capitalized).font(.caption).foregroundStyle(FieldStyle.secondaryInk) } } }
            if model.snapshot?.proposals?.isEmpty != false { ContentUnavailableView("No proposals yet", systemImage: "checklist", description: Text("Ask \(model.name) to draft an email, calendar change, or connected action.")) }
        }.pastoralBackground(reading: true).navigationTitle("Reviewed actions").navigationBarTitleDisplayMode(.inline)
    }
}
