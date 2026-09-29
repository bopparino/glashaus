import SwiftUI
import QuickLook

enum BackgroundPreset {
    static let choices = [("PastoralBackdrop", "Far field"), ("FieldQuiet", "Field quiet"), ("NightRelay", "Night relay"), ("plain", "Plain")]
    static func asset(_ value: String) -> String { choices.contains(where: { $0.0 == value }) ? value : "PastoralBackdrop" }
}
struct HomeView: View {
    @Bindable var model: CompanionModel
    @State private var creating = false
    @State private var editing: Reminder?
    private var greeting: String {
        let hour = Calendar.current.component(.hour, from: Date())
        return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening"
    }
    private var openReminders: [Reminder] { model.snapshot?.reminders.filter { !$0.closed } ?? [] }
    private var attention: [Reminder] { openReminders.filter { $0.needsConfirmation || $0.status == "due" } }
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 28) {
                    OfflineNotice(model: model)
                    VStack(alignment: .leading, spacing: 12) {
                        Text("\(greeting),\n\(model.snapshot?.companion?.userName ?? "you").").font(.largeTitle.weight(.semibold)).fixedSize(horizontal: false, vertical: true)
                        Text(Date().formatted(.dateTime.weekday(.wide).month(.wide).day())).font(.subheadline).foregroundStyle(FieldStyle.secondaryInk)
                        ViewThatFits(in: .horizontal) {
                            HStack(spacing: 20) { conversationButton; voiceButton }
                            VStack(alignment: .leading, spacing: 4) { conversationButton; voiceButton }
                        }.padding(.top, 8)
                    }.padding(.vertical, 16)
                    ForEach(model.checkIns.filter { $0.status == "available" }) { CheckInCard(item: $0, model: model) }
                    if let reminder = attention.first { ReminderCard(reminder: reminder, model: model, edit: { editing = reminder }) }
                    ForEach(model.snapshot?.proposals?.filter { $0.status == "draft" || $0.status == "unknown" } ?? []) { proposal in
                        NavigationLink { ProposalView(proposal: proposal, model: model) } label: {
                            VStack(alignment: .leading, spacing: 8) { Text(proposal.title).font(.headline); Text(proposal.status == "draft" ? "Review before anything changes" : "Check the outcome").font(.subheadline); Label("Review proposal", systemImage: "arrow.up.right").font(.subheadline) }.frame(maxWidth: .infinity, alignment: .leading).fieldSurface()
                        }.buttonStyle(.plain).accessibilityIdentifier("proposal-" + proposal.id)
                    }
                    VStack(spacing: 0) {
                        NavigationLink { WorkspaceLibraryView(model: model) } label: { homeRow("Files and tasks", detail: "Plans, documents, and work in progress", icon: "books.vertical") }.accessibilityIdentifier("homeWorkspace")
                        Divider()
                        NavigationLink { ActivityView(model: model) } label: { homeRow("Reminders", detail: openReminders.isEmpty ? "Nothing scheduled" : "\(openReminders.count) open", icon: "checklist") }.accessibilityIdentifier("homeReminders")
                        Divider()
                        NavigationLink { CalendarAgendaView(model: model) } label: { homeRow("Calendar", detail: "Your next two weeks", icon: "calendar") }
                        Divider()
                        NavigationLink { InboxView(model: model) } label: { homeRow("Inbox", detail: "Recent iCloud mail", icon: "tray") }
                    }.padding(.horizontal, 16).background(FieldStyle.surface, in: RoundedRectangle(cornerRadius: 12))
                    if let last = model.history.last(where: { !$0.reply.isEmpty }) {
                        Button { model.selectedTab = 0 } label: {
                            VStack(alignment: .leading, spacing: 12) { Text("Last from \(model.name)").font(.headline); Text(.init(last.reply)).font(.body).lineLimit(4).multilineTextAlignment(.leading); Text("Continue conversation").font(.subheadline).underline() }.frame(maxWidth: .infinity, alignment: .leading)
                        }.buttonStyle(.plain)
                    }
                }.padding(.horizontal, 20).padding(.bottom, 28)
            }.pastoralBackground(reading: true).navigationTitle("Home").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .topBarTrailing) { Button { creating = true } label: { Label("New reminder", systemImage: "plus") }.disabled(!model.canAct).accessibilityIdentifier("newReminder") } }
                .refreshable { await model.refresh() }
                .sheet(isPresented: $creating) { ReminderEditor(reminder: nil, model: model) }
                .sheet(item: $editing) { ReminderEditor(reminder: $0, model: model) }
        }
    }
    private var conversationButton: some View { Button { model.selectedTab = 0 } label: { Label("Message \(model.name)", systemImage: "bubble.left").frame(minHeight: 44) }.buttonStyle(.plain) }
    private var voiceButton: some View { Button { model.showingVoice = true } label: { Label("Talk", systemImage: "waveform").frame(minHeight: 44) }.buttonStyle(.plain).disabled(!model.canAct) }
    private func homeRow(_ title: String, detail: String, icon: String) -> some View {
        HStack(spacing: 12) { Image(systemName: icon).frame(width: 24); VStack(alignment: .leading, spacing: 4) { Text(title); Text(detail).font(.caption).foregroundStyle(FieldStyle.secondaryInk) }; Spacer(); Image(systemName: "chevron.right").font(.caption).accessibilityHidden(true) }.foregroundStyle(FieldStyle.ink).padding(.vertical, 16)
    }
}

