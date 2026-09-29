import SwiftUI

struct ConversationView: View {
    @Bindable var model: CompanionModel
    @FocusState private var composing: Bool
    @State private var setAside = false
    private var canSend: Bool {
        model.canAct && !model.sending && model.pending == nil && !model.composer.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
    var body: some View {
        NavigationStack {
            ScrollViewReader { scroll in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 28) {
                        OfflineNotice(model: model)
                        if model.hasHiddenChat {
                            Button("Show earlier messages") { model.showHiddenChat() }.font(.subheadline).frame(minHeight: 44)
                            if model.timeline.isEmpty { Text("A little room to begin again. Your history and memories are still saved.").font(.body).foregroundStyle(FieldStyle.secondaryInk).padding(.vertical, 24) }
                        } else if model.olderCursor != nil { Button("Load earlier conversation") { Task { await model.older() } }.frame(minHeight: 44).disabled(!model.connected || model.working) }
                        if !model.hasHiddenChat && model.history.isEmpty && model.snapshot?.companion != nil { Text("There’s room for a conversation.").font(.title2).padding(.vertical, 40) }
                        ForEach(model.timeline) { entry in
                            if let turn = entry.turn {
                            VStack(alignment: .leading, spacing: 16) {
                                Text(turn.userText).textSelection(.enabled).padding(16).frame(maxWidth: .infinity, alignment: .leading).background(FieldStyle.surface).clipShape(RoundedRectangle(cornerRadius: 12))
                                    .accessibilityLabel("\(model.snapshot?.companion?.userName ?? "You"): \(turn.userText)")
                                if !turn.reply.isEmpty { Text(.init(turn.reply)).textSelection(.enabled) }
                                if let sources = turn.sources, !sources.isEmpty {
                                    VStack(alignment: .leading, spacing: 4) {
                                        Text("Sources").font(.caption).foregroundStyle(FieldStyle.secondaryInk)
                                        ForEach(Array(sources.enumerated()), id: \.offset) { _, source in
                                            if let url = URL(string: source.url), ["https", "http"].contains(url.scheme) { Link(source.title, destination: url).font(.subheadline).underline().frame(minHeight: 44, alignment: .leading) }
                                        }
                                    }
                                }
                                if model.snapshot?.reminders.contains(where: { $0.turnId == turn.id }) == true {
                                    Button { model.selectedTab = 1 } label: { Label("Review reminder in Home", systemImage: "calendar").frame(minHeight: 44) }.underline()
                                }
                                if ["interrupted", "failed"].contains(turn.status) && model.pending?.id != turn.id {
                                    Text(turn.error).font(.caption).foregroundStyle(FieldStyle.secondaryInk)
                                    Button("Retry reply") { model.retry(turn) }.frame(minHeight: 44).disabled(!model.canAct || model.sending)
                                }
                            }.id(turn.id)
                            } else if let item = entry.checkIn {
                                VStack(alignment: .leading, spacing: 12) {
                                    Label("\(model.name) checked in", systemImage: "bubble.left").font(.caption).foregroundStyle(FieldStyle.secondaryInk)
                                    Text(.init(item.content)).textSelection(.enabled)
                                    if let date = parseDate(item.createdAt) { Text(date.formatted(date: .abbreviated, time: .shortened)).font(.caption).foregroundStyle(FieldStyle.secondaryInk) }
                                }.id(item.id)
                            }
                        }
                        if let pending = model.pending {
                            VStack(alignment: .leading, spacing: 12) {
                                if !model.history.contains(where: { $0.id == pending.id }) { Text(pending.text).padding(16).frame(maxWidth: .infinity, alignment: .leading).background(FieldStyle.surface).clipShape(RoundedRectangle(cornerRadius: 12)) }
                                if !model.reply.isEmpty { Text(model.reply).textSelection(.enabled) }
                                if model.sending { HStack { ProgressView(); Text(model.replyStatus).font(.caption) }; Button("Stop reply", role: .destructive) { model.stop() }.frame(minHeight: 44) }
                                else {
                                    Text("This message is saved on your iPhone. Reconnect and retry to finish its reply.").font(.subheadline)
                                    HStack { Button("Retry message") { model.retry() }.disabled(!model.canAct); Spacer(); Button("Set aside") { setAside = true } }.frame(minHeight: 44)
                                }
                            }
                        }
                        Color.clear.frame(height: 1).id("bottom")
                    }.padding(20)
                }.pastoralBackground(reading: true)
                    .defaultScrollAnchor(.bottom)
                    .scrollDismissesKeyboard(.interactively)
                    .onChange(of: model.sending) { _, value in if value { scroll.scrollTo("bottom", anchor: .bottom) } }
                    .safeAreaInset(edge: .bottom, spacing: 0) {
                        HStack(alignment: .bottom, spacing: 0) {
                                Menu {
                                    Button("Clear chat view", systemImage: "text.bubble") { composing = false; model.clearChatView() }.disabled(model.timeline.isEmpty || model.sending)
                                    if model.hasHiddenChat { Button("Show earlier messages", systemImage: "clock.arrow.circlepath") { model.showHiddenChat() } }
                                } label: { Image(systemName: "ellipsis").font(.body.weight(.medium)).frame(width: 44, height: 44) }
                                    .accessibilityLabel("Conversation options").accessibilityIdentifier("conversationOptions")
                                Button { composing = false; model.showingVoice = true } label: { Image(systemName: "waveform").font(.system(size: 21, weight: .medium)).frame(width: 44, height: 44) }.buttonStyle(.plain).accessibilityLabel("Voice chat").disabled(!model.canAct || model.sending || model.pending != nil)
                                TextField("Message \(model.name)", text: $model.composer, prompt: Text("Message \(model.name)").foregroundColor(FieldStyle.ink.opacity(0.72)), axis: .vertical)
                                    .lineLimit(1...5).focused($composing)
                                    .padding(.leading, 12).padding(.vertical, 8).frame(minHeight: 44)
                                    .accessibilityIdentifier("messageComposer")
                                Button { composing = false; model.send() } label: {
                                    Image(systemName: "arrow.up").font(.body.weight(.semibold))
                                        .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
                                        .foregroundStyle(canSend ? FieldStyle.ground : FieldStyle.secondaryInk)
                                        .frame(width: 32, height: 32)
                                        .background(canSend ? FieldStyle.ink : FieldStyle.ink.opacity(0.08), in: Circle())
                                        .frame(width: 44, height: 44).contentShape(Rectangle())
                                }
                                    .buttonStyle(.plain).disabled(!canSend)
                                    .accessibilityLabel("Send message").accessibilityIdentifier("sendMessage")
                        }.padding(.trailing, 4)
                            .background(FieldStyle.surface, in: RoundedRectangle(cornerRadius: 12))
                            .padding(.horizontal, 16).padding(.vertical, 6)
                            .background(.bar)
                    }
                    .refreshable { await model.refresh() }
            }.toolbar(.hidden, for: .navigationBar)
                .confirmationDialog("Set aside this pending reply?", isPresented: $setAside, titleVisibility: .visible) {
                    Button("Set aside", role: .destructive) { model.setAside() }
                } message: { Text("This removes the local retry. A message already received by the Mac remains in your conversation.") }
        }
    }
}

