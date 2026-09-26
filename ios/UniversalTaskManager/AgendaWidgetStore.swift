import Foundation
import WidgetKit

struct AgendaWidgetRecord: Codable {
    let at: Double
    let current: String
    let title: String
    let target: Double?
    let label: String
    let moment: String?
    let tomorrow: Bool?
}
struct AgendaWidgetSnapshot: Codable {
    let version: Int?
    let generatedAt: Double?
    let entries: [AgendaWidgetRecord]
    let expires: Double
    let refreshLabel: String
}
enum AgendaWidgetStore {
    static let group = "group.dev.universal-task-manager.ios"
    static let kind = "UniversalAgenda"
    static var defaults: UserDefaults? { UserDefaults(suiteName: group) }
    static var file: URL? { FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group)?.appendingPathComponent("agenda.json") }
    static var enabled: Bool { defaults?.bool(forKey: "enabled") ?? false }
    static func snapshot() -> AgendaWidgetSnapshot? {
        guard enabled, let file, let data = try? Data(contentsOf: file) else { return nil }
        return try? JSONDecoder().decode(AgendaWidgetSnapshot.self, from: data)
    }
}

#if !WIDGET_EXTENSION
import WebKit

final class NativeAgendaBridge: NSObject, WKScriptMessageHandlerWithReply {
    private var reload: DispatchWorkItem?
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage, replyHandler: @escaping (Any?, String?) -> Void) {
        let origin = message.frameInfo.securityOrigin
        guard message.frameInfo.isMainFrame, origin.protocol == "http", origin.host == "127.0.0.1", origin.port == 49381,
              let body = message.body as? [String: Any], let kind = body["kind"] as? String,
              let file = AgendaWidgetStore.file, let defaults = AgendaWidgetStore.defaults else { replyHandler(nil, "Widget App Group unavailable"); return }
        do {
            switch kind {
            case "status": break
            case "enable": defaults.set(true, forKey: "enabled")
            case "disable":
                defaults.set(false, forKey: "enabled")
                if FileManager.default.fileExists(atPath: file.path) { try FileManager.default.removeItem(at: file) }
            case "sync":
                guard AgendaWidgetStore.enabled, let payload = body["payload"] as? [String: Any] else { replyHandler(["enabled": false], nil); return }
                let data = try JSONSerialization.data(withJSONObject: payload)
                guard data.count < 200_000 else { replyHandler(nil, "Widget payload too large"); return }
                let value = try JSONDecoder().decode(AgendaWidgetSnapshot.self, from: data)
                guard value.entries.count <= 128, value.expires.isFinite,
                      value.entries.allSatisfy({ $0.at.isFinite && $0.title.count <= 160 && $0.current.count <= 160 }) else { replyHandler(nil, "Invalid widget payload"); return }
                try data.write(to: file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
            default: replyHandler(nil, "Unsupported widget action"); return
            }
            if kind != "status" {
                reload?.cancel()
                let work = DispatchWorkItem { WidgetCenter.shared.reloadTimelines(ofKind: AgendaWidgetStore.kind) }
                reload = work
                DispatchQueue.main.asyncAfter(deadline: .now() + 1, execute: work)
            }
            replyHandler(["enabled": AgendaWidgetStore.enabled], nil)
        } catch { replyHandler(nil, "Could not update widget storage") }
    }
}
#endif
