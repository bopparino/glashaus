import SwiftUI
import AppKit
import PDFKit
import QuickLookUI
import UniformTypeIdentifiers

struct LibraryFile: Codable, Identifiable, Hashable {
    let id: String
    let name: String
    let mime: String
    let size: Int
    let kind: String
}
struct WorkTask: Decodable, Identifiable {
    let id: String
    let title: String
    let status: String
    let stage: String
    let error: String
    let outputIds: [String]
    let turnId: String?
    var active: Bool { status == "queued" || status == "running" }
}
struct ChatTurn: Decodable, Identifiable {
    let id: String
    let userText: String
    let reply: String
    let status: String
    let error: String
    let attachments: [LibraryFile]?
}
struct DesktopState: Decodable {
    struct Companion: Decodable { let id: String; let name: String; let userName: String }
    let companion: Companion?
    let turns: [ChatTurn]
    let csrfToken: String
}
struct WorkspaceState: Decodable {
    struct Sandbox: Decodable { let ready: Bool; let message: String }
    let files: [LibraryFile]
    let tasks: [WorkTask]
    let sandbox: Sandbox
}
enum Destination: String, CaseIterable, Identifiable {
    case home = "Home", conversation = "Conversation", library = "Library", tasks = "Tasks", settings = "Settings"
    var id: String { rawValue }
    var icon: String { switch self { case .home: "house"; case .conversation: "bubble.left"; case .library: "books.vertical"; case .tasks: "checklist"; case .settings: "gearshape" } }
}
struct PendingChat: Codable { let id: String; let text: String; let attachmentIds: [String] }

