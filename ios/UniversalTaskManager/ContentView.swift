import SwiftUI

@MainActor
final class WebAppModel: ObservableObject {
    enum State: Equatable {
        case loading
        case ready(URL)
        case failed(String)
    }

    @Published private(set) var state: State = .loading
    private var server: LocalWebServer?

    init() {
        start()
    }

    func start() {
        server?.stop()
        state = .loading

        guard let root = Bundle.main.resourceURL?.appendingPathComponent("WebApp", isDirectory: true) else {
            state = .failed("The local web application is missing from this build.")
            return
        }

        let server = LocalWebServer(rootDirectory: root)
        self.server = server
        server.start { [weak self] result in
            DispatchQueue.main.async {
                guard let self else { return }
                switch result {
                case .success(let url):
                    self.state = .ready(url)
                case .failure(let error):
                    self.state = .failed(error.localizedDescription)
                }
            }
        }
    }

    deinit {
        server?.stop()
    }
}

@MainActor
struct ContentView: View {
    @StateObject private var model = WebAppModel()

    var body: some View {
        Group {
            switch model.state {
            case .loading:
                ProgressView("Opening Universal Task Manager…")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            case .ready(let url):
                WebAppView(startURL: url)
                    .ignoresSafeArea()
            case .failed(let message):
                ContentUnavailableView {
                    Label("Cannot open the app", systemImage: "exclamationmark.triangle")
                } description: {
                    Text(message)
                } actions: {
                    Button("Try again") {
                        model.start()
                    }
                }
            }
        }
    }
}
