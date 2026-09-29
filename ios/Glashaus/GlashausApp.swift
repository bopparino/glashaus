import SwiftUI

@main struct GlashausApp: App {
    @State private var model = CompanionModel()
    @Environment(\.scenePhase) private var scenePhase
    var body: some Scene {
        WindowGroup {
            RootView(model: model)
                .onOpenURL { url in model.pairingLink = url.absoluteString; if model.pairing != nil { model.showingPairing = true } }
                .task(id: scenePhase) {
                    guard scenePhase == .active else { return }
                    while !Task.isCancelled {
                        if !model.sending { await model.refresh() }
                        try? await Task.sleep(for: .seconds(5))
                    }
                }
        }
    }
}

enum FieldStyle {
    static let ink = Color(uiColor: UIColor { $0.userInterfaceStyle == .dark ? UIColor(red: 0.91, green: 0.90, blue: 0.86, alpha: 1) : UIColor(red: 0.10, green: 0.11, blue: 0.10, alpha: 1) })
    static let ground = Color(uiColor: UIColor { $0.userInterfaceStyle == .dark ? UIColor(red: 0.075, green: 0.08, blue: 0.075, alpha: 1) : UIColor(red: 0.94, green: 0.93, blue: 0.90, alpha: 1) })
    static let paper = Color(red: 0.90, green: 0.89, blue: 0.84)
    static let charcoal = Color(red: 0.10, green: 0.11, blue: 0.10)
    static let rust = Color(red: 0.57, green: 0.23, blue: 0.16)
    static let olive = Color(uiColor: UIColor { $0.userInterfaceStyle == .dark ? UIColor(red: 0.70, green: 0.75, blue: 0.57, alpha: 1) : UIColor(red: 0.31, green: 0.36, blue: 0.23, alpha: 1) })
    static let surface = Color(uiColor: UIColor { $0.userInterfaceStyle == .dark ? UIColor(red: 0.12, green: 0.13, blue: 0.115, alpha: 1) : UIColor(red: 0.975, green: 0.970, blue: 0.950, alpha: 1) })
    static let secondaryInk = Color(uiColor: UIColor { $0.userInterfaceStyle == .dark ? UIColor(red: 0.73, green: 0.73, blue: 0.69, alpha: 1) : UIColor(red: 0.34, green: 0.35, blue: 0.32, alpha: 1) })
}

struct RootView: View {
    @Bindable var model: CompanionModel
    private var attentionCount: Int {
        let reminders = model.snapshot?.reminders.filter { $0.needsConfirmation || $0.status == "due" }.count ?? 0
        let checkIns = model.checkIns.filter { $0.status == "available" }.count
        let proposals = model.snapshot?.proposals?.filter { $0.status == "draft" }.count ?? 0
        return reminders + checkIns + proposals
    }
    var body: some View {
        Group {
            if model.pairing == nil { PairingView(model: model) }
            else {
                TabView(selection: $model.selectedTab) {
                    ConversationView(model: model).tabItem { Label("Conversation", systemImage: "bubble.left") }.tag(0)
                    HomeView(model: model).tabItem { Label("Home", systemImage: "house") }.tag(1)
                        .badge(attentionCount)
                    SettingsView(model: model).tabItem { Label("Settings", systemImage: "gearshape") }.tag(2)
                }
            }
        }
        .tint(FieldStyle.ink)
        .foregroundStyle(FieldStyle.ink)
        .sheet(isPresented: $model.showingVoice) { VoiceView(model: model) }
        .sheet(isPresented: $model.showingPairing) {
            PairingView(model: model)
                .alert("Couldn’t complete that", isPresented: Binding(get: { model.error != nil }, set: { if !$0 { model.error = nil } })) { Button("OK") { model.error = nil } } message: { Text(model.error ?? "") }
        }
        .alert("Couldn’t complete that", isPresented: Binding(get: { model.error != nil && !model.showingPairing }, set: { if !$0 { model.error = nil } })) { Button("OK") { model.error = nil } } message: { Text(model.error ?? "") }
    }
}

