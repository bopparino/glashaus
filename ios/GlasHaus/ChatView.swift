import SwiftUI

struct ChatView: View {
    @EnvironmentObject private var session: Session
    @State private var followLatest = true
    @State private var discard = false
    @FocusState private var writing: Bool
    private var companionName: String { session.snapshot?.companion?.name ?? "GlasHaus" }
    private var visibleTurns: [Turn] {
        (session.snapshot?.turns ?? []).filter { $0.id != session.pending?.serverID }
    }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 28) {
                    if visibleTurns.isEmpty && session.pending == nil {
                        VStack(alignment: .leading, spacing: 12) {
                            Text(session.snapshot == nil ? "Your conversation is here." : "Make yourself at home.")
                                .font(.title2.weight(.semibold))
                            Text(session.snapshot == nil ? "Connect to your computer to load it." : "No need for an opening line. Start wherever you are.")
                                .foregroundStyle(.secondary)
                            if session.snapshot == nil {
                                Button("Try connecting again") { Task { await session.refresh() } }
                                    .frame(minHeight: 44).disabled(session.refreshing)
                            }
                        }.padding(.top, 40)
                    }
                    ForEach(visibleTurns) { turn in
                        MessageBlock(user: turn.userText, reply: turn.reply, name: companionName)
                        if turn.status != "complete" {
                            Text(turn.error.isEmpty ? "This reply is unfinished." : turn.error)
                                .font(.footnote).foregroundStyle(.secondary)
                        }
                    }
                    if let pending = session.pending {
                        MessageBlock(user: pending.text, reply: session.reply, name: companionName)
                        if session.sending {
                            HStack(spacing: 10) {
                                ProgressView().controlSize(.small)
                                Text(session.status.isEmpty ? "Replying…" : session.status)
                            }.font(.footnote).foregroundStyle(.secondary)
                        }
                    }
                    Color.clear.frame(height: 1).id("latest")
                }
                .padding(.horizontal, 20).padding(.bottom, 20).frame(maxWidth: 720)
                .frame(maxWidth: .infinity)
            }
            .scrollDismissesKeyboard(.interactively)
            .simultaneousGesture(DragGesture().onChanged { _ in followLatest = false })
            .refreshable { await session.refresh() }
            .onChange(of: session.reply) { _, _ in if followLatest { proxy.scrollTo("latest", anchor: .bottom) } }
            .onChange(of: session.snapshot?.turns.count) { _, _ in if followLatest { proxy.scrollTo("latest", anchor: .bottom) } }
            .onChange(of: session.pending?.id) { _, pending in
                if pending != nil { writing = false }
                followLatest = true; proxy.scrollTo("latest", anchor: .bottom)
            }
            .overlay(alignment: .bottomTrailing) {
                if !followLatest {
                    Button {
                        followLatest = true; proxy.scrollTo("latest", anchor: .bottom)
                    } label: { Image(systemName: "arrow.down").frame(width: 44, height: 44) }
                        .background(.regularMaterial, in: Circle()).padding()
                        .accessibilityLabel("Go to latest message")
                }
            }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) { composer }
        .navigationTitle(companionName).navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { Task { await session.refresh() } } label: {
                    Image(systemName: session.online ? "checkmark.circle" : "wifi.slash")
                }
                .accessibilityLabel(session.online ? "Connected. Refresh conversation" : "Not connected. Retry connection")
                .disabled(session.refreshing || session.sending)
            }
        }
        .confirmationDialog("Leave this reply unfinished?", isPresented: $discard, titleVisibility: .visible) {
            Button("Continue with a new message", role: .destructive) {
                do { try session.discardPending() }
                catch { session.error = error.localizedDescription }
            }
        } message: { Text("The message and any partial reply remain on your computer. This removes the retry from your phone.") }
    }
    private var composer: some View {
        VStack(spacing: 12) {
            if let error = session.error { ErrorText(message: error).frame(maxWidth: .infinity, alignment: .leading) }
            if session.pending != nil && !session.sending {
                HStack {
                    Button("Retry reply") { session.retry() }.buttonStyle(.borderedProminent)
                    Button("Continue without retrying") { discard = true }.buttonStyle(.borderless)
                }.frame(minHeight: 44)
            }
            HStack(alignment: .bottom, spacing: 10) {
                TextField("Message \(companionName)", text: $session.draft, axis: .vertical)
                    .lineLimit(1...6).padding(.horizontal, 16).padding(.vertical, 12)
                    .background(Color(uiColor: .secondarySystemBackground), in: RoundedRectangle(cornerRadius: 24))
                    .focused($writing).disabled(session.pending != nil)
                Button {
                    if session.sending { session.stop() } else {
                        // Clear focus before disabling the field, so re-enabling it
                        // after a reply cannot restore the dismissed keyboard.
                        writing = false
                        followLatest = true
                        session.send()
                    }
                } label: {
                    Image(systemName: session.sending ? "stop.fill" : "arrow.up")
                        .font(.body.weight(.semibold)).frame(width: 46, height: 46)
                        .foregroundStyle(Color(uiColor: .systemBackground))
                        .background(Color.primary.opacity(canAct ? 1 : 0.3), in: Circle())
                }.disabled(!canAct).accessibilityLabel(session.sending ? "Stop reply" : "Send message")
            }
            if session.draft.utf16.count > 16_000 {
                Text("Shorten this message to 16,000 characters or fewer.").font(.footnote).foregroundStyle(.red)
            }
        }
        .padding(.horizontal, 16).padding(.vertical, 12)
        .background(.bar)
    }
    private var canAct: Bool {
        session.sending || (session.pending == nil && session.snapshot?.companion != nil
            && !session.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && session.draft.utf16.count <= 16_000)
    }
}

private struct MessageBlock: View {
    let user, reply, name: String
    var body: some View {
        VStack(alignment: .leading, spacing: 24) {
            HStack {
                Spacer(minLength: 28)
                Text(user).textSelection(.enabled).padding(.horizontal, 16).padding(.vertical, 12)
                    .background(Color(uiColor: .secondarySystemBackground), in: RoundedRectangle(cornerRadius: 20))
                    .accessibilityLabel("You: \(user)")
            }
            if !reply.isEmpty {
                let formatted = MessageFormatting.reply(reply)
                Text(formatted).lineSpacing(4).textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .accessibilityLabel("\(name): \(String(formatted.characters))")
            }
        }
    }
}
