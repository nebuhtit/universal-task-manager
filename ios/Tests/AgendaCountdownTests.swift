@main
struct AgendaCountdownTests {
    static func main() {
        for (seconds, expected) in [(2291.0, "38m"), (4200, "1h 10m"), (600, "10m"), (3600, "1h"), (-60, "0m")] {
            precondition(AgendaCountdown.compact(remaining: seconds) == expected)
        }
        precondition(!AgendaCountdown.showsSeconds(remaining: 600))
        precondition(AgendaCountdown.showsSeconds(remaining: 599.999))
        print("Widget h/m timeline values, zero clamp and seconds boundary passed")
    }
}