@MainActor @Observable final class DesktopModel {
    var state: DesktopState?
    var workspace: WorkspaceState?
    var destination: Destination? = .conversation
    var composer = ""
    var attachments: [LibraryFile] = []
    var sending = false
    var uploading = false
    var preparingSandbox = false
    var reply = ""
    var progress = ""
    var error: String?
    var preview: LibraryFile?
    var previewURL: URL?
    var pending: PendingChat?
    var endpoint = UserDefaults.standard.string(forKey: "desktopEndpoint") ?? ProcessInfo.processInfo.environment["GLASHAUS_DESKTOP_URL"] ?? "http://127.0.0.1:7783"
    private var replyTask: Task<Void, Never>?
    private var ownedService: Process?
    private var previewGeneration = UUID()
    var companionName: String { state?.companion?.name ?? "Glashaus" }
    var clearedThrough: String {
        get { UserDefaults.standard.string(forKey: "desktopClearedThrough:\(endpoint)") ?? "" }
        set { UserDefaults.standard.set(newValue, forKey: "desktopClearedThrough:\(endpoint)") }
    }
    var visibleTurns: [ChatTurn] {
        let turns = state?.turns ?? []
        if let index = turns.firstIndex(where: { $0.id == clearedThrough }) { return Array(turns.dropFirst(index + 1)) }
        return turns
    }
    func url(_ route: String) throws -> URL {
        guard let base = URL(string: endpoint), base.scheme == "http", ["127.0.0.1", "localhost"].contains(base.host ?? ""), base.user == nil, base.password == nil, let result = URL(string: endpoint + route) else { throw failure("Use this Mac’s localhost address, for example http://127.0.0.1:7783.") }
        return result
    }
    func failure(_ message: String) -> NSError { NSError(domain: "Glashaus", code: 1, userInfo: [NSLocalizedDescriptionKey: message]) }
    func request(_ route: String, method: String = "GET", body: [String: Any]? = nil) throws -> URLRequest {
        var req = URLRequest(url: try url(route)); req.timeoutInterval = 30; req.httpMethod = method
        if let body { req.httpBody = try JSONSerialization.data(withJSONObject: body); req.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        if method != "GET" { req.setValue(state?.csrfToken ?? "", forHTTPHeaderField: "x-glashaus-token") }
        return req
    }
    func data(_ route: String, method: String = "GET", body: [String: Any]? = nil) async throws -> Data {
        let (data, response) = try await URLSession.shared.data(for: request(route, method: method, body: body))
        guard let response = response as? HTTPURLResponse, (200..<300).contains(response.statusCode) else {
            let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
            throw failure(object?["error"] as? String ?? "The Mac service could not complete this request.")
        }
        return data
    }
    func refresh(report: Bool = false) async {
        do {
            let next = try JSONDecoder().decode(DesktopState.self, from: await data("/api/state"))
            if let previous = state?.companion?.id, next.companion?.id != previous {
                pending = nil; persistPending(); attachments = []; preview = nil; previewURL = nil
                try? FileManager.default.removeItem(at: FileManager.default.temporaryDirectory.appendingPathComponent("Glashaus-\(ProcessInfo.processInfo.processIdentifier)"))
            }
            state = next
            workspace = try JSONDecoder().decode(WorkspaceState.self, from: await data("/api/workspace"))
            if report { error = nil }
        } catch { if report || state == nil { self.error = error.localizedDescription } }
    }
    func start() async {
        restorePending()
        do { _ = try await data("/api/health") }
        catch { await startBundledService() }
        await refresh(report: true)
        #if DEBUG
        if let destination = ProcessInfo.processInfo.environment["GLASHAUS_REVIEW_DESTINATION"] { self.destination = Destination(rawValue: destination) ?? .conversation }
        if ProcessInfo.processInfo.environment["GLASHAUS_REVIEW_PREVIEW"] == "1", let file = workspace?.files.first(where: { $0.mime == "application/pdf" }) { show(file) }
        if let capture = ProcessInfo.processInfo.environment["GLASHAUS_REVIEW_CAPTURE"] {
            try? await Task.sleep(for: .seconds(2))
            if let window = NSApplication.shared.windows.first {
                window.setContentSize(NSSize(width: Double(ProcessInfo.processInfo.environment["GLASHAUS_REVIEW_WIDTH"] ?? "1440") ?? 1440, height: 920)); window.center(); NSApp.activate(ignoringOtherApps: true)
                try? await Task.sleep(for: .seconds(1))
                let shot = Process(); shot.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture"); shot.arguments = ["-x", "-l", String(window.windowNumber), capture]; try? shot.run()
            }
        }
        #endif
        while !Task.isCancelled {
            try? await Task.sleep(for: .seconds(3))
            if Task.isCancelled { break }
            await refresh()
        }
    }
    func startBundledService() async {
        guard ownedService == nil, let resources = Bundle.main.resourceURL else { return }
        let binary = resources.appendingPathComponent("runtime/node")
        guard FileManager.default.isExecutableFile(atPath: binary.path) else { return }
        let process = Process(); process.executableURL = binary
        process.arguments = [resources.appendingPathComponent("runtime/dist/server/main.js").path]
        var env = ProcessInfo.processInfo.environment
        env["GLASHAUS_PORT"] = URL(string: endpoint)?.port.map(String.init) ?? "7783"
        env["GLASHAUS_HOME"] = env["GLASHAUS_HOME"] ?? FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".glashaus-v3").path
        env["GLASHAUS_OPEN"] = "0"
        process.environment = env
        process.standardOutput = FileHandle.nullDevice; process.standardError = FileHandle.nullDevice
        do { try process.run(); ownedService = process; try? await Task.sleep(for: .seconds(2)) }
        catch { self.error = "The bundled Mac service could not start: \(error.localizedDescription)" }
    }
    func prepareSandbox() {
        guard !preparingSandbox, let resources = Bundle.main.resourceURL else { return }
        let executable = URL(fileURLWithPath: "/Applications/Docker.app/Contents/Resources/bin/docker")
        guard FileManager.default.isExecutableFile(atPath: executable.path) else { error = "Install and open Docker Desktop, then prepare the local tools."; return }
        preparingSandbox = true
        Task {
            defer { preparingSandbox = false }
            let process = Process(); process.executableURL = executable
            process.arguments = ["build", "--tag", "glashaus-workspace:1", resources.appendingPathComponent("runtime/tool-runtime").path]
            let log = FileManager.default.temporaryDirectory.appendingPathComponent("glashaus-sandbox-setup.log")
            FileManager.default.createFile(atPath: log.path, contents: nil, attributes: [.posixPermissions: 0o600])
            guard let handle = try? FileHandle(forWritingTo: log) else { error = "The setup log could not be opened."; return }
            process.standardOutput = handle; process.standardError = handle
            let status: Int32 = await withCheckedContinuation { continuation in
                process.terminationHandler = { continuation.resume(returning: $0.terminationStatus) }
                do { try process.run() } catch { continuation.resume(returning: -1) }
            }
            try? handle.close()
            if status != 0 { error = "Tool setup failed. Open Docker Desktop and retry. Details are in \(log.path)." }
            await refresh()
        }
    }
    func openWeb(_ route: String = "/") { if let u = try? url(route) { NSWorkspace.shared.open(u) } }
    private var pendingURL: URL {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("Glashaus Desktop", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        return dir.appendingPathComponent("pending-\(URL(string: endpoint)?.port ?? 7783).json")
    }
    func restorePending() { if let bytes = try? Data(contentsOf: pendingURL) { pending = try? JSONDecoder().decode(PendingChat.self, from: bytes) } }
    func persistPending() {
        if let pending, let bytes = try? JSONEncoder().encode(pending) { try? bytes.write(to: pendingURL, options: .atomic); try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: pendingURL.path) }
        else { try? FileManager.default.removeItem(at: pendingURL) }
    }
    func send() {
        guard !sending, !uploading, !composer.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        pending = PendingChat(id: "mac:\(UUID().uuidString)", text: composer, attachmentIds: attachments.map(\.id)); persistPending()
        composer = ""; attachments = []; retry()
    }
    func retry() {
        guard !sending, let message = pending else { return }
        sending = true; reply = ""; error = nil; progress = "\(companionName) is thinking…"
        replyTask = Task {
            defer { sending = false; progress = "" }
            do {
                var req = try request("/api/chat", method: "POST", body: ["id": message.id, "text": message.text, "attachmentIds": message.attachmentIds]); req.timeoutInterval = 150
                let (stream, response) = try await URLSession.shared.bytes(for: req)
                guard let response = response as? HTTPURLResponse, response.statusCode == 200 else { throw failure("The reply could not start. Reconnect and retry; your message is saved.") }
                var complete = false
                for try await line in stream.lines {
                    try Task.checkCancellation()
                    guard let object = try JSONSerialization.jsonObject(with: Data(line.utf8)) as? [String: Any] else { continue }
                    switch object["type"] as? String {
                    case "token": reply += object["text"] as? String ?? ""
                    case "status": progress = object["text"] as? String ?? ""
                    case "error": throw failure(object["error"] as? String ?? object["text"] as? String ?? "The reply stopped. Try again.")
                    case "done": complete = true
                    default: break
                    }
                }
                guard complete else { throw failure("The connection ended before the reply finished. Your message is saved for retry.") }
                pending = nil; persistPending(); reply = ""; await refresh()
            } catch { self.error = Task.isCancelled ? "Reply stopped. Your message is ready to retry." : error.localizedDescription }
        }
    }
    func stopReply() { replyTask?.cancel() }
    func clearView() { clearedThrough = state?.turns.last?.id ?? ""; state = state.map { $0 }; }
    func chooseImage() {
        let panel = NSOpenPanel(); panel.allowedContentTypes = [.image]; panel.allowsMultipleSelection = true
        panel.begin { [weak self] result in
            guard result == .OK else { return }
            Task { @MainActor in
                guard let self else { return }; self.uploading = true; defer { self.uploading = false }
                do {
                    guard self.attachments.count + panel.urls.count <= 3 else { throw self.failure("Attach up to three images per message.") }
                    for url in panel.urls {
                        guard let source = NSImage(contentsOf: url) else { throw self.failure("This image could not be opened.") }
                        let scale = min(1, 1600 / max(source.size.width, source.size.height)); let size = NSSize(width: source.size.width * scale, height: source.size.height * scale)
                        let target = NSImage(size: size); target.lockFocus(); NSColor.white.setFill(); NSRect(origin: .zero, size: size).fill(); source.draw(in: NSRect(origin: .zero, size: size)); target.unlockFocus()
                        guard let tiff = target.tiffRepresentation, let bitmap = NSBitmapImageRep(data: tiff), let jpeg = bitmap.representation(using: .jpeg, properties: [.compressionFactor: 0.85]) else { throw self.failure("This image could not be prepared.") }
                        let bytes = try await self.data("/api/workspace/images", method: "POST", body: ["name": url.deletingPathExtension().lastPathComponent + ".jpg", "data": jpeg.base64EncodedString()])
                        self.attachments.append(try JSONDecoder().decode(LibraryFile.self, from: bytes))
                    }
                } catch { self.error = error.localizedDescription }
            }
        }
    }
    func show(_ file: LibraryFile) {
        let generation = UUID(); previewGeneration = generation; preview = file; previewURL = nil
        Task {
            do {
                let bytes = try await data("/api/workspace/files/\(file.id)")
                guard previewGeneration == generation else { return }
                let folder = FileManager.default.temporaryDirectory.appendingPathComponent("Glashaus-\(ProcessInfo.processInfo.processIdentifier)", isDirectory: true)
                try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
                let url = folder.appendingPathComponent(file.id + "-" + file.name)
                try bytes.write(to: url, options: .atomic); try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
                previewURL = url
            } catch { self.error = error.localizedDescription }
        }
    }
    func savePreview() {
        guard let source = previewURL, let file = preview else { return }
        let panel = NSSavePanel(); panel.nameFieldStringValue = file.name
        panel.begin { result in
            guard result == .OK, let destination = panel.url else { return }
            do { try Data(contentsOf: source).write(to: destination, options: .atomic) }
            catch { Task { @MainActor in self.error = error.localizedDescription } }
        }
    }
    func sharePreview() {
        guard let url = previewURL, let view = NSApp.keyWindow?.contentView else { return }
        NSSharingServicePicker(items: [url]).show(relativeTo: NSRect(x: view.bounds.maxX - 100, y: view.bounds.maxY - 50, width: 1, height: 1), of: view, preferredEdge: .minY)
    }
    func taskAction(_ task: WorkTask, _ action: String) { Task { do { _ = try await data("/api/workspace/tasks/\(task.id)/\(action)", method: "POST", body: ["requestId": UUID().uuidString]); await refresh() } catch { self.error = error.localizedDescription } } }
    func deleteFile(_ file: LibraryFile) { Task { do { _ = try await data("/api/workspace/files/\(file.id)", method: "DELETE"); if preview?.id == file.id { preview = nil; previewURL = nil }; await refresh() } catch { self.error = error.localizedDescription } } }
}