struct SettingsView: View {
    @Bindable var model: CompanionModel
    var body: some View {
        NavigationStack {
            List {
                Section("Your companion") {
                    NavigationLink { CompanionProfileView(model: model) } label: {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(model.name).font(.headline)
                            Text("Identity, personality, and voice").font(.subheadline).foregroundStyle(FieldStyle.secondaryInk)
                        }.padding(.vertical, 6)
                    }.accessibilityIdentifier("companionProfile")
                    NavigationLink { CheckInSettings(model: model) } label: { Label("Personal check-ins", systemImage: "bubble.left.and.text.bubble.right") }
                }
                Section("Shared history") {
                    NavigationLink { MemoriesView(model: model) } label: { Label("Memories", systemImage: "book.closed") }
                    NavigationLink { JournalView(model: model) } label: { Label("Journal", systemImage: "text.book.closed") }
                    Button { model.clearChatView() } label: { Label("Clear chat view", systemImage: "text.bubble") }.disabled(model.timeline.isEmpty || model.sending)
                    if model.hasHiddenChat { Button("Show earlier messages") { model.showHiddenChat(); model.selectedTab = 0 } }
                }
                Section("Your space") {
                    NavigationLink { AppearanceView() } label: { Label("Background", systemImage: "photo") }
                    NavigationLink { VoiceSettingsView(model: model) } label: { Label("Voice", systemImage: "waveform") }
                    NavigationLink { ConnectionsView(model: model) } label: { Label("Connections", systemImage: "link") }
                }
                Section {
                    NavigationLink { MacConnectionView(model: model) } label: {
                        HStack {
                            Label("Mac connection", systemImage: "laptopcomputer")
                            Spacer()
                            Text(model.connected ? "Connected" : "Offline").font(.subheadline).foregroundStyle(model.connected ? FieldStyle.olive : FieldStyle.ink)
                        }
                    }
                } footer: { Text("Your companion lives on your Mac. Connect on the same Wi-Fi or through your private Tailscale network.") }
            }.pastoralBackground(reading: true).navigationTitle("Settings")
        }
    }
}

