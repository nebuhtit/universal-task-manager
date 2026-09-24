import SwiftUI
import UIKit
import WebKit
import AuthenticationServices
import CryptoKit
import LocalAuthentication
import Security

struct WebAppView: UIViewRepresentable {
    let startURL: URL

    func makeCoordinator() -> Coordinator {
        Coordinator(localOrigin: startURL)
    }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.userContentController.add(context.coordinator.backupBridge, name: "utmNativeBackup")
        configuration.userContentController.add(context.coordinator.reminderBridge, name: "utmNativeReminders")
        configuration.userContentController.add(context.coordinator.googleBridge, name: "utmNativeGoogleAuth")
        configuration.userContentController.addScriptMessageHandler(context.coordinator.biometricBridge, contentWorld: .page, name: "utmNativeBiometrics")
        configuration.websiteDataStore = .default()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true
        configuration.allowsInlineMediaPlayback = true

        let webView = WKWebView(frame: .zero, configuration: configuration)
        context.coordinator.backupBridge.webView = webView
        context.coordinator.reminderBridge.webView = webView
        context.coordinator.googleBridge.webView = webView
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.isOpaque = false
        webView.backgroundColor = .systemBackground
        webView.load(URLRequest(url: startURL, cachePolicy: .reloadIgnoringLocalCacheData))
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
        var localOrigin: URL
        let backupBridge = NativeBackupBridge()
        let reminderBridge = NativeReminderBridge()
        let googleBridge = NativeGoogleAuthBridge()
        let biometricBridge = NativeBiometricBridge()
        private var downloads: [ObjectIdentifier: URL] = [:]

        private func presenter(_ webView: WKWebView) -> UIViewController? {
            var controller = webView.window?.rootViewController
            while let next = controller?.presentedViewController { controller = next }
            return controller
        }

        func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
            guard let host = presenter(webView) else { completionHandler(); return }
            let alert = UIAlertController(title: "Universal", message: message, preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
            host.present(alert, animated: true)
        }

        func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
            guard let host = presenter(webView) else { completionHandler(false); return }
            let alert = UIAlertController(title: "Universal", message: message, preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(false) })
            alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(true) })
            host.present(alert, animated: true)
        }

        func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
            guard let host = presenter(webView) else { completionHandler(nil); return }
            let alert = UIAlertController(title: "Universal", message: prompt, preferredStyle: .alert)
            alert.addTextField { field in
                field.text = defaultText
                field.isSecureTextEntry = prompt.lowercased().contains("password") || prompt.lowercased().contains("парол")
                field.textContentType = field.isSecureTextEntry ? .password : nil
            }
            alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(nil) })
            alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(alert.textFields?.first?.text) })
            host.present(alert, animated: true)
        }

        func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) { download.delegate = self }
        func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) { download.delegate = self }
        func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
            decisionHandler(navigationResponse.canShowMIMEType ? .allow : .download)
        }
        func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
            let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
            do {
                try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
                let url = directory.appendingPathComponent(URL(fileURLWithPath: suggestedFilename).lastPathComponent)
                downloads[ObjectIdentifier(download)] = url
                completionHandler(url)
            } catch { completionHandler(nil) }
        }
        func downloadDidFinish(_ download: WKDownload) {
            guard let url = downloads.removeValue(forKey: ObjectIdentifier(download)) else { return }
            backupBridge.showExport(id: UUID().uuidString, url: url)
        }
        func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
            if let url = downloads.removeValue(forKey: ObjectIdentifier(download)) { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
        }

        init(localOrigin: URL) {
            self.localOrigin = localOrigin
        }

        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationAction: WKNavigationAction,
            decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
        ) {
            guard let url = navigationAction.request.url else {
                decisionHandler(.cancel)
                return
            }

            if navigationAction.shouldPerformDownload { decisionHandler(.download); return }

            let isLocal = url.host == localOrigin.host && url.port == localOrigin.port
            if isLocal || url.scheme == "about" {
                decisionHandler(.allow)
                return
            }

            if let scheme = url.scheme,
               ["http", "https", "mailto", "tel"].contains(scheme) {
                UIApplication.shared.open(url)
            }
            decisionHandler(.cancel)
        }

        func webView(
            _ webView: WKWebView,
            createWebViewWith configuration: WKWebViewConfiguration,
            for navigationAction: WKNavigationAction,
            windowFeatures: WKWindowFeatures
        ) -> WKWebView? {
            guard let url = navigationAction.request.url else { return nil }
            let isLocal = url.host == localOrigin.host && url.port == localOrigin.port
            if isLocal {
                webView.load(navigationAction.request)
            } else {
                UIApplication.shared.open(url)
            }
            return nil
        }
    }
}

