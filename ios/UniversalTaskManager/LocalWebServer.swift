import Foundation
import Network

final class LocalWebServer: @unchecked Sendable {
    // This port is part of the persistent web origin. Changing it would make
    // WebKit expose a different IndexedDB database to the application.
    private static let serverPort: NWEndpoint.Port = 49_381

    enum ServerError: LocalizedError {
        case missingIndex
        case unavailable

        var errorDescription: String? {
            switch self {
            case .missingIndex:
                return "The packaged web application has no index.html file."
            case .unavailable:
                return "The private local web server could not be started."
            }
        }
    }

    private let rootDirectory: URL
    private let queue = DispatchQueue(label: "dev.universal-task-manager.local-web-server")
    private var listener: NWListener?

    init(rootDirectory: URL) {
        self.rootDirectory = rootDirectory.standardizedFileURL
    }

    func start(completion: @escaping (Result<URL, Error>) -> Void) {
        guard FileManager.default.fileExists(atPath: rootDirectory.appendingPathComponent("index.html").path) else {
            completion(.failure(ServerError.missingIndex))
            return
        }

        do {
            let parameters = NWParameters.tcp
            parameters.allowLocalEndpointReuse = true
            parameters.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: Self.serverPort)
            // requiredLocalEndpoint already supplies the port. Passing it a
            // second time through init(using:on:) produces NWError 22 on iOS.
            let listener = try NWListener(using: parameters)
            self.listener = listener

            listener.newConnectionHandler = { [weak self] connection in
                self?.serve(connection)
            }
            listener.stateUpdateHandler = { [weak self] state in
                switch state {
                case .ready:
                    guard let port = listener.port else {
                        completion(.failure(ServerError.unavailable))
                        return
                    }
                    completion(.success(URL(string: "http://127.0.0.1:\(port.rawValue)/")!))
                case .failed(let error):
                    self?.listener = nil
                    completion(.failure(error))
                default:
                    break
                }
            }
            listener.start(queue: queue)
        } catch {
            completion(.failure(error))
        }
    }

    func stop() {
        listener?.cancel()
        listener = nil
    }

    private func serve(_ connection: NWConnection) {
        connection.start(queue: queue)
        receiveRequest(from: connection, accumulated: Data())
    }

    private func receiveRequest(from connection: NWConnection, accumulated: Data) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 16_384) { [weak self] data, _, isComplete, error in
            guard let self, error == nil else {
                connection.cancel()
                return
            }

            var request = accumulated
            if let data { request.append(data) }
            let hasCompleteHeaders = request.range(of: Data("\r\n\r\n".utf8)) != nil
            guard hasCompleteHeaders || isComplete || request.count >= 65_536 else {
                self.receiveRequest(from: connection, accumulated: request)
                return
            }

            let response = self.response(for: request)
            connection.send(content: response, completion: .contentProcessed { _ in
                connection.cancel()
            })
        }
    }

    private func response(for requestData: Data) -> Data {
        guard let request = String(data: requestData, encoding: .utf8),
              let firstLine = request.components(separatedBy: "\r\n").first else {
            return httpResponse(status: "400 Bad Request", contentType: "text/plain; charset=utf-8", body: Data("Bad request".utf8))
        }

        let parts = firstLine.split(separator: " ")
        guard parts.count >= 2, parts[0] == "GET" || parts[0] == "HEAD" else {
            return httpResponse(status: "405 Method Not Allowed", contentType: "text/plain; charset=utf-8", body: Data("Method not allowed".utf8))
        }

        let rawPath = String(parts[1]).split(separator: "?", maxSplits: 1).first.map(String.init) ?? "/"
        let decodedPath = rawPath.removingPercentEncoding ?? rawPath
        let relativePath = decodedPath == "/" ? "index.html" : String(decodedPath.drop(while: { $0 == "/" }))
        let requestedURL = rootDirectory.appendingPathComponent(relativePath).standardizedFileURL
        let rootPath = rootDirectory.path.hasSuffix("/") ? rootDirectory.path : rootDirectory.path + "/"

        guard requestedURL.path.hasPrefix(rootPath) else {
            return httpResponse(status: "403 Forbidden", contentType: "text/plain; charset=utf-8", body: Data("Forbidden".utf8))
        }

        let fileURL: URL
        if FileManager.default.fileExists(atPath: requestedURL.path) {
            fileURL = requestedURL
        } else if requestedURL.pathExtension.isEmpty {
            fileURL = rootDirectory.appendingPathComponent("index.html")
        } else {
            return httpResponse(status: "404 Not Found", contentType: "text/plain; charset=utf-8", body: Data("Not found".utf8))
        }

        guard let body = try? Data(contentsOf: fileURL, options: .mappedIfSafe) else {
            return httpResponse(status: "500 Internal Server Error", contentType: "text/plain; charset=utf-8", body: Data("Cannot read asset".utf8))
        }
        return httpResponse(
            status: "200 OK",
            contentType: Self.mimeType(for: fileURL.pathExtension),
            body: parts[0] == "HEAD" ? Data() : body,
            declaredLength: body.count
        )
    }

    private func httpResponse(status: String, contentType: String, body: Data, declaredLength: Int? = nil) -> Data {
        let headers = [
            "HTTP/1.1 \(status)",
            "Content-Type: \(contentType)",
            "Content-Length: \(declaredLength ?? body.count)",
            "Cache-Control: no-cache",
            "Connection: close",
            "X-Content-Type-Options: nosniff",
            "",
            ""
        ].joined(separator: "\r\n")
        var response = Data(headers.utf8)
        response.append(body)
        return response
    }

    private static func mimeType(for pathExtension: String) -> String {
        switch pathExtension.lowercased() {
        case "html": return "text/html; charset=utf-8"
        case "js", "mjs": return "text/javascript; charset=utf-8"
        case "css": return "text/css; charset=utf-8"
        case "json", "webmanifest": return "application/json; charset=utf-8"
        case "wasm": return "application/wasm"
        case "svg": return "image/svg+xml"
        case "png": return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        case "gif": return "image/gif"
        case "webp": return "image/webp"
        case "ico": return "image/x-icon"
        case "woff": return "font/woff"
        case "woff2": return "font/woff2"
        case "txt": return "text/plain; charset=utf-8"
        default: return "application/octet-stream"
        }
    }
}