struct MacConnectionView: View {
    @Bindable var model: CompanionModel
    @State private var forgetting = false
    @State private var unpairing = false
    @State private var address = ""
    @State private var updatedAddress = false
    var body: some View {
        List {
            Section {
                ConnectionStatus(model: model)
                if let pairing = model.pairing { Text(pairing.server).font(.footnote).textSelection(.enabled) }
                Button("Update Mac connection") { model.showingPairing = true }.disabled(model.sending || model.pending != nil)
            } header: { Text("Connection") } footer: { Text("If your Mac’s Wi-Fi address changes, create a new pairing link in Glashaus on the Mac. Finish or set aside any pending reply before connecting again.") }
            Section("Saved on this iPhone") {
                Text("Your recent conversation stays available for offline reading. New messages and changes need a connection to your Mac.")
            }.font(.subheadline)
            Section {
                TextField("https://100.x.x.x:7784", text: $address).accessibilityIdentifier("macAddress").textInputAutocapitalization(.never).autocorrectionDisabled().keyboardType(.URL)
                Button("Use this Mac address") { Task { updatedAddress = await model.updateAddress(address) } }.disabled(model.working || model.sending || address.isEmpty).accessibilityIdentifier("useMacAddress")
                if model.pending != nil {
                    Text("Your pending message stays saved when changing this Mac’s address. You can retry it after reconnecting.").font(.footnote)
                    if model.sending { Button("Stop waiting for reply") { model.stop() } }
                }
                if updatedAddress { Text("Address verified and saved.").font(.caption) }
                Link("Get Tailscale", destination: URL(string: "https://tailscale.com/download")!)
            } header: { Text("Wi-Fi or Tailscale") } footer: { Text("Use the Mac’s Tailscale IPv4 address for access away from home. Both devices must use your Tailscale account. The app verifies the same paired certificate before saving a new address.") }
            Section { NavigationLink("Mac diagnostics") { DiagnosticsView(model: model) } }
            Section {
                Button("Unpair iPhone", role: .destructive) { unpairing = true }.disabled(!model.connected || model.sending)
                Button("Forget this Mac", role: .destructive) { forgetting = true }.disabled(model.sending)
            } footer: { Text("Unpair revokes this iPhone’s access and removes its saved copy. Forget removes only the local copy; revoke access in Mac Settings if the Mac is offline.") }
        }.pastoralBackground(reading: true).navigationTitle("Mac connection").navigationBarTitleDisplayMode(.inline)
            .onAppear { address = model.pairing?.server ?? "" }
            .confirmationDialog("Unpair this iPhone?", isPresented: $unpairing, titleVisibility: .visible) { Button("Unpair iPhone", role: .destructive) { Task { await model.unpair() } } } message: { Text("Your companion and history remain on the Mac.") }
            .confirmationDialog("Forget this Mac?", isPresented: $forgetting, titleVisibility: .visible) { Button("Forget this Mac", role: .destructive) { model.forgetLocally() } } message: { Text("The local history, pairing, and pending reply will be removed from this iPhone. This does not revoke its credential on the Mac.") }
    }
}

