import SwiftUI
import UniformTypeIdentifiers

struct SettingsView: View {
    @EnvironmentObject private var session: Session
    @AppStorage("appearance") private var appearance = "system"
    @State private var disconnecting = false
    @State private var confirmDisconnect = false
    @State private var confirmForget = false
    @State private var exporting = false
    @State private var showExport = false
    @State private var archive = ArchiveDocument()
    @State private var error: String?
    @State private var editor: Editor?
    private enum Editor: String, Identifiable {
        case identity, voice, model
        var id: String { rawValue }
    }
    var body: some View {
        Form {
            if session.snapshot?.companion != nil {
                Section("Companion") {
                    Button("Identity & relationship") { editor = .identity }
                    Button("Voice & continuity") { editor = .voice }
                }
            }
            if session.snapshot?.settings != nil {
                Section("Conversation") { Button("Model & memory") { editor = .model } }
            }
            Section("Appearance") {
                Picker("Theme", selection: $appearance) {
                    Text("System").tag("system"); Text("Light").tag("light"); Text("Dark").tag("dark")
                }
            }
            Section {
                LabeledContent("Status", value: session.online ? "Connected" : "Not connected")
                if let address = session.credentials?.address {
                    Text(address).font(.footnote).foregroundStyle(.secondary).textSelection(.enabled)
                }
                Button(session.refreshing ? "Connecting…" : "Refresh connection") { Task { await session.refresh() } }
                    .disabled(session.refreshing || session.sending)
            } header: { Text("Your computer") } footer: {
                Text("Keep your computer awake, GlasHaus and Ollama running, and Tailscale connected. Provider addresses, API keys, startup, and archive restore are managed in the computer’s Settings.")
            }
            Section {
                Button(exporting ? "Preparing backup…" : "Save a backup") { export() }
                    .disabled(exporting || !session.online)
            } header: { Text("Your data") } footer: {
                Text("The backup contains your companion, conversation, and memories. It does not include connection keys. Choose a private location when saving.")
            }
            if let error { Section { ErrorText(message: error) } }
            Section {
                Button(disconnecting ? "Disconnecting…" : "Disconnect this phone", role: .destructive) { confirmDisconnect = true }
                    .disabled(disconnecting || session.sending)
                Button("Forget connection on this phone", role: .destructive) { confirmForget = true }
                    .disabled(disconnecting || session.sending)
            } footer: {
                Text("Disconnect revokes this phone’s access on your computer. Forget works offline; revoke the device in the computer’s Settings later. Neither deletes your companion.")
            }
            Section { Text("GlasHaus · 0.1.0").font(.footnote).foregroundStyle(.secondary) }
                .listRowBackground(Color.clear)
        }
        .navigationTitle("Settings").refreshable { await session.refresh() }
        .sheet(item: $editor) { editor in
            NavigationStack {
                switch editor {
                case .identity:
                    if let companion = session.snapshot?.companion { IdentityEditor(companion: companion) }
                case .voice:
                    if let companion = session.snapshot?.companion { VoiceEditor(companion: companion) }
                case .model:
                    if let settings = session.snapshot?.settings { ModelSettings(settings: settings) }
                }
            }
        }
        .confirmationDialog("Disconnect this phone?", isPresented: $confirmDisconnect, titleVisibility: .visible) {
            Button("Disconnect", role: .destructive) { disconnect(revoke: true) }
        } message: { Text("You’ll need a new pairing code to reconnect. Your companion stays on the computer.") }
        .confirmationDialog("Forget this connection?", isPresented: $confirmForget, titleVisibility: .visible) {
            Button("Forget connection", role: .destructive) { disconnect(revoke: false) }
        } message: { Text("This removes the phone’s key and pending retry. Revoke its access separately on the computer.") }
        .fileExporter(isPresented: $showExport, document: archive, contentType: .json, defaultFilename: "glashaus-backup") { result in
            archive = ArchiveDocument()
            if case .failure(let failure) = result { error = failure.localizedDescription }
        }
    }
    private func export() {
        exporting = true; error = nil
        Task {
            defer { exporting = false }
            do {
                guard let client = session.client else { return }
                archive = ArchiveDocument(data: try await client.data("export")); showExport = true
            } catch { self.error = error.localizedDescription }
        }
    }
    private func disconnect(revoke: Bool) {
        disconnecting = true; error = nil
        Task {
            defer { disconnecting = false }
            do { try await session.disconnect(revoke: revoke) }
            catch { self.error = error.localizedDescription }
        }
    }
}

struct ArchiveDocument: FileDocument {
    static var readableContentTypes: [UTType] { [.json] }
    var data = Data()
    init(data: Data = Data()) { self.data = data }
    init(configuration: ReadConfiguration) throws { data = configuration.file.regularFileContents ?? Data() }
    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper { FileWrapper(regularFileWithContents: data) }
}