struct AppearanceView: View {
    @AppStorage("backgroundPreset") private var selected = "PastoralBackdrop"
    var body: some View {
        ScrollView {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 140), spacing: 16)], spacing: 20) {
                ForEach(BackgroundPreset.choices, id: \.0) { id, name in
                    Button { selected = id } label: {
                        VStack(alignment: .leading, spacing: 10) {
                            GeometryReader { g in
                                if id == "plain" { FieldStyle.ground }
                                else { Image(id).resizable().scaledToFill().frame(width: g.size.width, height: g.size.height).clipped() }
                            }.frame(height: 220).clipShape(RoundedRectangle(cornerRadius: 12))
                            HStack { Text(name); Spacer(); if selected == id { Image(systemName: "checkmark.circle.fill") } }.frame(minHeight: 44)
                        }
                    }.buttonStyle(.plain).accessibilityLabel(name).accessibilityAddTraits(selected == id ? .isSelected : [])
                }
            }.padding(20)
        }.pastoralBackground(reading: true).navigationTitle("Background").navigationBarTitleDisplayMode(.inline)
    }
}


struct WorkspaceLibraryView: View {
    @Bindable var model: CompanionModel
    @State private var workspace: WorkspaceSnapshot?
    @State private var error = ""
    @State private var preview: URL?
    @State private var opening = false
    var body: some View {
        List {
            if !error.isEmpty { Section { Text(error); Button("Try again") { Task { await load() } } } }
            if let workspace {
                if !workspace.sandbox.ready { Section { Text(workspace.sandbox.message).font(.subheadline) } }
                Section("Files") {
                    if workspace.files.isEmpty { Text("Ask for a PDF or Word document in Conversation. Finished files will appear here.").foregroundStyle(FieldStyle.secondaryInk) }
                    ForEach(workspace.files) { file in
                        Button { Task { opening = true; defer { opening = false }; do { preview = try await model.workspaceFile(file) } catch { self.error = error.localizedDescription } } } label: {
                            HStack { Image(systemName: file.kind == "image" ? "photo" : "doc.text"); VStack(alignment: .leading, spacing: 4) { Text(file.name); Text(ByteCountFormatter.string(fromByteCount: Int64(file.size), countStyle: .file)).font(.caption).foregroundStyle(FieldStyle.secondaryInk) }; Spacer(); Image(systemName: "arrow.up.right").font(.caption) }.padding(.vertical, 6)
                        }.disabled(opening || !model.connected)
                    }
                }
                Section("Tasks") {
                    if workspace.tasks.isEmpty { Text("No tasks yet.").foregroundStyle(FieldStyle.secondaryInk) }
                    ForEach(workspace.tasks) { task in
                        VStack(alignment: .leading, spacing: 8) {
                            HStack { Text(task.title).font(.headline); Spacer(); if task.active { ProgressView() } }
                            Text(task.stage).font(.subheadline).foregroundStyle(FieldStyle.secondaryInk)
                            if !task.error.isEmpty { Text(task.error).font(.subheadline) }
                            if task.active { Button("Cancel task", role: .destructive) { Task { await action(task, "cancel") } }.frame(minHeight: 44) }
                            else if task.status != "complete" { Button("Retry task") { Task { await action(task, "retry") } }.frame(minHeight: 44) }
                        }.padding(.vertical, 4)
                    }
                }
            } else if error.isEmpty { ProgressView("Opening your files…") }
        }.pastoralBackground(reading: true).navigationTitle("Files and tasks").navigationBarTitleDisplayMode(.inline)
            .quickLookPreview($preview).refreshable { await load() }
            .task { await load(); while !Task.isCancelled { try? await Task.sleep(for: .seconds(4)); if Task.isCancelled { break }; await load() } }
    }
    private func load() async { do { workspace = try await model.fetch("/workspace"); error = "" } catch { self.error = error.localizedDescription } }
    private func action(_ task: WorkspaceTask, _ name: String) async { do { let _: WorkspaceTask = try await model.fetch("/workspace/tasks/" + task.id + "/" + name, method: "POST", body: ["requestId": UUID().uuidString]); await load() } catch { self.error = error.localizedDescription } }
}
