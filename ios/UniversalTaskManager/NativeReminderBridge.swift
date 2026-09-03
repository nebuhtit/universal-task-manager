import Foundation
import UserNotifications
import WebKit

final class NativeReminderBridge: NSObject, WKScriptMessageHandler, UNUserNotificationCenterDelegate {
    weak var webView: WKWebView?
    private let center = UNUserNotificationCenter.current()
    private let identifierPrefix = "utm:"

    override init() {
        super.init()
        center.delegate = self
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let payload = message.body as? [String: Any],
              let id = payload["id"] as? String,
              let kind = payload["kind"] as? String else { return }
        switch kind {
        case "reminders.requestPermission": requestPermission(id: id)
        case "reminders.sync": sync(id: id, payload: payload)
        default: break
        }
    }

    private func requestPermission(id: String) {
        center.requestAuthorization(options: [.alert, .sound, .badge]) { [weak self] granted, error in
            if let error { self?.sendStatus(id: id, error: error.localizedDescription); return }
            self?.sendStatus(id: id, authorization: granted ? "granted" : "denied")
        }
    }

    private func sync(id: String, payload: [String: Any]) {
        let rawItems = payload["items"] as? [[String: Any]] ?? []
        center.getPendingNotificationRequests { [weak self] requests in
            guard let self else { return }
            let oldIdentifiers = requests.map(\.identifier).filter { $0.hasPrefix(self.identifierPrefix) }
            self.center.removePendingNotificationRequests(withIdentifiers: oldIdentifiers)
            let group = DispatchGroup()
            var firstError: Error?
            let errorLock = NSLock()
            var scheduled = 0
            for item in rawItems.prefix(60) {
                guard let identifier = item["id"] as? String, identifier.hasPrefix(self.identifierPrefix),
                      let title = item["title"] as? String,
                      let body = item["body"] as? String,
                      let at = item["at"] as? String,
                      let date = ISO8601DateFormatter().date(from: at), date > Date() else { continue }
                let content = UNMutableNotificationContent()
                content.title = title
                content.body = body
                content.sound = .default
                if let itemId = item["itemId"] as? String { content.userInfo = ["itemId": itemId] }
                let components = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute, .second], from: date)
                let request = UNNotificationRequest(identifier: identifier, content: content, trigger: UNCalendarNotificationTrigger(dateMatching: components, repeats: false))
                group.enter()
                self.center.add(request) { error in
                    errorLock.lock()
                    if let error, firstError == nil { firstError = error }
                    if error == nil { scheduled += 1 }
                    errorLock.unlock()
                    group.leave()
                }
            }
            group.notify(queue: .main) {
                if let firstError { self.sendStatus(id: id, error: firstError.localizedDescription) }
                else { self.sendStatus(id: id, scheduled: scheduled) }
            }
        }
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .list, .sound])
    }

    private func sendStatus(id: String, authorization: String? = nil, scheduled: Int? = nil, error: String? = nil) {
        var payload: [String: Any] = ["id": id, "ok": error == nil]
        if let authorization { payload["authorization"] = authorization }
        if let scheduled { payload["scheduled"] = scheduled }
        if let error { payload["error"] = error }
        guard let data = try? JSONSerialization.data(withJSONObject: payload), let json = String(data: data, encoding: .utf8) else { return }
        DispatchQueue.main.async { [weak self] in
            self?.webView?.evaluateJavaScript("window.dispatchEvent(new CustomEvent('utm-native-reminders-status', { detail: \(json) }));")
        }
    }
}
