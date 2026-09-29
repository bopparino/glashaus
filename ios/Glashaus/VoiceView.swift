import SwiftUI
import AVFoundation
import Speech

@MainActor @Observable final class VoiceSession: NSObject, AVAudioPlayerDelegate {
    var phase = "Ready"
    var transcript = ""
    var error = ""
    var active = false
    var speaking = false
    private let engine = AVAudioEngine()
    private var recognition: SFSpeechRecognitionTask?
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var player: AVAudioPlayer?
    private var silence: Task<Void, Never>?
    private var listeningLimit: Task<Void, Never>?
    private var work: Task<Void, Never>?
    private var installedTap = false
    private var generation = UUID()
    private weak var model: CompanionModel?
    func start(_ model: CompanionModel) async {
        self.model = model; error = ""
        guard model.snapshot?.voice?.ready == true else { error = "Choose a voice and save your ElevenLabs key in Voice settings first."; return }
        let microphone = await AVAudioApplication.requestRecordPermission()
        let speech = await withCheckedContinuation { continuation in SFSpeechRecognizer.requestAuthorization { continuation.resume(returning: $0) } }
        guard microphone && speech == .authorized else { error = "Allow Microphone and Speech Recognition for Glashaus in iPhone Settings."; return }
        active = true; await listen()
    }
    func interrupt() async {
        generation = UUID(); work?.cancel(); player?.stop(); speaking = false
        if model?.sending == true { model?.stop(); active = false; phase = "Reply stopped"; return }
        if active { await listen() }
    }
    private func listen() async {
        guard active else { return }; stopListening(); transcript = ""; phase = "Listening"; error = ""
        guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US")), recognizer.isAvailable, recognizer.supportsOnDeviceRecognition else { active = false; phase = "Unavailable"; error = "On-device English speech recognition is unavailable. Check the iPhone’s speech language downloads, or use text chat."; return }
        do {
            let audio = AVAudioSession.sharedInstance()
            try audio.setCategory(.playAndRecord, mode: .voiceChat, options: [.defaultToSpeaker, .allowBluetoothHFP]); try audio.setActive(true)
            let request = SFSpeechAudioBufferRecognitionRequest(); request.shouldReportPartialResults = true; request.requiresOnDeviceRecognition = true
            self.request = request
            let input = engine.inputNode, format = input.outputFormat(forBus: 0)
            guard format.sampleRate > 0, format.channelCount > 0 else { throw ClientError.message("No microphone is available. Check your audio device.") }
            input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in request.append(buffer) }; installedTap = true
            let run = UUID(); generation = run
            recognition = recognizer.recognitionTask(with: request) { [weak self] result, failure in
                Task { @MainActor [weak self] in
                    guard let self, self.active, self.generation == run else { return }
                    if let result {
                        let text = result.bestTranscription.formattedString
                        if !text.isEmpty && text != self.transcript { self.transcript = text; self.silence?.cancel(); self.silence = Task { try? await Task.sleep(for: .seconds(1.6)); guard !Task.isCancelled else { return }; self.submit() } }
                        if result.isFinal && !text.isEmpty { self.submit() }
                    } else if failure != nil { self.stop(); self.error = "Speech recognition stopped. Tap Start to try again." }
                }
            }
            engine.prepare(); try engine.start()
            listeningLimit = Task { try? await Task.sleep(for: .seconds(45)); guard !Task.isCancelled, self.generation == run else { return }; if self.transcript.isEmpty { self.stop() } else { self.submit() } }
        } catch { stop(); self.error = error.localizedDescription }
    }
    func submit() {
        guard active, let model, phase == "Listening" else { return }
        let text = transcript.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }; stopListening(); phase = "Thinking"; generation = UUID(); let run = generation
        work = Task {
            guard model.canAct, model.pending == nil, !model.sending else { self.stop(); self.error = "Finish the pending text reply before starting voice."; return }
            model.composer = text; model.send(); let id = model.pending?.id
            while model.sending && !Task.isCancelled { try? await Task.sleep(for: .milliseconds(150)) }
            guard !Task.isCancelled, self.active, self.generation == run else { return }
            guard let id, model.history.contains(where: { $0.id == id && $0.status == "complete" }) else { self.stop(); self.error = "The reply did not finish. Reconnect and retry it in Conversation."; return }
            self.phase = "Preparing voice"
            do {
                let data = try await model.audio(body: ["turnId": id])
                try Task.checkCancellation(); guard self.active, self.generation == run else { return }
                let player = try AVAudioPlayer(data: data); self.player = player; player.delegate = self
                self.phase = "Speaking"; self.speaking = true
                guard player.play() else { throw ClientError.message("Audio playback could not start.") }
            } catch { if !Task.isCancelled { self.stop(); self.error = error.localizedDescription } }
        }
    }
    private func stopListening() {
        silence?.cancel(); silence = nil; listeningLimit?.cancel(); listeningLimit = nil; engine.stop()
        if installedTap { engine.inputNode.removeTap(onBus: 0); installedTap = false }
        request?.endAudio(); recognition?.cancel(); recognition = nil; request = nil
    }
    func stop() {
        generation = UUID(); active = false; speaking = false; work?.cancel(); work = nil; stopListening(); player?.stop(); player = nil; phase = "Ready"
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
    nonisolated func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) { Task { @MainActor in self.speaking = false; if self.active { await self.listen() } } }
}