struct DiagnosticsView: View {
    @Bindable var model: CompanionModel
    struct Result: Decodable { struct Check: Decodable, Identifiable { let id: String; let title: String; let ok: Bool; let detail: String }; let checkedAt: String; let uptimeSeconds: Int; let checks: [Check] }
    @State private var result: Result?
    @State private var error = ""
    var body: some View {
        List {
            if let result { Section { Text("Service running for \(Duration.seconds(result.uptimeSeconds).formatted(.units(allowed: [.hours, .minutes])))").font(.subheadline) }; ForEach(result.checks) { check in VStack(alignment: .leading, spacing: 8) { Label(check.title, systemImage: check.ok ? "checkmark.circle" : "exclamationmark.circle").font(.headline); Text(check.detail).font(.subheadline) }.padding(.vertical, 4) } }
            if !error.isEmpty { Text(error) }
            Button("Run checks") { Task { await load() } }
        }.pastoralBackground(reading: true).navigationTitle("Mac diagnostics").navigationBarTitleDisplayMode(.inline).task { await load() }
    }
    private func load() async { do { result = try await model.fetch("/diagnostics"); error = "" } catch { self.error = error.localizedDescription } }
}

struct MemoriesView: View {
    @Bindable var model: CompanionModel
    @State private var selected: Memory?
    var body: some View {
        List {
            if model.snapshot?.memories.isEmpty != false { ContentUnavailableView("No memories yet", systemImage: "book.closed", description: Text("Memories grow through your conversation. You can inspect and correct them here.")) }
            ForEach(model.snapshot?.memories ?? []) { memory in
                Button { selected = memory } label: {
                    VStack(alignment: .leading, spacing: 8) { Text(memory.text).foregroundStyle(FieldStyle.ink); Text("About \(memory.subject == "user" ? "you" : memory.subject == "companion" ? model.name : "your relationship") · \(memory.kind)").font(.caption).foregroundStyle(FieldStyle.secondaryInk) }.padding(.vertical, 6)
                }.disabled(!model.canAct)
            }
        }.pastoralBackground(reading: true).navigationTitle("Memories").navigationBarTitleDisplayMode(.inline)
            .sheet(item: $selected) { MemoryEditor(memory: $0, model: model) }
    }
}

struct CompanionProfileView: View {
    @Bindable var model: CompanionModel
    var body: some View {
        List {
            if let c = model.snapshot?.companion {
                profileSection("Identity", c.summary)
                profileSection("Personality", c.personality)
                profileSection("Voice & language", c.voice)
                profileSection("Authored background", c.backstory)
                profileSection("Values", c.values)
                profileSection("Relationship", c.relationship)
                Section { Text("This is the foundation you authored. Memories come from your actual conversations. Edit the foundation in Glashaus Settings on your Mac.").font(.subheadline).foregroundStyle(FieldStyle.secondaryInk) }
            }
        }.pastoralBackground(reading: true).navigationTitle(model.name).navigationBarTitleDisplayMode(.inline)
    }
    @ViewBuilder private func profileSection(_ title: String, _ value: String?) -> some View {
        if let value, !value.isEmpty { Section(title) { Text(value).textSelection(.enabled) } }
    }
}

struct CheckInCard: View {
    let item: CheckIn
    @Bindable var model: CompanionModel
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Label("From \(model.name)", systemImage: "bubble.left").font(.headline)
            Text(.init(item.content)).textSelection(.enabled)
            DisclosureGroup("Why this appeared") {
                VStack(alignment: .leading, spacing: 8) { Text(item.reason); Text("You said: “\(item.evidence)”").foregroundStyle(FieldStyle.secondaryInk) }.font(.subheadline).padding(.top, 8)
            }
            ViewThatFits(in: .horizontal) {
                HStack { continueButton; Spacer(); dismissButton }
                VStack(alignment: .leading) { continueButton; dismissButton }
            }
        }.fieldSurface()
    }
    private var continueButton: some View {
        Button("Continue conversation") { Task { if await model.mutate("/check-ins/" + item.id, body: ["action": "seen"]) { model.selectedTab = 0 } } }.frame(minHeight: 44).disabled(!model.canAct)
    }
    private var dismissButton: some View {
        Button("Dismiss") { Task { _ = await model.mutate("/check-ins/" + item.id, body: ["action": "dismiss"]) } }.frame(minHeight: 44).disabled(!model.canAct)
    }
}

