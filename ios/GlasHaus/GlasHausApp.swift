import SwiftUI

@main struct GlasHausApp: App {
    @StateObject private var session = Session()
    @AppStorage("appearance") private var appearance = "system"
    @Environment(\.scenePhase) private var phase

    var body: some Scene {
        WindowGroup {
            Group {
                if session.credentials == nil {
                    PairingView()
                } else {
                    TabView {
                        NavigationStack { ChatView() }
                            .tabItem { Label("Chat", systemImage: "bubble.left") }
                        NavigationStack { MemoryView() }
                            .tabItem { Label("Memory", systemImage: "book.closed") }
                        NavigationStack { SettingsView() }
                            .tabItem { Label("Settings", systemImage: "slider.horizontal.3") }
                    }
                }
            }
            .environmentObject(session)
            .tint(.primary)
            .preferredColorScheme(appearance == "dark" ? .dark : appearance == "light" ? .light : nil)
            .task { await session.refresh() }
            .onChange(of: phase) { _, phase in
                if phase == .active { Task { await session.refresh() } }
                if phase == .background { session.stop() }
            }
            .overlay {
                if phase != .active {
                    Color(uiColor: .systemBackground).ignoresSafeArea()
                    Text("GlasHaus").font(.title2.weight(.medium))
                }
            }
        }
    }
}

struct PairingView: View {
    @EnvironmentObject private var session: Session
    @State private var address = ""
    @State private var code = ""
    @State private var busy = false
    @State private var error: String?
    @FocusState private var focus: Field?
    private enum Field { case address, code }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    VStack(alignment: .leading, spacing: 12) {
                        Text("A familiar voice.\nA place of your own.")
                            .font(.largeTitle.weight(.semibold)).fixedSize(horizontal: false, vertical: true)
                        Text("Connect to the GlasHaus on your computer. Your conversation comes with you.")
                            .foregroundStyle(.secondary)
                    }.padding(.vertical, 20)
                }.listRowBackground(Color.clear).listRowInsets(EdgeInsets(top: 0, leading: 0, bottom: 12, trailing: 0))
                Section {
                    TextField("Computer’s HTTPS address", text: $address)
                        .keyboardType(.URL).textContentType(.URL).textInputAutocapitalization(.never)
                        .autocorrectionDisabled().focused($focus, equals: .address)
                        .submitLabel(.next).onSubmit { focus = .code }
                    TextField("Pairing code", text: $code)
                        .textInputAutocapitalization(.characters).autocorrectionDisabled()
                        .monospaced().focused($focus, equals: .code).submitLabel(.go)
                        .onSubmit { if ready { pair() } }
                } header: { Text("Your computer") } footer: {
                    Text("In GlasHaus on your computer, open Settings → Your phone. Create a code and enter it here. Keep Tailscale connected on both devices.")
                }
                if let message = error ?? session.error { Section { ErrorText(message: message) } }
                Section {
                    Button(action: pair) {
                        HStack {
                            Spacer()
                            if busy { ProgressView().padding(.trailing, 8) }
                            Text(busy ? "Connecting…" : "Connect")
                            Spacer()
                        }.frame(minHeight: 44)
                    }.disabled(!ready).buttonStyle(.plain)
                }
                Section {
                    Text("Your computer runs the model. It needs to be awake and connected when you chat. You can disconnect this phone at any time.")
                        .font(.footnote).foregroundStyle(.secondary)
                }.listRowBackground(Color.clear)
            }
            .navigationTitle("GlasHaus").navigationBarTitleDisplayMode(.inline)
        }
    }
    private var ready: Bool { !busy && !address.isEmpty && !code.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    private func pair() {
        guard ready else { return }
        busy = true; error = nil; focus = nil
        Task {
            defer { busy = false }
            do { try await session.pair(address: address, code: code); code = "" }
            catch { self.error = error.localizedDescription }
        }
    }
}

struct ErrorText: View {
    let message: String
    var body: some View {
        Label(message, systemImage: "exclamationmark.circle")
            .font(.callout).foregroundStyle(.red).fixedSize(horizontal: false, vertical: true)
            .accessibilityLabel("Something needs attention. \(message)")
    }
}