struct PastoralBackground: View {
    var reading = false
    @AppStorage("backgroundPreset") private var preset = "PastoralBackdrop"
    @Environment(\.colorScheme) private var scheme
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @Environment(\.colorSchemeContrast) private var contrast
    var body: some View {
        GeometryReader { geometry in
            ZStack {
                FieldStyle.ground
                if preset != "plain" { Image(BackgroundPreset.asset(preset)).resizable().scaledToFill()
                    .frame(width: geometry.size.width, height: geometry.size.height).clipped()
                }
                FieldStyle.ground.opacity(wash)
            }
        }.ignoresSafeArea().allowsHitTesting(false).accessibilityHidden(true)
    }
    private var wash: Double {
        if reduceTransparency || contrast == .increased { return 0.97 }
        if reading { return scheme == .dark ? 0.86 : 0.90 }
        return scheme == .dark ? 0.58 : 0.78
    }
}

extension View {
    func pastoralBackground(reading: Bool = false) -> some View {
        scrollContentBackground(.hidden).background { PastoralBackground(reading: reading) }
    }
    func fieldSurface() -> some View {
        padding(20).frame(maxWidth: .infinity, alignment: .leading)
            .background(FieldStyle.surface, in: RoundedRectangle(cornerRadius: 12))
    }
}
struct ConnectionStatus: View {
    @Bindable var model: CompanionModel
    var body: some View {
        Button { Task { await model.refresh() } } label: {
            Label {
                Text(model.connected ? "Mac connected" : "Mac offline").foregroundStyle(FieldStyle.ink)
            } icon: {
                Image(systemName: model.connected ? "circle.fill" : "wifi.slash").foregroundStyle(model.connected ? FieldStyle.olive : FieldStyle.ink)
            }
                .font(.caption).labelStyle(.titleAndIcon)
                .frame(minHeight: 44)
        }.buttonStyle(.plain).accessibilityHint("Checks your connection to the Mac")
    }
}
struct OfflineNotice: View {
    @Bindable var model: CompanionModel
    var body: some View {
        if !model.connected {
            VStack(alignment: .leading, spacing: 4) {
                Text("Your Mac is out of reach.").font(.headline)
                Text("Showing the last saved copy. Keep Glashaus running and connect through the same Wi-Fi or Tailscale.").font(.subheadline)
                if let time = model.snapshot?.serverTime, let date = parseDate(time) { Text("Last synced \(date.formatted(date: .abbreviated, time: .shortened))").font(.caption) }
                Button("Reconnect") { Task { await model.refresh() } }.frame(minHeight: 44)
            }.fieldSurface()
        }
    }
}

struct PairingView: View {
    @Bindable var model: CompanionModel
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    Text("A shared space, wherever you settle.").font(.title2).fontWeight(.medium)
                    Text("Connect this iPhone to the companion on your Mac. Your conversation, memories, and commitments stay together.")
                    VStack(alignment: .leading, spacing: 12) {
                        Text("On your Mac").font(.headline)
                        Text("Open Glashaus → Settings → Your iPhone. Choose its Wi-Fi address and create a pairing link.")
                    }
                    VStack(alignment: .leading, spacing: 10) {
                        Text("Private pairing link").font(.headline)
                        TextField("glashaus://pair…", text: $model.pairingLink, axis: .vertical)
                            .lineLimit(2...5).textInputAutocapitalization(.never).autocorrectionDisabled()
                            .padding(12).background(FieldStyle.ink.opacity(0.07)).clipShape(RoundedRectangle(cornerRadius: 12))
                            .accessibilityIdentifier("pairingLink")
                        PasteButton(payloadType: String.self) { strings in model.pairingLink = strings.first ?? "" }
                        Text("Only use a link you created on your Mac. It expires after five minutes.").font(.caption).foregroundStyle(FieldStyle.secondaryInk)
                    }
                    Button { Task { await model.pair() } } label: {
                        Text(model.working ? "Connecting…" : "Connect to Mac").frame(maxWidth: .infinity, minHeight: 44)
                    }.buttonStyle(.borderedProminent).tint(FieldStyle.ink).foregroundStyle(FieldStyle.ground)
                        .disabled(model.working || model.pairingLink.isEmpty).accessibilityIdentifier("connectMac")
                    Text("Same Wi-Fi · Mac awake · Glashaus running").font(.caption).foregroundStyle(FieldStyle.secondaryInk)
                }.fieldSurface().padding(20)
            }.pastoralBackground().navigationTitle("Glashaus")
                .toolbar { if model.pairing != nil { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { model.showingPairing = false } } } }
        }
    }
}

