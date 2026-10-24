import Foundation
import WebKit

/// HTTPS-only WebDAV for the bundled app. No credential persistence, redirects,
/// cookies or certificate exceptions; browser builds use their normal CORS rules.
final class NativeWebDAVBridge: NSObject, WKScriptMessageHandler {
    weak var webView: WKWebView?
    private var requests: [String: WebDAVTransfer] = [:]

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.webView === webView, message.frameInfo.isMainFrame,
              let host = message.webView?.url?.host, ["127.0.0.1", "localhost"].contains(host),
              let payload = message.body as? [String: Any], let id = payload["id"] as? String else { return }
        if payload["kind"] as? String == "cancel" { requests.removeValue(forKey: id)?.cancel(); return }
        guard payload["kind"] as? String == "request", requests[id] == nil,
              let address = payload["url"] as? String, let url = URL(string: address),
              url.scheme == "https", url.user == nil, url.password == nil, url.host != nil,
              let method = payload["method"] as? String, ["GET", "PUT", "MKCOL", "OPTIONS", "DELETE", "MOVE", "LOCK", "UNLOCK", "PROPFIND"].contains(method),
              let headers = payload["headers"] as? [String: String] else { respond(id, ["error": "invalid-request"]); return }
        let timeout = min(30.0, max(3.0, (payload["timeoutMs"] as? Double ?? 30_000) / 1_000))
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: timeout)
        request.httpMethod = method
        if method == "MOVE" {
            let source = headers["X-UTM-WebDAV-Target"].flatMap(URL.init(string:)) ?? url
            guard let destination = headers["Destination"], let target = URL(string: destination),
                  target.scheme == "https", target.user == nil, target.password == nil,
                  source.scheme == "https", source.user == nil, source.password == nil,
                  target.host == source.host, target.port == source.port, headers["Overwrite"] == "F" else {
                respond(id, ["error": "invalid-destination"]); return
            }
        }
        for (key, value) in headers where ["authorization", "content-type", "accept-encoding", "origin", "x-utm-webdav-target", "if-match", "if-none-match", "destination", "overwrite", "if", "lock-token", "depth", "timeout"].contains(key.lowercased()) {
            guard !value.contains("\r"), !value.contains("\n") else { respond(id, ["error": "invalid-header"]); return }
            request.setValue(value, forHTTPHeaderField: key)
        }
        if let body = payload["body"] as? String {
            let data = Data(body.utf8)
            guard data.count <= 20 * 1024 * 1024 else { respond(id, ["error": "too-large"]); return }
            request.httpBody = data
        }
        let transfer = WebDAVTransfer { [weak self] result in
            DispatchQueue.main.async { self?.requests.removeValue(forKey: id); self?.respond(id, result) }
        }
        requests[id] = transfer
        transfer.start(request)
    }

    private func respond(_ id: String, _ result: [String: Any]) {
        var message = result; message["id"] = id
        guard let bytes = try? JSONSerialization.data(withJSONObject: message), let json = String(data: bytes, encoding: .utf8) else { return }
        webView?.evaluateJavaScript("window.dispatchEvent(new CustomEvent('utm-webdav-response',{detail:\(json)}));", completionHandler: nil)
    }
}

private final class WebDAVTransfer: NSObject, URLSessionDataDelegate, URLSessionTaskDelegate {
    private var session: URLSession?
    private var data = Data()
    private var response: HTTPURLResponse?
    private let completion: ([String: Any]) -> Void
    private let maximumBytes = 20 * 1024 * 1024
    init(completion: @escaping ([String: Any]) -> Void) { self.completion = completion }
    func start(_ request: URLRequest) {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpCookieStorage = nil; configuration.urlCredentialStorage = nil; configuration.urlCache = nil
        configuration.timeoutIntervalForRequest = request.timeoutInterval; configuration.timeoutIntervalForResource = request.timeoutInterval
        let session = URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
        self.session = session; session.dataTask(with: request).resume()
    }
    func cancel() { session?.invalidateAndCancel(); session = nil }
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse, completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        self.response = response as? HTTPURLResponse
        completionHandler(response.expectedContentLength > Int64(maximumBytes) ? .cancel : .allow)
    }
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        if self.data.count + data.count > maximumBytes { dataTask.cancel(); return }
        self.data.append(data)
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        defer { session.finishTasksAndInvalidate(); self.session = nil }
        if let error = error as NSError? {
            let category: String
            switch error.code {
            case NSURLErrorTimedOut: category = "timeout"
            case NSURLErrorCannotFindHost, NSURLErrorDNSLookupFailed: category = "dns"
            case NSURLErrorNotConnectedToInternet: category = "offline"
            case NSURLErrorCancelled: category = "cancelled"
            case NSURLErrorSecureConnectionFailed, NSURLErrorServerCertificateUntrusted, NSURLErrorServerCertificateHasBadDate, NSURLErrorServerCertificateHasUnknownRoot: category = "tls"
            default: category = "network"
            }
            // Never export localizedDescription/userInfo: they may contain URLs.
            completion(["error": "network", "errorCode": error.code, "errorCategory": category]); return
        }
        guard let response, let text = String(data: data, encoding: .utf8) else { completion(["error": "network", "errorCategory": "network"]); return }
        var result: [String: Any] = ["status": response.statusCode, "text": text]
        if let etag = response.value(forHTTPHeaderField: "ETag") { result["etag"] = etag }
        if let etag = response.value(forHTTPHeaderField: "X-UTM-WebDAV-ETag") { result["originEtag"] = etag }
        if let code = response.value(forHTTPHeaderField: "X-UTM-WebDAV-Error") { result["proxyError"] = code }
        if let token = response.value(forHTTPHeaderField: "Lock-Token") { result["lockToken"] = token }
        if let timeout = response.value(forHTTPHeaderField: "Timeout") { result["lockTimeout"] = timeout }
        completion(result)
    }
}
