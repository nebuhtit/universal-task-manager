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
        let secondThresholds = result.compactMap { entry -> AgendaEntry? in
            guard let target = entry.target else { return nil }
            let threshold = target.addingTimeInterval(-600)
            guard threshold > entry.date, threshold > now else { return nil }
            return AgendaEntry(date: threshold, current: entry.current, title: entry.title, target: target, label: entry.label)
        }
        result.append(contentsOf: secondThresholds)
        result.sort { $0.date < $1.date }
        if result.isEmpty { result.append(fallback) }
        result.append(expired)
        return result
    }
}
struct AgendaWidgetView: View {
    let entry: AgendaEntry
    @Environment(\.widgetFamily) private var family
    private func statusText(_ value: String, font: Font) -> some View {
        let parts = value.components(separatedBy: "⇥ ")
        return HStack(alignment: .center, spacing: 3) {
            ForEach(parts.indices, id: \.self) { index in
                if index > 0 {
                    DepartureMark()
                        .stroke(style: StrokeStyle(lineWidth: 1.35, lineCap: .round, lineJoin: .round))
                        .frame(width: 28, height: 13)
                        .fixedSize()
                        .accessibilityHidden(true)
                }
                if !parts[index].isEmpty { Text(parts[index]).lineLimit(1) }
            }
        }
        .font(font)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(value.replacingOccurrences(of: "⇥ ", with: Locale.current.language.languageCode?.identifier == "ru" ? "Выезд · " : "Departure · "))
    }
    private func content(outerInset: CGFloat = 0, middleInset: CGFloat = 0) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            if !entry.current.isEmpty {
                statusText(entry.current, font: .caption)
                    .padding(.horizontal, outerInset)
            }
            statusText(entry.title, font: .headline)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.leading, outerInset)
                .padding(.trailing, middleInset)
            if let target = entry.target, target > entry.date {
                HStack(spacing: 4) {
                    Text(entry.label)
                    if target.timeIntervalSince(entry.date) < 600 {
                        Text(timerInterval: entry.date...target, countsDown: true).monospacedDigit()
                    } else {
                        Text(target, style: .relative).monospacedDigit()
                    }
                }.font(.caption).padding(.horizontal, outerInset)
            }
        }
        .lineLimit(1)
        .minimumScaleFactor(0.85)
        .truncationMode(.tail)
    }
    var body: some View {
        Group {
            if family == .accessoryRectangular {
                GeometryReader { geometry in
                    // The capsule is widest at its center: let the title use
                    // that space, while captions stay clear of the curved ends.
                    content(outerInset: min(geometry.size.height, geometry.size.width) * 0.3 + 4,
                            middleInset: 8)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.vertical, 4)
                        .frame(width: geometry.size.width, height: geometry.size.height)
                        .background { AccessoryWidgetBackground().clipShape(Capsule()) }
                        .clipShape(Capsule())
                }
            } else {
                content().frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .privacySensitive()
        .widgetURL(URL(string: "utm://calendar/today"))
        .containerBackground(.fill.tertiary, for: .widget)
    }
}

/// One compact side-facing car + direction glyph, sharing the web geometry.
private struct DepartureMark: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        func point(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
            CGPoint(x: x / 40 * rect.width, y: (y - 3) / 18 * rect.height)
        }
        func line(_ points: [(CGFloat, CGFloat)]) {
            guard let first = points.first else { return }
            path.move(to: point(first.0, first.1))
            for value in points.dropFirst() { path.addLine(to: point(value.0, value.1)) }
        }
        line([(4,17),(2,17),(2,10),(5,10),(8,5),(15,5),(18,10),(23,12),(23,17),(20,17)])
        line([(8,17),(16,17)])
        line([(5,10),(18,10)])
        line([(11,5),(11,10)])
        for x in [CGFloat(6), CGFloat(18)] {
            let origin = point(x - 2, 15)
            path.addEllipse(in: CGRect(x: origin.x, y: origin.y, width: 4 / 40 * rect.width, height: 4 / 18 * rect.height))
        }
        line([(28,12),(38,12)])
        line([(34,8),(38,12),(34,16)])
        return path
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
