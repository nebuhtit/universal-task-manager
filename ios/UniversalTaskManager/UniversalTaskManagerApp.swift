import SwiftUI

@main
struct UniversalTaskManagerApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
                .onOpenURL { url in
                    guard url.scheme == "utm", url.host == "calendar", url.path == "/today" else { return }
                    UserDefaults.standard.set(true, forKey: "utm.pendingCalendarToday")
                    NotificationCenter.default.post(name: Notification.Name("utm.openCalendarToday"), object: nil)
                }
        }
    }
}
