import SwiftUI

@main
struct UniversalTaskManagerApp: App {
    // One fixed-origin server for the entire app, not one per window/scene.
    @StateObject private var model = WebAppModel()
    var body: some Scene {
        WindowGroup {
            ContentView(model: model)
                .onOpenURL { url in
                    guard url.scheme == "utm", url.host == "calendar", url.path == "/today" else { return }
                    UserDefaults.standard.set(true, forKey: "utm.pendingCalendarToday")
                    NotificationCenter.default.post(name: Notification.Name("utm.openCalendarToday"), object: nil)
                }
        }
    }
}