struct ActivityView: View {
    @Bindable var model: CompanionModel
    @State private var editing: Reminder?
    @State private var showClosed = false
    @State private var creating = false
    var reminders: [Reminder] { model.snapshot?.reminders.filter { showClosed || !$0.closed } ?? [] }
    var body: some View {
        Group {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    OfflineNotice(model: model)
                    if model.snapshot?.companion == nil && model.connected {
                        Text("Your companion is waiting to be set up.").font(.title2)
                        Text("Create a test companion or restore a backup in the Mac app. This iPhone will connect to that same history.")
                    } else if reminders.isEmpty {
                        VStack(alignment: .leading, spacing: 12) {
                            Text("No open reminders.").font(.title2)
                            Text("Ask \(model.name) in conversation, or add one here. You’ll review its exact time before it’s scheduled.")
                            Button("New reminder") { creating = true }.frame(minHeight: 44).disabled(!model.canAct)
                        }.fieldSurface()
                    }
                    ForEach(reminders) { reminder in
                        ReminderCard(reminder: reminder, model: model, edit: { editing = reminder })
                    }
                    ForEach(model.checkIns.filter { $0.status == "available" }) { item in
                        CheckInCard(item: item, model: model)
                    }
                    Button { model.selectedTab = 0 } label: {
                        VStack(alignment: .leading, spacing: 12) {
                            HStack { Text("Conversation with \(model.name)").font(.headline); Spacer(); Image(systemName: "arrow.up.right").font(.subheadline).accessibilityHidden(true) }
                            if let last = model.history.last(where: { !$0.reply.isEmpty }) { Text(.init(last.reply)).font(.subheadline).lineLimit(3).multilineTextAlignment(.leading) }
                            Text("Return to conversation").font(.subheadline).underline()
                        }.fieldSurface()
                    }.buttonStyle(.plain).accessibilityLabel("Return to conversation")
                    if model.snapshot?.reminders.contains(where: \.closed) == true {
                        Toggle("Show completed and cancelled", isOn: $showClosed).font(.subheadline)
                            .padding(.horizontal, 4)
                    }
                }.padding(.horizontal, 20).padding(.top, 8).padding(.bottom, 24)
            }.pastoralBackground().navigationTitle("Reminders")
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) { Button { creating = true } label: { Label("New reminder", systemImage: "plus") }.disabled(!model.canAct).accessibilityIdentifier("newReminder") }
                }
                .refreshable { await model.refresh() }
                .sheet(item: $editing) { ReminderEditor(reminder: $0, model: model) }
                .sheet(isPresented: $creating) { ReminderEditor(reminder: nil, model: model) }
        }
    }
}