struct VoiceView: View {
    @Bindable var model: CompanionModel
    @State private var voice = VoiceSession()
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    private var configured: Bool { model.snapshot?.voice?.ready == true }
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    Text(model.name).font(.largeTitle.weight(.semibold))
                    Label(configured ? voice.phase : "Choose a voice to begin", systemImage: voice.speaking ? "waveform" : voice.active ? "mic" : "mic.slash").font(.title2).accessibilityAddTraits(.updatesFrequently).accessibilityIdentifier("voicePhase")
                    if !voice.transcript.isEmpty { Text(voice.transcript).font(.body).textSelection(.enabled) }
                    if !voice.error.isEmpty { Text(voice.error).font(.subheadline) }
                    if voice.active {
                        if voice.phase == "Listening" { Button("Send now") { voice.submit() }.disabled(voice.transcript.isEmpty).frame(minHeight: 44) }
                        else { Button("Interrupt") { Task { await voice.interrupt() } }.frame(minHeight: 44) }
                        Button("End voice chat", role: .destructive) { voice.stop() }.frame(minHeight: 44)
                    } else if configured { Button { Task { await voice.start(model) } } label: { Label("Start voice chat", systemImage: "mic.fill").frame(minHeight: 44) }.disabled(!model.canAct || model.sending || model.pending != nil) }
                    NavigationLink("Voice settings") { VoiceSettingsView(model: model) }
                    Text("Your iPhone transcribes speech on device. \(model.name)’s reply text goes to ElevenLabs for audio. Pauses send your words; End stops the microphone. Voice pauses when you leave the app.").font(.footnote).foregroundStyle(FieldStyle.secondaryInk)
                }.padding(24).frame(maxWidth: .infinity, alignment: .leading)
            }.pastoralBackground(reading: true).navigationTitle("Voice").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Done") { voice.stop(); dismiss() } } }
        }.tint(FieldStyle.ink).foregroundStyle(FieldStyle.ink)
            .onReceive(NotificationCenter.default.publisher(for: AVAudioSession.interruptionNotification)) { _ in voice.stop() }
            .onReceive(NotificationCenter.default.publisher(for: AVAudioSession.routeChangeNotification)) { note in
                if let reason = note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt, reason == AVAudioSession.RouteChangeReason.oldDeviceUnavailable.rawValue { voice.stop() }
            }.onDisappear { voice.stop() }.onChange(of: scenePhase) { _, phase in if phase != .active { voice.stop() } }
    }
}

