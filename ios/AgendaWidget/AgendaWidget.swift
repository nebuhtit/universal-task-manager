import SwiftUI
import WidgetKit

struct AgendaEntry: TimelineEntry {
    let date: Date
    let current: String
    let title: String
    let target: Date?
    let label: String
    var moment: String = ""
    var tomorrow: Bool = false
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
        // Last source entry wins at the same boundary; synthetic entries cannot revive it.
        let unique = Dictionary(snapshot.entries.map { ($0.at, $0) }, uniquingKeysWith: { _, latest in latest })
        let ordered = unique.values.sorted { $0.at < $1.at }
        let previous = ordered.last { $0.at <= now.timeIntervalSince1970 }
        let future = ordered.filter { $0.at > now.timeIntervalSince1970 && $0.at < snapshot.expires }
        var result = ([previous].compactMap { $0 } + future).map { value in
            AgendaEntry(date: Date(timeIntervalSince1970: max(now.timeIntervalSince1970, value.at)), current: value.current, title: value.title, target: value.target.map { Date(timeIntervalSince1970: $0) }, label: value.label, moment: value.moment ?? "", tomorrow: value.tomorrow ?? false)
        }
        let secondThresholds = result.enumerated().compactMap { index, entry -> AgendaEntry? in
            guard let target = entry.target else { return nil }
            let threshold = target.addingTimeInterval(-599.999)
            let end = index + 1 < result.count ? result[index + 1].date : Date(timeIntervalSince1970: snapshot.expires)
            guard snapshot.version != 2, threshold > entry.date, threshold > now, threshold < end else { return nil }
            return AgendaEntry(date: threshold, current: entry.current, title: entry.title, target: target, label: entry.label, moment: entry.moment, tomorrow: entry.tomorrow)
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
        let parts = value.replacingOccurrences(of: "[[travel-to]] ", with: "|A|")
            .replacingOccurrences(of: "[[travel-road]] ", with: "|R|")
            .replacingOccurrences(of: "[[travel-back-to]] ", with: "|B|")
            .components(separatedBy: "|")
        return HStack(alignment: .center, spacing: 1) {
            ForEach(parts.indices, id: \.self) { index in
                if parts[index] == "A" || parts[index] == "B" {
                    LucideTravelIcon(kind: .arrow).frame(width: 13, height: 13).accessibilityHidden(true)
                }
                if parts[index] == "A" || parts[index] == "R" {
                    LucideTravelIcon(kind: .road).frame(width: 13, height: 13).accessibilityHidden(true)
                }
                if !["A", "R", "B"].contains(parts[index]) && !parts[index].isEmpty { Text(parts[index]).lineLimit(1) }
            }
        }
        .font(font)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(value.replacingOccurrences(of: "[[travel-to]] ", with: "Departure · ")
            .replacingOccurrences(of: "[[travel-road]] ", with: "Travel · ")
            .replacingOccurrences(of: "[[travel-back-to]] ", with: "Return travel · "))
    }
    @ViewBuilder
    private func countdown(_ target: Date) -> some View {
        // WidgetKit archives the view: a periodic TimelineView around a computed
        // String can freeze until the next timeline entry. System date Text is
        // updated by the host even while our extension is not running.
        if target.timeIntervalSince(entry.date) < 600 {
            Text(timerInterval: entry.date...max(entry.date, target), countsDown: true).monospacedDigit()
        } else if #available(iOS 18.0, *) {
            Text(.durationOffset(to: target), format: .units(allowed: [.hours, .minutes], width: .narrow, maximumUnitCount: 2).locale(Locale(identifier: "en_US")))
                .monospacedDigit()
        } else {
            // iOS 17 has no configurable live date format. Prefer a live timer
            // (including seconds) over a misleading frozen minute count.
            Text(timerInterval: entry.date...max(entry.date, target), countsDown: true).monospacedDigit()
        }
    }
    private func content(outerInset: CGFloat = 0, middleInset: CGFloat = 0) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            if !entry.current.isEmpty {
                statusText(entry.current, font: .caption)
                    .padding(.horizontal, outerInset)
            }
            HStack(spacing: 3) {
                statusText(entry.title, font: .headline).layoutPriority(0)
                if !entry.moment.isEmpty {
                    Text("·").font(.caption)
                    if entry.tomorrow { LucideTravelIcon(kind: .chevron).frame(width: 10, height: 10).accessibilityLabel("Tomorrow") }
                    Text(entry.moment).font(.caption).fixedSize().layoutPriority(1)
                }
            }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.leading, outerInset)
                .padding(.trailing, middleInset)
            if let target = entry.target, target > entry.date {
                HStack(spacing: 4) {
                    Text(entry.label)
                    countdown(target)
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

/// Lucide arrow-right-to-line / road paths from the referenced icon pages.
private struct LucideTravelIcon: View {
    enum Kind { case arrow, road, chevron }
    let kind: Kind
    var body: some View {
        ShapeView(kind: kind).stroke(.primary, style: StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))
    }
    private struct ShapeView: Shape {
        let kind: Kind
        func path(in rect: CGRect) -> Path {
            var path = Path()
            func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: x * rect.width / 24, y: y * rect.height / 24) }
            func line(_ points: [(CGFloat, CGFloat)]) {
                guard let first = points.first else { return }
                path.move(to: p(first.0, first.1))
                for point in points.dropFirst() { path.addLine(to: p(point.0, point.1)) }
            }
            if kind == .chevron {
                line([(9,18),(15,12),(9,6)])
            } else if kind == .arrow {
                line([(17,12),(3,12)])
                line([(11,18),(17,12),(11,6)])
                line([(21,5),(21,19)])
            } else {
                line([(12,17),(12,21)])
                line([(12,5),(12,3)])
                line([(12,9),(12,12)])
                path.move(to: p(2.077,18.449))
                path.addCurve(to: p(4,21), control1: p(1.667,19.712), control2: p(2.61,21))
                path.addLine(to: p(20,21))
                path.addCurve(to: p(21.924,18.45), control1: p(21.39,21), control2: p(22.333,19.712))
                path.addLine(to: p(17.924,4.45))
                path.addCurve(to: p(16,3), control1: p(17.68,3.59), control2: p(16.9,3))
                path.addLine(to: p(8,3))
                path.addCurve(to: p(6.076,4.45), control1: p(7.1,3), control2: p(6.32,3.59))
                path.closeSubpath()
            }
            return path
        }
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