struct CheckInSettings: View {
    @Bindable var model: CompanionModel
    @State private var enabled = false
    @State private var start = 9
    @State private var end = 21
    @State private var maximum = 2
    @State private var saved = false
    var body: some View {
        Form {
            Section {
                Toggle("Allow personal check-ins", isOn: $enabled)
            } footer: { Text("Occasional messages grounded in something you actually discussed. Requested reminders keep their own schedule.") }
            Section("When to reach out") {
                Picker("From", selection: $start) { ForEach(0..<24) { Text(hour($0)).tag($0) } }
                Picker("Until", selection: $end) { ForEach(0..<24) { Text(hour($0)).tag($0) } }
                Stepper("At most \(maximum) per day", value: $maximum, in: 1...5)
                Text(model.snapshot?.checkInPolicy?.timeZone ?? model.snapshot?.timeZone ?? "").font(.caption).foregroundStyle(FieldStyle.secondaryInk)
            }
            Section {
                Text("At least two hours after your last message, and four hours between check-ins. An active conversation delays outreach; silence is always an option.")
                Text("Check-ins appear in Home while your Mac is running.")
            }.font(.subheadline)
            Section {
                Button(model.working ? "Saving…" : "Save preferences") { Task {
                    saved = await model.mutate("/check-ins/preferences", body: ["enabled": enabled, "quietEnd": start, "quietStart": end, "maxPerDay": maximum])
                } }.disabled(!model.canAct || (enabled && start == end))
                if saved { Label("Preferences saved", systemImage: "checkmark").foregroundStyle(FieldStyle.olive) }
            }
        }.pastoralBackground(reading: true).navigationTitle("Personal check-ins").navigationBarTitleDisplayMode(.inline)
            .onAppear { if let policy = model.snapshot?.checkInPolicy { enabled = policy.enabled; start = policy.quietEnd; end = policy.quietStart; maximum = max(1, policy.maxPerDay) } }
            .onChange(of: enabled) { saved = false }.onChange(of: start) { saved = false }.onChange(of: end) { saved = false }.onChange(of: maximum) { saved = false }
    }
    private func hour(_ value: Int) -> String { value == 0 ? "12 am" : value < 12 ? "\(value) am" : value == 12 ? "12 pm" : "\(value - 12) pm" }
}
struct MemoryEditor: View {
    let memory: Memory
    @Bindable var model: CompanionModel
    @Environment(\.dismiss) private var dismiss
    @State private var text: String
    @State private var forgetting = false
    init(memory: Memory, model: CompanionModel) { self.memory = memory; self.model = model; _text = State(initialValue: memory.text) }
    var body: some View {
        NavigationStack {
            Form {
                Section("Memory") { TextField("Memory", text: $text, axis: .vertical).lineLimit(3...10).accessibilityIdentifier("memoryText") }
                Section("Evidence") { Text(memory.evidence) }
                Section { Button("Forget memory", role: .destructive) { forgetting = true }.disabled(!model.canAct) }
            }.pastoralBackground(reading: true).navigationTitle("Edit memory").navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                    ToolbarItem(placement: .confirmationAction) { Button("Save") { Task { if await model.mutate("/memories/" + memory.id, body: ["text": text]) { dismiss() } } }.disabled(!model.canAct || text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty) }
                }.confirmationDialog("Forget this memory?", isPresented: $forgetting, titleVisibility: .visible) { Button("Forget memory", role: .destructive) { Task { if await model.mutate("/memories/" + memory.id, method: "DELETE") { dismiss() } } } }
        }
    }
}
struct JournalView: View {
    @Bindable var model: CompanionModel
    var body: some View {
        List {
            if model.snapshot?.reflections.isEmpty != false { ContentUnavailableView("Nothing written yet", systemImage: "text.book.closed", description: Text("When your companion reflects, those journal entries will appear here.")) }
            ForEach(model.snapshot?.reflections ?? []) { reflection in
                VStack(alignment: .leading, spacing: 12) { if let date = parseDate(reflection.createdAt) { Text(date.formatted(date: .long, time: .omitted)).font(.caption).foregroundStyle(FieldStyle.secondaryInk) }; Text(reflection.content).textSelection(.enabled) }.padding(.vertical, 8)
            }
        }.pastoralBackground(reading: true).navigationTitle("Journal").navigationBarTitleDisplayMode(.inline)
    }
}