struct VoiceSettingsView: View {
    @Bindable var model: CompanionModel
    @State private var settings: IntegrationSettings?
    @State private var voices: [CloudVoice] = []
    @State private var key = ""
    @State private var selected = ""
    @State private var engine = "eleven_flash_v2_5"
    @State private var limit = 100_000
    @State private var busy = false
    @State private var message = ""
    @State private var player: AVAudioPlayer?
    var body: some View {
        Form {
            Section {
                SecureField("API key", text: $key, prompt: Text(settings?.voice.hasKey == true ? "API key saved · enter to replace" : "API key").foregroundColor(FieldStyle.secondaryInk)).textContentType(.password)
                Button("Save key and load voices") { Task { await save(loadVoices: true) } }.disabled(busy || settings == nil)
                if !voices.isEmpty { Picker("\(model.name)’s voice", selection: $selected) { Text("Choose a voice").tag(""); ForEach(voices) { Text($0.name).tag($0.id) } } }
                else if !selected.isEmpty { Text("Selected voice: \(selected)").font(.caption) }
                Picker("Voice model", selection: $engine) { Text("Flash").tag("eleven_flash_v2_5"); Text("Multilingual").tag("eleven_multilingual_v2") }
            } header: { Text("ElevenLabs") } footer: { Text("Flash favors faster replies. Multilingual favors expressive delivery. Hear a sample before choosing.") }
            Section {
                Stepper("\(limit.formatted()) characters / month", value: $limit, in: 1000...100_000, step: 1000)
                if let status = model.snapshot?.voice { Text("\(status.used.formatted()) characters reserved this month").font(.caption) }
            } header: { Text("Usage ceiling") } footer: { Text("Glashaus stops at this ceiling and checks your included provider allowance. Choose a plan within your $25 budget and leave provider overage billing off. This limit counts attempted audio, including interrupted requests.") }
            Section {
                Button("Save voice") { Task { await save(loadVoices: false) } }.disabled(busy || settings == nil || selected.isEmpty)
                Button("Hear a sample") { Task {
                    busy = true; defer { busy = false }; do { await save(loadVoices: false, ownsBusy: false); if !message.hasPrefix("Saved") { return }; let data = try await model.audio(body: ["preview": true]); try AVAudioSession.sharedInstance().setCategory(.playback); try AVAudioSession.sharedInstance().setActive(true); player = try AVAudioPlayer(data: data); player?.play(); await model.refresh() } catch { message = error.localizedDescription }
                } }.disabled(busy || selected.isEmpty || settings?.voice.hasKey != true)
                if busy { ProgressView() }
                if !message.isEmpty { Text(message).font(.subheadline) }
            }
            Section { Link("ElevenLabs API settings", destination: URL(string: "https://elevenlabs.io/app/developers/api-keys")!); Text("The key stays on your Mac. Glashaus uses the same conversation model and memory for text and voice; ElevenLabs synthesizes the spoken reply.").font(.footnote) }
        }.pastoralBackground(reading: true).navigationTitle("Voice settings").navigationBarTitleDisplayMode(.inline)
            .task { do { let s: IntegrationSettings = try await model.fetch("/integrations"); settings = s; selected = s.voice.voiceId; engine = s.voice.model; limit = s.voice.monthlyCharacters; if s.voice.hasKey { let list: VoiceList = try await model.fetch("/voice/voices"); voices = list.voices } } catch { message = error.localizedDescription } }
            .onDisappear { player?.stop(); try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation) }
    }
    private func save(loadVoices: Bool, ownsBusy: Bool = true) async {
        guard let settings else { return }; if ownsBusy { busy = true }; defer { if ownsBusy { busy = false } }
        var voice: [String: Any] = ["voiceId": selected, "model": engine, "monthlyCharacters": limit]; if !key.isEmpty { voice["apiKey"] = key }
        do { self.settings = try await model.fetch("/integrations", method: "PATCH", body: ["revision": settings.revision, "voice": voice]); key = ""; message = "Saved voice settings."; if loadVoices { let list: VoiceList = try await model.fetch("/voice/voices"); voices = list.voices }; await model.refresh() } catch { message = error.localizedDescription }
    }
}