/// A per-enrollment wrapping key, never a password. Keychain enforces biometrics
/// on each read; no synchronizable item, passcode fallback or transferable key.
final class NativeBiometricBridge: NSObject, WKScriptMessageHandlerWithReply {
    private let service = "dev.universal-task-manager.biometric-unlock.v1"
    private var busy = false

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage, replyHandler: @escaping (Any?, String?) -> Void) {
        let origin = message.frameInfo.securityOrigin
        guard message.frameInfo.isMainFrame, origin.protocol == "http", origin.host == "127.0.0.1", origin.port == 49381,
              let body = message.body as? [String: Any], let kind = body["kind"] as? String else {
            replyHandler(nil, "Untrusted Face ID request"); return
        }
        guard !busy else { replyHandler(nil, "Face ID is already active"); return }
        let context = LAContext()
        context.localizedFallbackTitle = ""
        if kind == "status" {
            replyHandler(["available": context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil)], nil)
            return
        }
        let id = body["id"] as? String
        guard (kind == "remove" && id == nil) || (id.flatMap { UUID(uuidString: $0) } != nil) else {
            replyHandler(nil, "Invalid Face ID key identifier"); return
        }
        guard ["create", "read", "remove"].contains(kind) else { replyHandler(nil, "Unknown Face ID operation"); return }
        busy = true
        let finish: (Any?, String?) -> Void = { value, error in
            DispatchQueue.main.async { self.busy = false; replyHandler(value, error) }
        }
        var query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service]
        if let id { query[kSecAttrAccount as String] = id }
        if kind == "remove" {
            let status = SecItemDelete(query as CFDictionary)
            finish(status == errSecSuccess || status == errSecItemNotFound ? [:] : nil,
                   status == errSecSuccess || status == errSecItemNotFound ? nil : "Cannot remove Face ID key")
            return
        }
        if kind == "read" {
            query[kSecReturnData as String] = true
            query[kSecMatchLimit as String] = kSecMatchLimitOne
            context.localizedReason = "Unlock your Universal workspace"
            query[kSecUseAuthenticationContext as String] = context
            let readQuery = query
            DispatchQueue.global(qos: .userInitiated).async {
                var value: CFTypeRef?
                let status = SecItemCopyMatching(readQuery as CFDictionary, &value)
                guard status == errSecSuccess, let key = value as? Data, key.count == 32 else {
                    finish(nil, "Face ID cancelled or key unavailable. Use your workspace password."); return
                }
                finish(["key": key.base64EncodedString()], nil)
            }
            return
        }
        guard context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil) else {
            finish(nil, "Set up Face ID or Touch ID in device settings first"); return
        }
        let createQuery = query
        context.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, localizedReason: "Enable quick unlock for this workspace") { success, _ in
            guard success else { finish(nil, "Face ID setup cancelled"); return }
            guard let access = SecAccessControlCreateWithFlags(nil, kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly, .biometryCurrentSet, nil) else {
                finish(nil, "Cannot protect Face ID key"); return
            }
            var key = Data(count: 32)
            let status = key.withUnsafeMutableBytes { SecRandomCopyBytes(kSecRandomDefault, 32, $0.baseAddress!) }
            guard status == errSecSuccess else { finish(nil, "Cannot create Face ID key"); return }
            var attributes = createQuery
            attributes[kSecAttrAccessControl as String] = access
            attributes[kSecValueData as String] = key
            guard SecItemAdd(attributes as CFDictionary, nil) == errSecSuccess else {
                finish(nil, "Cannot save Face ID key"); return
            }
            finish(["key": key.base64EncodedString()], nil)
        }
    }
}