struct IdentityEditor: View {
    @EnvironmentObject private var session: Session
    @State private var companion: Companion
    init(companion: Companion) { _companion = State(initialValue: companion) }
    var body: some View {
        SavedForm(title: "Identity & relationship", save: { try await session.saveIdentity(companion) }) {
            Section("Names") {
                TextField("Companion name", text: $companion.name)
                TextField("Pronouns", text: $companion.pronouns)
                TextField("Your name", text: $companion.userName)
            }
            TextSection(title: "Relationship", text: $companion.relationship, limit: 6000,
                        help: "Describe how you relate and whether first-person roleplay belongs in your conversations.")
            TextSection(title: "Personality", text: $companion.personality, limit: 8000)
            TextSection(title: "Values", text: $companion.values, limit: 4000)
            TextSection(title: "Background", text: $companion.backstory, limit: 8000,
                        help: "Authored character background is separate from shared conversation history.")
            TextSection(title: "Summary", text: $companion.summary, limit: 2000)
        }
    }
}
struct VoiceEditor: View {
    @EnvironmentObject private var session: Session
    @State private var companion: Companion
    @State private var continuity: Continuity
    init(companion: Companion) {
        _companion = State(initialValue: companion)
        _continuity = State(initialValue: companion.continuity ?? Continuity())
    }
    var body: some View {
        SavedForm(title: "Voice & continuity", save: {
            var value = companion; value.continuity = continuity
            try await session.saveIdentity(value)
        }) {
            TextSection(title: "Voice", text: $companion.voice, limit: 5000,
                        help: "Rhythm, humor, affection, and habits. Ordinary speech is direct and unquoted; self-actions use first person.")
            TextSection(title: "About you", text: $continuity.userContext, limit: 4000,
                        help: "Keep sources and uncertainty alongside imported details.")
            TextSection(title: "Shared language", text: $continuity.lexicon, limit: 4000)
            TextSection(title: "Dialogue examples", text: $continuity.dialogue, limit: 6000,
                        help: "Examples guide the voice. Label authentic excerpts and demonstrations; neither becomes a new conversation turn.")
        }
    }
}
struct ModelSettings: View {
    @EnvironmentObject private var session: Session
    @State private var settings: PhoneSettings
    @State private var models: [ModelInfo] = []
    @State private var modelError: String?
    init(settings: PhoneSettings) { _settings = State(initialValue: settings) }
    var body: some View {
        SavedForm(title: "Model & memory", save: { try await session.saveSettings(settings) }) {
            Section {
                TextField("Conversation model", text: $settings.model).textInputAutocapitalization(.never).autocorrectionDisabled()
                if !models.isEmpty {
                    Picker("Choose an available model", selection: $settings.model) {
                        if !models.contains(where: { $0.name == settings.model }) { Text(settings.model.isEmpty ? "Choose…" : settings.model).tag(settings.model) }
                        ForEach(models) { Text($0.name).tag($0.name) }
                    }
                }
                TextField("Utility model (optional)", text: $settings.utilityModel).textInputAutocapitalization(.never).autocorrectionDisabled()
            } header: { Text("Ollama") } footer: {
                Text("Use the exact model name available on your computer. The utility model reviews voice and memories; leave it blank to use the conversation model.")
            }
            if let modelError { Section { ErrorText(message: modelError) } }
            Section {
                Picker("Context size", selection: $settings.contextSize) {
                    if ![4096,8192,16384,32768,65536,131072].contains(settings.contextSize) { Text("\(settings.contextSize)").tag(settings.contextSize) }
                    ForEach([4096,8192,16384,32768,65536,131072], id: \.self) { Text($0.formatted()).tag($0) }
                }
            } footer: { Text("Larger contexts leave more room for persona and recent conversation, but require more memory on the computer.") }
            Section {
                Toggle("Evening reflections", isOn: $settings.reflectionEnabled)
            } footer: { Text("When enabled, GlasHaus writes a journal entry after 9 pm in your computer’s time zone. Conversation memory is still gathered when this is off.") }
        }
        .task {
            do { if let client = session.client { models = try await client.get("models") } }
            catch { modelError = "Could not load models. You can still enter a model name." }
        }
    }
}

private struct TextSection: View {
    let title: String
    @Binding var text: String
    let limit: Int
    var help = ""
    var body: some View {
        Section {
            TextEditor(text: $text).frame(minHeight: 130).accessibilityLabel(title)
        } header: { Text(title) } footer: {
            VStack(alignment: .leading, spacing: 6) {
                if !help.isEmpty { Text(help) }
                Text("\(text.utf16.count) / \(limit) characters").foregroundStyle(text.utf16.count > limit ? Color.red : Color.secondary)
            }
        }
    }
}

private struct SavedForm<Content: View>: View {
    @Environment(\.dismiss) private var dismiss
    let title: String
    let save: () async throws -> Void
    @ViewBuilder let content: () -> Content
    @State private var error: String?
    @State private var saving = false
    @State private var discard = false
    var body: some View {
        Form {
            content()
            if let error { Section { ErrorText(message: error) } }
        }
        .disabled(saving)
        .navigationTitle(title).navigationBarTitleDisplayMode(.inline).interactiveDismissDisabled()
        .toolbar {
            ToolbarItem(placement: .cancellationAction) { Button("Cancel") { discard = true }.disabled(saving) }
            ToolbarItem(placement: .confirmationAction) {
                Button(saving ? "Saving…" : "Save") {
                    saving = true; error = nil
                    Task {
                        defer { saving = false }
                        do { try await save(); dismiss() }
                        catch { self.error = error.localizedDescription }
                    }
                }.disabled(saving)
            }
        }
        .confirmationDialog("Discard unsaved edits?", isPresented: $discard, titleVisibility: .visible) {
            Button("Discard edits", role: .destructive) { dismiss() }
        }
    }
}
