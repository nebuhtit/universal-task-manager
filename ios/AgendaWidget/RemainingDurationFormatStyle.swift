import Foundation

/// TimeDataSource.durationOffset is now - target, not target - now.
/// Keep the system's live updates while presenting a nonnegative countdown.
@available(iOS 18.0, macOS 15.0, *)
struct RemainingDurationFormatStyle: DiscreteFormatStyle {
    private var units = Duration.UnitsFormatStyle(
        allowedUnits: [.hours, .minutes], width: .narrow, maximumUnitCount: 2
    ).locale(Locale(identifier: "en_US"))

    func format(_ offset: Duration) -> String {
        units.format(max(.zero, .zero - offset))
    }

    // Negating the input reverses both the direction and sign of boundaries.
    func discreteInput(before input: Duration) -> Duration? {
        units.discreteInput(after: max(.zero, .zero - input)).map { .zero - $0 }
    }

    func discreteInput(after input: Duration) -> Duration? {
        guard input < .zero else { return nil } // Stay at zero after the target.
        return units.discreteInput(before: .zero - input).map { min(.zero, .zero - $0) }
    }

    func input(before input: Duration) -> Duration? {
        units.input(after: .zero - input).map { .zero - $0 }
    }

    func input(after input: Duration) -> Duration? {
        units.input(before: .zero - input).map { .zero - $0 }
    }
}
