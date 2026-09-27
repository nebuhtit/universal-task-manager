import Foundation

@main
struct AgendaWidgetStoreTests {
    static func main() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let file = directory.appendingPathComponent("agenda.json")
        precondition(AgendaWidgetStore.snapshot(from: file) == nil)
        let data = Data(#"{"version":2,"generatedAt":123,"expires":456,"refreshLabel":"Refresh","entries":[{"at":123,"current":"","title":"Meeting","target":400,"label":"In","moment":"11:00","tomorrow":false}]}"#.utf8)
        try data.write(to: file, options: .atomic)
        // Reading the opted-in file must not depend on cross-process defaults.
        precondition(AgendaWidgetStore.snapshot(from: file)?.entries.first?.title == "Meeting")
        try Data("invalid".utf8).write(to: file, options: .atomic)
        precondition(AgendaWidgetStore.snapshot(from: file) == nil)
        try FileManager.default.removeItem(at: file)
        precondition(AgendaWidgetStore.snapshot(from: file) == nil)
        print("Widget snapshot presence, decoding and clearing passed")
    }
}
