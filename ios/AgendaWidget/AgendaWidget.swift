import SwiftUI
import WidgetKit

struct AgendaEntry: TimelineEntry {
    let date: Date
    let current: String
    let title: String
    let target: Date?
    let label: String
}
struct AgendaProvider: TimelineProvider {
    func placeholder(in context: Context) -> AgendaEntry {
        AgendaEntry(date: .now, current: "Universal", title: "Следующее событие", target: .now.addingTimeInterval(1800), label: "Через")
    }
    func getSnapshot(in context: Context, completion: @escaping (AgendaEntry) -> Void) { completion(context.isPreview ? placeholder(in: context) : entries().first!) }
    func getTimeline(in context: Context, completion: @escaping (Timeline<AgendaEntry>) -> Void) {
        completion(Timeline(entries: entries(), policy: .after(Date().addingTimeInterval(3600))))
    }
    private func entries() -> [AgendaEntry] {
        let now = Date()
        let russian = Locale.current.language.languageCode?.identifier == "ru"
        let fallback = AgendaEntry(date: now, current: "Universal", title: russian ? "Откройте приложение и включите виджет" : "Open app and enable widget", target: nil, label: "")
        guard let snapshot = AgendaWidgetStore.snapshot() else { return [fallback] }
        let expired = AgendaEntry(date: Date(timeIntervalSince1970: max(now.timeIntervalSince1970, snapshot.expires)), current: "Universal", title: snapshot.refreshLabel, target: nil, label: "")
        guard snapshot.expires > now.timeIntervalSince1970 else { return [expired] }
        let ordered = snapshot.entries.sorted { $0.at < $1.at }
        let previous = ordered.last { $0.at <= now.timeIntervalSince1970 }
        let future = ordered.filter { $0.at > now.timeIntervalSince1970 && $0.at < snapshot.expires }
        var result = ([previous].compactMap { $0 } + future).map { value in
            AgendaEntry(date: Date(timeIntervalSince1970: max(now.timeIntervalSince1970, value.at)), current: value.current, title: value.title, target: value.target.map { Date(timeIntervalSince1970: $0) }, label: value.label)
        }
        if result.isEmpty { result.append(fallback) }
        result.append(expired)
        return result
    }
}
struct AgendaWidgetView: View {
    let entry: AgendaEntry
    @Environment(\.widgetFamily) private var family
    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            if !entry.current.isEmpty { Text(entry.current).font(.caption).lineLimit(1) }
            Text(entry.title).font(.headline).lineLimit(1)
            if let target = entry.target, target > entry.date {
                HStack(spacing: 4) {
                    Text(entry.label)
                    Text(timerInterval: entry.date...target, countsDown: true).monospacedDigit()
                }.font(.caption)
            }
        }
        .padding(family == .accessoryRectangular ? 4 : 0)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background {
            if family == .accessoryRectangular {
                AccessoryWidgetBackground().clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            }
        }
        .privacySensitive()
        .containerBackground(.fill.tertiary, for: .widget)
    }
}
@main
struct UniversalAgendaWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: AgendaWidgetStore.kind, provider: AgendaProvider()) { entry in AgendaWidgetView(entry: entry) }
            .configurationDisplayName("Universal · Now & Next")
            .description("Текущий статус и отсчёт до следующего события. Current status and next event countdown.")
            .supportedFamilies([.accessoryRectangular, .systemSmall])
    }
}
