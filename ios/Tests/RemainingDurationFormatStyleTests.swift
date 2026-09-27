import Foundation

// Run with swiftc alongside the production formatter; no widget host required.
@main
struct RemainingDurationFormatStyleTests {
    static func main() {
        let style = RemainingDurationFormatStyle()
        for (seconds, expected) in [(2291, "38m"), (4200, "1h 10m"), (600, "10m"), (0, "0m"), (-60, "0m")] {
            precondition(style.format(.seconds(-seconds)) == expected, "Unexpected countdown for \(seconds): \(style.format(.seconds(-seconds)))")
        }
        for seconds in [2291, 4200, 600, 1] {
            let offset = Duration.seconds(-seconds)
            if let next = style.discreteInput(after: offset) {
                precondition(next > offset)
                if seconds >= 600 { precondition(style.format(style.input(after: next)!) != style.format(offset)) }
            }
            let previous = style.discreteInput(before: offset)!
            precondition(previous < offset)
            precondition(style.format(style.input(before: previous)!) != style.format(offset))
        }
        precondition(style.discreteInput(after: .zero) == nil)
        precondition(style.discreteInput(after: .seconds(60)) == nil)
        print("Widget countdown format and live-update boundaries passed")
    }
}
