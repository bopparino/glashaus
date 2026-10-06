import SwiftUI

struct MemoryView: View {
    @EnvironmentObject private var session: Session
    @State private var query = ""
    @State private var selection = "memories"
    @State private var adding = false
    @State private var editing: Memory?
    @State private var removing: Memory?
    @State private var error: String?
    @State private var busy = false
    private var memories: [Memory] {
        (session.snapshot?.memories ?? []).filter { $0.active == 1 && (query.isEmpty || $0.text.localizedCaseInsensitiveContains(query)) }
    }
    private var reflections: [Reflection] {
        (session.snapshot?.reflections ?? []).filter { query.isEmpty || $0.content.localizedCaseInsensitiveContains(query) }
    }
    var body: some View {
        List {
            Section {
                Picker("Show", selection: $selection) {
                    Text("Memories").tag("memories")
                    Text("Journal").tag("journal")
                }.pickerStyle(.segmented)
            }.listRowBackground(Color.clear).listRowInsets(EdgeInsets())
            if let error { Section { ErrorText(message: error) } }
            if !session.online { Section { Text("Reconnect to your computer to see the latest changes.").foregroundStyle(.secondary) } }
            if selection == "memories" {
                if memories.isEmpty {
                    Section {
                        Text(query.isEmpty ? "A little context goes a long way." : "No matching memories.").font(.headline)
                        Text(query.isEmpty ? "Add something you want remembered. Memories gathered from conversation will appear here too, with their source." : "Try a different word.")
                            .foregroundStyle(.secondary)
                    }
                }
                ForEach(memories) { memory in
                    Button { editing = memory } label: {
                        VStack(alignment: .leading, spacing: 8) {
                            Text(memory.text).foregroundStyle(.primary)
                            Text("\(memory.subject.capitalized) · \(memory.kind.capitalized)").font(.caption).foregroundStyle(.secondary)
                        }.padding(.vertical, 4)
                    }
                    .swipeActions { Button("Forget", role: .destructive) { removing = memory } }
                }
            } else {
                Section {
                    Button(busy ? "Writing…" : "Write a reflection") { reflect() }.disabled(busy || !session.online || session.sending)
                } footer: { Text("Reflections are the companion’s interpretation of recent conversations. They can be incomplete or mistaken.") }
                if reflections.isEmpty {
                    Section { Text(query.isEmpty ? "No reflections yet." : "No matching reflections.").foregroundStyle(.secondary) }
                }
                ForEach(reflections) { reflection in
                    Section {
                        Text(reflection.content).textSelection(.enabled)
                    } header: { Text(displayDate(reflection.createdAt)) }
                }
            }
        }
        .navigationTitle("Memory").searchable(text: $query, prompt: "Search \(selection == "memories" ? "memories" : "journal")")
        .refreshable { await session.refresh() }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { adding = true } label: { Image(systemName: "plus") }
                    .accessibilityLabel("Add memory").disabled(session.snapshot?.companion == nil)
            }
        }
        .sheet(isPresented: $adding) { NavigationStack { MemoryEditor(memory: nil) } }
        .sheet(item: $editing) { memory in NavigationStack { MemoryEditor(memory: memory) } }
        .alert("Forget this memory?", isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } })) {
            Button("Cancel", role: .cancel) { removing = nil }
            Button("Forget", role: .destructive) { if let memory = removing { remove(memory) }; removing = nil }
        } message: { Text("It will stop being used as a memory. The original conversation stays in your history.") }
    }
    private func remove(_ memory: Memory) {
        Task {
            do {
                guard let client = session.client else { return }
                let _: OKReply = try await client.send("memories/\(memory.id)", method: "DELETE", body: EmptyBody())
                await session.refresh()
            } catch { self.error = error.localizedDescription }
        }
    }
    private func reflect() {
        busy = true; error = nil
        Task {
            defer { busy = false }
            do {
                guard let client = session.client else { return }
                let _: Reflection? = try await client.send("reflect", body: EmptyBody())
                await session.refresh()
            } catch { self.error = error.localizedDescription }
        }
    }
}

private struct MemoryEditor: View {
    @EnvironmentObject private var session: Session
    @Environment(\.dismiss) private var dismiss
    let memory: Memory?
    @State private var text: String
    @State private var subject = "user"
    @State private var kind = "fact"
    @State private var error: String?
    @State private var saving = false
    init(memory: Memory?) { self.memory = memory; _text = State(initialValue: memory?.text ?? "") }
    var body: some View {
        Form {
            Section {
                TextEditor(text: $text).frame(minHeight: 160).accessibilityLabel("Memory")
            } footer: { Text("\(text.utf16.count) / 1,500 characters") }
            if let memory {
                Section("Source") { Text(memory.evidence).font(.callout).foregroundStyle(.secondary) }
            } else {
                Section {
                    Picker("About", selection: $subject) {
                        Text("You").tag("user"); Text("Companion").tag("companion"); Text("Your relationship").tag("relationship")
                    }
                    Picker("Kind", selection: $kind) { Text("Fact").tag("fact"); Text("Opinion").tag("opinion") }
                }
            }
            if let error { Section { ErrorText(message: error) } }
        }
        .navigationTitle(memory == nil ? "Add memory" : "Edit memory").navigationBarTitleDisplayMode(.inline)
        .interactiveDismissDisabled(saving || text != (memory?.text ?? ""))
        .toolbar {
            ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.disabled(saving) }
            ToolbarItem(placement: .confirmationAction) { Button(saving ? "Saving…" : "Save") { save() }
                .disabled(saving || text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || text.utf16.count > 1500) }
        }
    }
    private func save() {
        struct Body: Encodable { var text, subject, kind: String }
        saving = true; error = nil
        Task {
            defer { saving = false }
            do {
                guard let client = session.client else { return }
                let body = Body(text: text, subject: subject, kind: kind)
                if let memory {
                    let _: OKReply = try await client.send("memories/\(memory.id)", method: "PATCH", body: body)
                } else {
                    let _: Memory = try await client.send("memories", body: body)
                }
                await session.refresh(); dismiss()
            } catch { self.error = error.localizedDescription }
        }
    }
}

func displayDate(_ value: String) -> String {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter.date(from: value)?.formatted(date: .abbreviated, time: .shortened) ?? value
}
