import SwiftUI

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