private let ground = Color(red: 0.10, green: 0.11, blue: 0.10)
private let bone = Color(red: 0.91, green: 0.90, blue: 0.86)
private let rust = Color(red: 0.57, green: 0.23, blue: 0.16)

@main struct GlashausDesktop: App {
    @State private var model = DesktopModel()
    var body: some Scene {
        WindowGroup("Glashaus") { DesktopRoot(model: model).frame(minWidth: 900, minHeight: 600).preferredColorScheme(.dark).tint(bone).task { await model.start() } }
            .defaultSize(width: 1440, height: 940)
            .commands { CommandGroup(replacing: .newItem) { Button("New message") { model.destination = .conversation }.keyboardShortcut("n") }; CommandGroup(after: .textEditing) { Button("Attach image…") { model.chooseImage() }.keyboardShortcut("o", modifiers: [.command, .shift]) } }
    }
}
struct DesktopRoot: View {
    @Bindable var model: DesktopModel
    @State private var clearConfirmation = false
    @State private var address = ""
    @State private var deleting: LibraryFile?
    @AppStorage("desktopBackdrop") private var backdrop = "PastoralBackdrop"
    var body: some View {
        NavigationSplitView {
            VStack(alignment: .leading, spacing: 20) {
                Text("Glashaus").font(.title2.weight(.medium)).padding(.horizontal, 16).padding(.top, 20)
                List(Destination.allCases, selection: $model.destination) { item in Label(item.rawValue, systemImage: item.icon).foregroundStyle(bone).padding(.vertical, 5).tag(item) }.listStyle(.sidebar).scrollContentBackground(.hidden)
                Text(model.state == nil ? "Connecting…" : "\(model.companionName) is here").font(.caption).foregroundStyle(bone.opacity(0.8)).padding(16)
            }
            .background { if backdrop != "None", let image = NSImage(named: backdrop) { Image(nsImage: image).resizable().scaledToFill().overlay(ground.opacity(0.72)).clipped() } else { ground } }
            .navigationSplitViewColumnWidth(min: 160, ideal: 205, max: 250)
        } detail: {
            GeometryReader { available in
                if model.preview != nil && available.size.width < 850 {
                    previewPane(compact: true)
                        .frame(width: available.size.width, height: available.size.height)
                } else {
                    HSplitView {
                        mainPane.frame(minWidth: 360, idealWidth: 520, maxWidth: 720)
                        if model.preview != nil { previewPane(compact: false) }
                    }.frame(width: available.size.width, height: available.size.height)
                }
            }.navigationTitle(model.destination == .conversation ? model.companionName : model.destination?.rawValue ?? "Glashaus")
        }
        .onChange(of: model.destination) { _, _ in model.preview = nil; model.previewURL = nil }
        .tint(bone).accentColor(bone)
        .foregroundStyle(bone).font(.system(size: 14))
        .confirmationDialog("Remove this file from your library?", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } })) { Button("Remove file", role: .destructive) { if let file = deleting { model.deleteFile(file) }; deleting = nil } } message: { Text("Save a copy first if you want to keep it. This removes it from the shared library on all devices.") }
        .confirmationDialog("Clear the chat view on this Mac?", isPresented: $clearConfirmation) { Button("Clear chat view") { model.clearView() } } message: { Text("Conversation history and memories stay saved. Your iPhone is unchanged.") }
    }
    private var mainPane: some View {
        VStack(spacing: 0) {
                    if let error = model.error {
                        HStack(alignment: .top) { Image(systemName: "exclamationmark.circle"); Text(error).textSelection(.enabled); Spacer(); Button("Dismiss", systemImage: "xmark") { model.error = nil }.labelStyle(.iconOnly) }.font(.callout).padding(12).background(rust.opacity(0.3))
                    }
                    if model.state?.companion == nil {
                        ContentUnavailableView { Label("A home for your companion", systemImage: "house") } description: { Text("Connect to your running Glashaus service, or finish setup to start a new companion.") } actions: { Button("Open setup") { model.openWeb() }; Button("Reconnect") { Task { await model.refresh(report: true) } } }
                    } else {
                        switch model.destination ?? .conversation {
                        case .conversation: conversation
                        case .home: home
                        case .library: library
                        case .tasks: tasks
                        case .settings: settings
                        }
                    }
                }.frame(minWidth: 320, idealWidth: 520, maxWidth: .infinity, maxHeight: .infinity).background(ground)
    }
    @ViewBuilder private func previewPane(compact: Bool) -> some View {
        if let file = model.preview {
                    VStack(spacing: 0) {
                        HStack { Text(file.name).font(.headline).lineLimit(1).frame(minWidth: 0, maxWidth: .infinity, alignment: .leading).layoutPriority(-1); Button("Save As…") { model.savePreview() }.disabled(model.previewURL == nil); Button("Share", systemImage: "square.and.arrow.up") { model.sharePreview() }.labelStyle(.iconOnly).disabled(model.previewURL == nil); Button(compact ? "Back to conversation" : "Close preview", systemImage: compact ? "arrow.left" : "xmark") { model.preview = nil; model.previewURL = nil }.labelStyle(.iconOnly).help(compact ? "Back to conversation" : "Close preview") }.controlSize(.small).padding(12)
                        if let url = model.previewURL { FilePreview(url: url, mime: file.mime).id(file.id) } else { ProgressView("Opening file…").frame(maxWidth: .infinity, maxHeight: .infinity) }
                    }.frame(minWidth: 320, idealWidth: 700, maxWidth: .infinity, maxHeight: .infinity).clipped().background(Color(red: 0.90, green: 0.89, blue: 0.84)).foregroundStyle(ground).tint(ground).colorScheme(.light)
                }
    }
    private var conversation: some View {
        VStack(spacing: 0) {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 28) {
                        if model.visibleTurns.isEmpty && model.pending == nil {
                            VStack(alignment: .leading, spacing: 10) { Text("Room to think.").font(.title2); Text("Talk with \(model.companionName), or attach a photo and ask for a useful plan.").foregroundStyle(.secondary) }.padding(.vertical, 30)
                        }
                        ForEach(model.visibleTurns) { turn in
                            VStack(alignment: .leading, spacing: 12) {
                                Text("You").font(.caption).foregroundStyle(.secondary)
                                ForEach(turn.attachments ?? []) { file in DesktopAttachment(model: model, file: file) }
                                Text(turn.userText).textSelection(.enabled)
                                if !turn.reply.isEmpty { Text(model.companionName).font(.caption).foregroundStyle(.secondary).padding(.top, 8); Text(.init(turn.reply)).textSelection(.enabled) }
                                if !turn.error.isEmpty { Text(turn.error).font(.callout).foregroundStyle(.secondary) }
                                ForEach((model.workspace?.tasks ?? []).filter { $0.turnId == turn.id }) { task in taskRow(task) }
                            }.id(turn.id)
                        }
                        if let pending = model.pending, !model.visibleTurns.contains(where: { $0.id == pending.id }) || model.sending {
                            VStack(alignment: .leading, spacing: 12) { Text("You").font(.caption).foregroundStyle(.secondary); Text(pending.text); if !model.reply.isEmpty { Text(model.companionName).font(.caption).foregroundStyle(.secondary); Text(.init(model.reply)).textSelection(.enabled) } }
                        }
                        Color.clear.frame(height: 1).id("end")
                    }.padding(24).frame(maxWidth: 720, alignment: .leading).frame(maxWidth: .infinity)
                }.onChange(of: model.reply) { proxy.scrollTo("end", anchor: .bottom) }.onChange(of: model.state?.turns.count) { proxy.scrollTo("end", anchor: .bottom) }
            }
            if !model.progress.isEmpty { HStack { ProgressView().controlSize(.small); Text(model.progress).font(.caption); Spacer(); Button("Stop") { model.stopReply() } }.padding(.horizontal, 24).padding(.bottom, 8) }
            if !model.sending, model.pending != nil { HStack { Text("Your unsent message is saved.").font(.caption); Spacer(); Button("Retry") { model.retry() }; Button("Edit") { model.composer = model.pending?.text ?? ""; model.attachments = (model.workspace?.files ?? []).filter { model.pending?.attachmentIds.contains($0.id) == true }; model.pending = nil; model.persistPending() } }.padding(.horizontal, 24).padding(.bottom, 8) }
            if !model.attachments.isEmpty { HStack { ForEach(model.attachments) { file in HStack { Image(systemName: "photo"); Text(file.name).lineLimit(1); Button("Remove \(file.name)", systemImage: "xmark") { model.attachments.removeAll { $0.id == file.id } }.labelStyle(.iconOnly) }.font(.caption) }; Spacer() }.padding(.horizontal, 24).padding(.bottom, 8) }
            HStack(alignment: .bottom, spacing: 12) {
                Menu { Button("Attach image…", systemImage: "photo.badge.plus") { model.chooseImage() }; Divider(); Button("Clear chat view", systemImage: "text.badge.minus") { clearConfirmation = true } } label: { Image(systemName: "plus").font(.title3) }.menuStyle(.borderlessButton).fixedSize().disabled(model.uploading || model.sending)
                TextField("Message \(model.companionName)", text: $model.composer, axis: .vertical).textFieldStyle(.plain).lineLimit(1...5).onSubmit { model.send() }.disabled(model.sending)
                if model.uploading { ProgressView().controlSize(.small) }
                Button { model.send() } label: { Image(systemName: "arrow.up").font(.system(size: 16, weight: .semibold)).frame(width: 28, height: 28) }.buttonStyle(.borderedProminent).tint(bone).foregroundStyle(ground).disabled(model.sending || model.uploading || model.composer.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty).accessibilityLabel("Send message").keyboardShortcut(.return, modifiers: .command)
            }.padding(12).background(bone.opacity(0.06), in: RoundedRectangle(cornerRadius: 10)).padding(.horizontal, 20).padding(.bottom, 18)
        }
    }
    private var home: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                Text("Good to have you here, \(model.state?.companion?.userName ?? "").").font(.largeTitle.weight(.medium))
                Text("Pick up a conversation, check on work in progress, or make something useful together.").foregroundStyle(.secondary)
                HStack { Button("Talk with \(model.companionName)") { model.destination = .conversation }; Button("Review reminders and connected actions") { model.openWeb() } }
                if let active = model.workspace?.tasks.filter({ $0.active }), !active.isEmpty { Text("In progress").font(.title2); ForEach(active) { taskRow($0) } }
                if let files = model.workspace?.files.filter({ $0.kind == "artifact" }).prefix(4), !files.isEmpty { Text("Recently made").font(.title2); ForEach(Array(files)) { fileRow($0) } }
                Spacer(minLength: 40)
            }.padding(32).frame(maxWidth: 900, alignment: .leading).frame(maxWidth: .infinity, alignment: .leading)
        }
    }
    private var library: some View {
        Group {
            if model.workspace?.files.isEmpty != false { ContentUnavailableView("Your files belong here", systemImage: "books.vertical", description: Text("Attach a photo in Conversation, then ask for a PDF and Word plan. Finished files stay here until you remove them.")) }
            else { List(model.workspace?.files ?? []) { fileRow($0) }.scrollContentBackground(.hidden) }
        }
    }
    private func fileRow(_ file: LibraryFile) -> some View {
        HStack(spacing: 12) {
            Image(systemName: file.kind == "image" ? "photo" : file.mime == "application/pdf" ? "doc.richtext" : "doc.text").font(.title2).foregroundStyle(.secondary)
            Button { model.show(file) } label: { VStack(alignment: .leading, spacing: 4) { Text(file.name).lineLimit(2); Text(ByteCountFormatter.string(fromByteCount: Int64(file.size), countStyle: .file)).font(.caption).foregroundStyle(.secondary) } }.buttonStyle(.plain)
            Spacer()
            Menu { Button("Open preview") { model.show(file) }; Button("Remove from library", role: .destructive) { deleting = file } } label: { Image(systemName: "ellipsis") }.menuStyle(.borderlessButton).fixedSize()
        }.padding(.vertical, 9)
    }
    private var tasks: some View {
        VStack(alignment: .leading, spacing: 16) {
            if let sandbox = model.workspace?.sandbox, !sandbox.ready { Text(sandbox.message).font(.callout).padding(20) }
            if model.workspace?.tasks.isEmpty != false { ContentUnavailableView("Nothing in progress", systemImage: "checklist", description: Text("Ask for a document or calculation in Conversation. You can keep chatting while a task runs.")) }
            else { List(model.workspace?.tasks ?? []) { taskRow($0) }.scrollContentBackground(.hidden) }
        }
    }
    private func taskRow(_ task: WorkTask) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack { Text(task.title).font(.headline); Spacer(); if task.active { ProgressView().controlSize(.small) }; Text(task.status.capitalized).font(.caption).foregroundStyle(.secondary) }
            Text(task.stage).foregroundStyle(.secondary)
            if !task.error.isEmpty { Text(task.error).font(.callout).textSelection(.enabled) }
            HStack { if task.active { Button("Cancel") { model.taskAction(task, "cancel") } } else if task.status != "complete" { Button("Retry") { model.taskAction(task, "retry") } }; ForEach((model.workspace?.files ?? []).filter { task.outputIds.contains($0.id) }) { file in Button(file.mime == "application/pdf" ? "Open PDF" : file.mime.contains("wordprocessingml") ? "Open Word" : file.name) { model.show(file) }.lineLimit(1) } }
        }.padding(.vertical, 12)
    }
    private var settings: some View {
        Form {
            Section("Your space") { Picker("Background", selection: $backdrop) { Text("Pastoral").tag("PastoralBackdrop"); Text("Field quiet").tag("FieldQuiet"); Text("Night relay").tag("NightRelay"); Text("Plain charcoal").tag("None") } }
            Section("Mac service") { TextField("Local address", text: $address).onAppear { address = model.endpoint }; Button("Connect") { let previous = model.endpoint; model.endpoint = address; do { _ = try model.url("/api/state"); UserDefaults.standard.set(model.endpoint, forKey: "desktopEndpoint"); model.restorePending(); Task { await model.refresh(report: true) } } catch { model.endpoint = previous; model.error = error.localizedDescription } }.disabled(model.sending || model.pending != nil); Text("This app uses the same companion and history as your paired iPhone.").font(.caption).foregroundStyle(.secondary) }
            Section("Tools") { if model.preparingSandbox { ProgressView("Preparing local tools… This can take a few minutes.") }; Button("Prepare local tools") { model.prepareSandbox() }.disabled(model.preparingSandbox); Link("Install Docker Desktop", destination: URL(string: "https://www.docker.com/products/docker-desktop/")!); LabeledContent("Local sandbox", value: model.workspace?.sandbox.ready == true ? "Ready" : "Not ready"); Button("Open Docker Desktop") { NSWorkspace.shared.open(URL(fileURLWithPath: "/Applications/Docker.app")) }; Text(model.workspace?.sandbox.message ?? "Connect to see tool availability.").font(.caption).foregroundStyle(.secondary) }
            Section("Companion and connections") { Button("Open companion, voice, mail and calendar settings") { model.openWeb() }; Text("These settings are shared with the running Mac service and your iPhone.").font(.caption).foregroundStyle(.secondary) }
        }.formStyle(.grouped)
    }
}
final class FittedPDFView: PDFView {
    private var fittedWidth: CGFloat = 0
    override func layout() {
        super.layout()
        guard abs(bounds.width - fittedWidth) > 0.5, bounds.width > 1, let page = document?.page(at: 0) else { return }
        fittedWidth = bounds.width
        let destination = currentDestination
        scaleFactor = max(0.1, (bounds.width - 24) / page.bounds(for: displayBox).width)
        if let destination { go(to: destination) }
    }
}
struct FilePreview: NSViewRepresentable {
    let url: URL
    let mime: String
    func makeNSView(context: Context) -> NSView {
        if mime == "application/pdf" { let view = FittedPDFView(); view.displayMode = .singlePageContinuous; view.autoScales = true; view.document = PDFDocument(url: url); view.setContentCompressionResistancePriority(.defaultLow, for: .horizontal); view.setContentHuggingPriority(.defaultLow, for: .horizontal); return view }
        let view = QLPreviewView(frame: .zero, style: .normal)!; view.previewItem = url as NSURL; return view
    }
    func sizeThatFits(_ proposal: ProposedViewSize, nsView: NSView, context: Context) -> CGSize? {
        CGSize(width: proposal.width ?? 320, height: proposal.height ?? 500)
    }
    func updateNSView(_ view: NSView, context: Context) {
        if let pdf = view as? PDFView, pdf.document?.documentURL != url { pdf.document = PDFDocument(url: url) }
        if let quick = view as? QLPreviewView { quick.previewItem = url as NSURL }
    }
}

struct DesktopAttachment: View {
    let model: DesktopModel
    let file: LibraryFile
    @State private var image: NSImage?
    var body: some View {
        Button { model.show(file) } label: {
            VStack(alignment: .leading, spacing: 6) {
                if let image { Image(nsImage: image).resizable().scaledToFit().frame(maxHeight: 200).clipShape(RoundedRectangle(cornerRadius: 8)) }
                Label(file.name, systemImage: "photo").font(.caption)
            }
        }.buttonStyle(.plain).task(id: file.id) { if let bytes = try? await model.data("/api/workspace/files/" + file.id) { image = NSImage(data: bytes) } }
    }
}
