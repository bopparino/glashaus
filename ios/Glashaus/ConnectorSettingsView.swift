import SwiftUI

struct ConnectorSettingsView: View {
    @Bindable var model: CompanionModel
    @State private var settings: IntegrationSettings?
    @State private var adding = false
    @State private var error = ""
    var body: some View {
        List {
            ForEach(settings?.connectors ?? []) { connector in NavigationLink { ConnectorEditor(model: model, existing: connector) } label: { VStack(alignment: .leading, spacing: 5) { Text(connector.name); Text("\(connector.tools.count) selected tools").font(.caption).foregroundStyle(FieldStyle.secondaryInk) } } }
            Button("Add tool server") { adding = true }
            if !error.isEmpty { Text(error).font(.subheadline) }
            Section { Text("Connect an MCP server using its Streamable HTTP URL. Tools start disabled. Select each allowed tool, then explicitly choose any reads that may run without review. Other calls become proposals in Home.").font(.footnote) }
        }.pastoralBackground(reading: true).navigationTitle("Tool servers").navigationBarTitleDisplayMode(.inline)
            .task { await load() }
            .sheet(isPresented: $adding, onDismiss: { Task { await load() } }) { NavigationStack { ConnectorEditor(model: model, existing: nil) } }
    }
    private func load() async { do { settings = try await model.fetch("/integrations") } catch { self.error = error.localizedDescription } }
}
struct ConnectorEditor: View {
    @Bindable var model: CompanionModel
    let existing: IntegrationSettings.Connector?
    @Environment(\.dismiss) private var dismiss
    @State private var settings: IntegrationSettings?
    @State private var name = ""
    @State private var url = ""
    @State private var token = ""
    @State private var identifier = UUID().uuidString
    @State private var tools: [MCPTool] = []
    @State private var selected = Set<String>()
    @State private var reads = Set<String>()
    @State private var busy = false
    @State private var message = ""
    @State private var removing = false
    var body: some View {
        Form {
            Section("Server") { TextField("Name", text: $name, prompt: Text("Name").foregroundColor(FieldStyle.secondaryInk)); TextField("Server URL", text: $url, prompt: Text("https://…/mcp").foregroundColor(FieldStyle.secondaryInk)).textInputAutocapitalization(.never).autocorrectionDisabled().keyboardType(.URL); SecureField("Access token", text: $token, prompt: Text(existing?.hasToken == true ? "Token saved · enter to replace" : "Access token, if needed").foregroundColor(FieldStyle.secondaryInk)) }
            Section { Button(busy ? "Connecting…" : "Save and discover tools") { Task { await save(discover: true) } }.disabled(busy || name.isEmpty || url.isEmpty || settings == nil) }
            ForEach(tools) { tool in
                Section {
                    Toggle("Allow \(tool.name)", isOn: Binding(get: { selected.contains(tool.name) }, set: { if $0 { selected.insert(tool.name) } else { selected.remove(tool.name); reads.remove(tool.name) } }))
                    Text(tool.description).font(.footnote)
                    if selected.contains(tool.name) { Toggle("Allow reads without review", isOn: Binding(get: { reads.contains(tool.name) }, set: { if $0 { reads.insert(tool.name) } else { reads.remove(tool.name) } })) }
                    DisclosureGroup("Arguments") { Text(tool.inputSchema.pretty).font(.caption).textSelection(.enabled) }
                } footer: { if selected.contains(tool.name) { Text("Only enable unreviewed reads for a tool you trust to be read-only. Server hints are not a guarantee.") } }
            }
            if !tools.isEmpty { Section { Button("Save tool permissions") { Task { await save(discover: false) } }.disabled(busy) } }
            if !message.isEmpty { Section { Text(message).font(.subheadline) } }
            if existing != nil { Section { Button("Disconnect server", role: .destructive) { removing = true }.disabled(busy) } }
        }.pastoralBackground(reading: true).navigationTitle(existing?.name ?? "New tool server").navigationBarTitleDisplayMode(.inline)
            .toolbar { if existing == nil { ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } } } }
            .task {
                if let existing { name = existing.name; url = existing.url; identifier = existing.id; selected = Set(existing.tools); reads = Set(existing.readTools) }
                do { settings = try await model.fetch("/integrations"); if existing != nil { let response: MCPTools = try await model.fetch("/connectors/" + identifier + "/discover", method: "POST", body: [:]); tools = response.tools } } catch { message = error.localizedDescription }
            }
            .confirmationDialog("Disconnect this tool server?", isPresented: $removing, titleVisibility: .visible) { Button("Disconnect", role: .destructive) { Task { await disconnect() } } }
    }
    private func rows(_ settings: IntegrationSettings) -> [[String: Any]] { settings.connectors.filter { $0.id != identifier }.map { ["id": $0.id, "name": $0.name, "url": $0.url, "tools": $0.tools, "readTools": $0.readTools] } }
    private func save(discover: Bool) async {
        guard let settings else { return }; busy = true; defer { busy = false }
        var item: [String: Any] = ["id": identifier, "name": name, "url": url, "tools": Array(selected), "readTools": Array(reads)]; if !token.isEmpty { item["token"] = token }
        do {
            self.settings = try await model.fetch("/integrations", method: "PATCH", body: ["revision": settings.revision, "connectors": rows(settings) + [item]]); token = ""
            if discover { let response: MCPTools = try await model.fetch("/connectors/" + identifier + "/discover", method: "POST", body: [:]); tools = response.tools; message = "Select the tools \(model.name) may use, then save permissions." } else { message = "Tool permissions saved." }
            await model.refresh()
        } catch { message = error.localizedDescription }
    }
    private func disconnect() async {
        guard let settings else { return }; busy = true; defer { busy = false }
        do { let _: IntegrationSettings = try await model.fetch("/integrations", method: "PATCH", body: ["revision": settings.revision, "connectors": rows(settings)]); await model.refresh(); dismiss() } catch { message = error.localizedDescription }
    }
}
