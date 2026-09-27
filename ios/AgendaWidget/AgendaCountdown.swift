import Foundation

enum AgendaCountdown {
    static func showsSeconds(remaining: TimeInterval) -> Bool { remaining < 600 }

    /// Pre-rendered minute text is deliberately plain data, not a SwiftUI
    /// FormatStyle. WidgetKit can archive it reliably for the Lock Screen.
    static func compact(remaining: TimeInterval) -> String {
        let totalMinutes = max(0, Int(remaining) / 60)
        let hours = totalMinutes / 60
        let minutes = totalMinutes % 60
        if hours == 0 { return "\(minutes)m" }
        return minutes == 0 ? "\(hours)h" : "\(hours)h \(minutes)m"
    }
}