struct ReminderCard: View {
    let reminder: Reminder
    @Bindable var model: CompanionModel
    let edit: () -> Void
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .top) {
                Label(reminder.statusLabel, systemImage: reminder.needsConfirmation ? "circle.fill" : reminder.status == "due" ? "bell" : "checkmark.circle")
                    .font(.caption).fontWeight(.medium).foregroundStyle(reminder.needsConfirmation || reminder.status == "due" ? FieldStyle.rust : FieldStyle.charcoal)
                Spacer(minLength: 4)
                if !reminder.closed {
                    Menu { Button("Edit reminder", action: edit); if reminder.status == "scheduled" { Button("Pause reminder") { Task { await model.update(reminder, action: "pause") } } }; Button("Cancel reminder", role: .destructive) { Task { await model.update(reminder, action: "cancel") } } } label: {
                        Image(systemName: "ellipsis").frame(width: 44, height: 44)
                    }.accessibilityLabel("More actions for \(reminder.title)").disabled(!model.canAct)
                }
            }
            Text(reminder.title).font(.title2).fontWeight(.semibold).fixedSize(horizontal: false, vertical: true)
            VStack(alignment: .leading, spacing: 8) {
                Label(reminder.formatted("EEEE, MMMM d, yyyy"), systemImage: "calendar")
                Label(reminder.formatted("h:mm a '·' OOOO"), systemImage: "clock")
                Label(reminder.timeZone, systemImage: "globe.americas").font(.subheadline).lineLimit(nil)
                if reminder.recurrence != nil && reminder.recurrence != "none" { Label(reminder.repeatLabel, systemImage: "repeat").font(.subheadline) }
            }
            if reminder.needsConfirmation {
                Text("Not scheduled yet").font(.caption).foregroundStyle(FieldStyle.charcoal.opacity(0.75))
                Button { Task { await model.update(reminder, action: "confirm") } } label: {
                    Text("Confirm reminder").frame(maxWidth: .infinity, minHeight: 44)
                }.buttonStyle(.borderedProminent).buttonBorderShape(.roundedRectangle(radius: 8)).tint(FieldStyle.charcoal).foregroundStyle(FieldStyle.paper).disabled(!model.canAct)
                Button("Edit", action: edit).frame(maxWidth: .infinity, minHeight: 44).disabled(!model.canAct)
            } else if reminder.status == "due" {
                Button { Task { await model.update(reminder, action: "complete") } } label: {
                    Text("Mark done").frame(maxWidth: .infinity, minHeight: 44)
                }.buttonStyle(.borderedProminent).tint(FieldStyle.charcoal).foregroundStyle(FieldStyle.paper).disabled(!model.canAct)
            }
        }.padding(20).foregroundStyle(FieldStyle.charcoal).background { Image("ReminderPaper").resizable().scaledToFill() }.clipShape(RoundedRectangle(cornerRadius: 12))
    }
}

struct ReminderEditor: View {
    let reminder: Reminder?
    @Bindable var model: CompanionModel
    @Environment(\.dismiss) private var dismiss
    @State private var title: String
    @State private var date: Date
    @State private var recurrence: String
    private var zone: TimeZone { reminder?.zone ?? TimeZone(identifier: model.snapshot?.timeZone ?? "") ?? .current }
    init(reminder: Reminder?, model: CompanionModel) { self.reminder = reminder; self.model = model; _title = State(initialValue: reminder?.title ?? ""); _date = State(initialValue: reminder?.date ?? Date().addingTimeInterval(3600)); _recurrence = State(initialValue: reminder?.recurrence ?? "none") }
    var body: some View {
        NavigationStack {
            Form {
                Section("Reminder") { TextField("Title", text: $title, axis: .vertical).accessibilityIdentifier("reminderTitle") }
                Section {
                    DatePicker("When", selection: $date, in: Date()..., displayedComponents: [.date, .hourAndMinute]).environment(\.timeZone, zone)
                    Text(zone.identifier).font(.caption)
                    Picker("Repeat", selection: $recurrence) { Text("Never").tag("none"); Text("Daily").tag("daily"); Text("Weekdays").tag("weekdays"); Text("Weekly").tag("weekly"); Text("Monthly").tag("monthly") }
                } footer: { Text("Review the exact time and repeat rule in Home before scheduling. This is a Glashaus reminder. Calendar events are managed separately.") }
                if recurrence != "none" { Section { Text("Repeats keep this local time. A daylight-saving gap moves forward; a repeated hour uses its first occurrence. Mark an overdue reminder done to schedule the next future occurrence.").font(.footnote) } }
            }.pastoralBackground(reading: true).navigationTitle(reminder == nil ? "New reminder" : "Edit reminder").navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                    ToolbarItem(placement: .confirmationAction) { Button("Save draft") { Task {
                        var body: [String: Any] = ["title": title, "dueAt": ISO8601DateFormatter().string(from: date), "timeZone": zone.identifier, "recurrence": recurrence]
                        if let reminder { body["action"] = "edit"; body["revision"] = reminder.revision }
                        if await model.mutate(reminder.map { "/reminders/" + $0.id } ?? "/reminders", method: reminder == nil ? "POST" : "PATCH", body: body) { dismiss() }
                    } }.disabled(!model.canAct || title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || title.utf16.count > 500) }
                }
        }
    }
}