final class NativeGoogleAuthBridge: NSObject, WKScriptMessageHandler, ASWebAuthenticationPresentationContextProviding {
    weak var webView: WKWebView?
    private var session: ASWebAuthenticationSession?
    private var activeRequestID: String?

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        webView?.window ?? ASPresentationAnchor()
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame, let payload = message.body as? [String: Any], let id = payload["id"] as? String else { return }
        guard session == nil else { reply(id, error: "Google sign-in is already open."); return }
        let client = (Bundle.main.object(forInfoDictionaryKey: "UTMGoogleIOSClientID") as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard client.hasSuffix(".apps.googleusercontent.com"), !client.contains("$(") else {
            reply(id, error: "Set GOOGLE_IOS_CLIENT_ID and GOOGLE_IOS_REVERSED_CLIENT_ID in Xcode using an OAuth client of type iOS for this Bundle ID. The website client cannot authorize the offline iOS app.")
            return
        }
        let scheme = client.components(separatedBy: ".").reversed().joined(separator: ".")
        let registered = (Bundle.main.object(forInfoDictionaryKey: "CFBundleURLTypes") as? [[String: Any]] ?? []).flatMap { $0["CFBundleURLSchemes"] as? [String] ?? [] }
        guard registered.contains(scheme) else { reply(id, error: "GOOGLE_IOS_REVERSED_CLIENT_ID does not match the iOS OAuth client."); return }
        let allowed = Set(["https://www.googleapis.com/auth/calendar.readonly", "https://www.googleapis.com/auth/calendar.events", "https://www.googleapis.com/auth/calendar.calendarlist.readonly"])
        guard let scopes = payload["scopes"] as? [String], !scopes.isEmpty, Set(scopes).isSubset(of: allowed) else { reply(id, error: "Invalid Calendar scopes."); return }
        let state = UUID().uuidString
        let verifier = UUID().uuidString.replacingOccurrences(of: "-", with: "") + UUID().uuidString.replacingOccurrences(of: "-", with: "")
        let challenge = Data(SHA256.hash(data: Data(verifier.utf8))).base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
        let redirect = "\(scheme):/oauthredirect"
        var url = URLComponents(string: "https://accounts.google.com/o/oauth2/v2/auth")!
        url.queryItems = ["client_id": client, "redirect_uri": redirect, "response_type": "code", "scope": scopes.joined(separator: " "), "state": state, "code_challenge": challenge, "code_challenge_method": "S256"].map { URLQueryItem(name: $0.key, value: $0.value) }
        let auth = ASWebAuthenticationSession(url: url.url!, callbackURLScheme: scheme) { [weak self] callback, error in
            guard let self else { return }
            guard let callback, error == nil, let parts = URLComponents(url: callback, resolvingAgainstBaseURL: false), parts.queryItems?.first(where: { $0.name == "state" })?.value == state,
                  let code = parts.queryItems?.first(where: { $0.name == "code" })?.value else {
                self.reply(id, error: "Google sign-in was cancelled or its response was invalid."); return
            }
            var form = URLComponents()
            form.queryItems = ["client_id": client, "redirect_uri": redirect, "code": code, "code_verifier": verifier, "grant_type": "authorization_code"].map { URLQueryItem(name: $0.key, value: $0.value) }
            var request = URLRequest(url: URL(string: "https://oauth2.googleapis.com/token")!, timeoutInterval: 30)
            request.httpMethod = "POST"
            request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
            request.httpBody = form.percentEncodedQuery?.replacingOccurrences(of: "+", with: "%2B").data(using: .utf8)
            URLSession.shared.dataTask(with: request) { data, response, error in
                guard error == nil, (response as? HTTPURLResponse)?.statusCode == 200, let data,
                      let result = try? JSONSerialization.jsonObject(with: data) as? [String: Any], let token = result["access_token"] as? String else {
                    self.reply(id, error: "Google token exchange failed. Check the iOS OAuth client configuration."); return
                }
                self.reply(id, values: ["accessToken": token, "expiresIn": result["expires_in"] ?? 3600, "scope": result["scope"] ?? ""])
            }.resume()
        }
        auth.presentationContextProvider = self
        activeRequestID = id
        session = auth
        if !auth.start() { reply(id, error: "Could not open Google sign-in.") }
    }

    private func reply(_ id: String, values: [String: Any] = [:], error: String? = nil) {
        var result = values
        result["id"] = id
        result["ok"] = error == nil
        if let error { result["error"] = error }
        guard let data = try? JSONSerialization.data(withJSONObject: result), let json = String(data: data, encoding: .utf8) else { return }
        DispatchQueue.main.async {
            if self.activeRequestID == id { self.session = nil; self.activeRequestID = nil }
            self.webView?.evaluateJavaScript("window.dispatchEvent(new CustomEvent('utm-native-google-status', {detail: \(json)}));")
        }
    }
}
