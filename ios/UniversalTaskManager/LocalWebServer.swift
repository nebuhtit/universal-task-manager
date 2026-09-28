import Foundation
import Darwin
import OSLog

final class LocalWebServer: @unchecked Sendable {
    // This port is part of the persistent web origin. Changing it would make
    // WebKit expose a different IndexedDB database to the application.
    private static let serverPort: UInt16 = 49_381

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
    private var listener: DispatchSourceRead?
    private var readyURL: URL?
    private var completions: [(Result<URL, Error>) -> Void] = []
    private var activeConnections = 0
    private let log = Logger(subsystem: "dev.universal-task-manager", category: "local-web-server")

    init(rootDirectory: URL) {
        self.rootDirectory = rootDirectory.standardizedFileURL
    }

    func start(completion: @escaping (Result<URL, Error>) -> Void) {
        queue.async { [self] in
            if let readyURL { completion(.success(readyURL)); return }
            completions.append(completion)
            // Multiple scenes/repeated requests share the same listener.
            guard listener == nil, completions.count == 1 else { return }
            startListener()
        }
    }

    private func finish(_ result: Result<URL, Error>) {
        let callbacks = completions
        completions.removeAll()
        callbacks.forEach { $0(result) }
    }

    private func startListener() {
        guard FileManager.default.fileExists(atPath: rootDirectory.appendingPathComponent("index.html").path) else {
            finish(.failure(ServerError.missingIndex))
            return
        }

        log.info("Starting listener on fixed port 49381; BSD-loopback v3")
        let fd = Darwin.socket(AF_INET, SOCK_STREAM, 0)
        guard fd >= 0 else { failSocket("socket", code: errno); return }
        var reuse: Int32 = 1
        guard setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &reuse, socklen_t(MemoryLayout.size(ofValue: reuse))) == 0 else {
            failSocket("reuse", code: errno, fd: fd); return
        }
        var address = sockaddr_in()
        address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        address.sin_family = sa_family_t(AF_INET)
        address.sin_port = Self.serverPort.bigEndian
        address.sin_addr = in_addr(s_addr: inet_addr("127.0.0.1"))
        let bound = withUnsafePointer(to: &address) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                Darwin.bind(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
            }
        }
        guard bound == 0 else { failSocket("bind", code: errno, fd: fd); return }
        guard Darwin.listen(fd, 16) == 0 else { failSocket("listen", code: errno, fd: fd); return }
        guard fcntl(fd, F_SETFL, O_NONBLOCK) == 0 else { failSocket("nonblock", code: errno, fd: fd); return }
        let source = DispatchSource.makeReadSource(fileDescriptor: fd, queue: queue)
        source.setEventHandler { [weak self] in self?.acceptConnections(fd) }
        source.setCancelHandler { [weak self] in
            Darwin.close(fd)
            guard let self else { return }
            self.listener = nil
            // A new start may have arrived while cancellation was pending.
            if !self.completions.isEmpty { self.startListener() }
        }
        listener = source
        source.resume()
        readyURL = URL(string: "http://127.0.0.1:\(Self.serverPort)/")!
        log.info("Listener ready; BSD-loopback v3")
        finish(.success(readyURL!))
    }

    private func failSocket(_ stage: String, code: Int32, fd: Int32 = -1) {
        if fd >= 0 { Darwin.close(fd) }
        log.error("Local socket failed at \(stage, privacy: .public); errno=\(code)")
        finish(.failure(NSError(domain: NSPOSIXErrorDomain, code: Int(code), userInfo: [
            NSLocalizedDescriptionKey: "Local server \(stage) failed (errno \(code)): \(String(cString: strerror(code)))"
        ])))
    }

    func stop() {
        queue.async { [self] in
            readyURL = nil
            finish(.failure(ServerError.unavailable))
            listener?.cancel()
        }
    }

    private func acceptConnections(_ fd: Int32) {
        // Limit work per dispatch and concurrent clients; never block the UI.
        for _ in 0..<16 {
            let client = Darwin.accept(fd, nil, nil)
            guard client >= 0 else { return }
            guard activeConnections < 16 else { Darwin.close(client); continue }
            activeConnections += 1
            DispatchQueue.global(qos: .userInitiated).async { [self] in
                serve(client)
                queue.async { [self] in activeConnections -= 1 }
            }
        }
    }

    private func serve(_ fd: Int32) {
        defer { Darwin.close(fd) }
        var noSignal: Int32 = 1
        var timeout = timeval(tv_sec: 5, tv_usec: 0)
        guard fcntl(fd, F_SETFL, 0) == 0,
              setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &noSignal, socklen_t(MemoryLayout.size(ofValue: noSignal))) == 0,
              setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &timeout, socklen_t(MemoryLayout.size(ofValue: timeout))) == 0,
              setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &timeout, socklen_t(MemoryLayout.size(ofValue: timeout))) == 0 else { return }
        var request = Data()
        var buffer = [UInt8](repeating: 0, count: 16_384)
        let deadline = ProcessInfo.processInfo.systemUptime + 10
        while request.range(of: Data("\r\n\r\n".utf8)) == nil {
            guard request.count < 65_536, ProcessInfo.processInfo.systemUptime < deadline else { return }
            let count = Darwin.recv(fd, &buffer, min(buffer.count, 65_536 - request.count), 0)
            if count < 0 && errno == EINTR { continue }
            guard count > 0 else { return }
            request.append(contentsOf: buffer.prefix(count))
        }
        let payload = response(for: request)
        payload.withUnsafeBytes { bytes in
            guard let base = bytes.baseAddress else { return }
            var offset = 0
            while offset < bytes.count {
                guard ProcessInfo.processInfo.systemUptime < deadline else { return }
                let sent = Darwin.send(fd, base.advanced(by: offset), bytes.count - offset, 0)
                if sent < 0 && errno == EINTR { continue }
                guard sent > 0 else { return }
                offset += sent
            }
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
