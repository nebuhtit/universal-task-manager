import SwiftUI
import UIKit
import WebKit

struct WebAppView: UIViewRepresentable {
    let startURL: URL

    func makeCoordinator() -> Coordinator {
        Coordinator(localOrigin: startURL)
    }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.userContentController.add(context.coordinator.backupBridge, name: "utmNativeBackup")
        configuration.userContentController.add(context.coordinator.reminderBridge, name: "utmNativeReminders")
        configuration.websiteDataStore = .default()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true
        configuration.allowsInlineMediaPlayback = true

        let webView = WKWebView(frame: .zero, configuration: configuration)
        context.coordinator.backupBridge.webView = webView
        context.coordinator.reminderBridge.webView = webView
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.isOpaque = false
        webView.backgroundColor = .systemBackground
        webView.load(URLRequest(url: startURL, cachePolicy: .reloadIgnoringLocalCacheData))
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
        var localOrigin: URL
        let backupBridge = NativeBackupBridge()
        let reminderBridge = NativeReminderBridge()

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

            let isLocal = url.host == localOrigin.host && url.port == localOrigin.port
            if isLocal || url.scheme == "about" || url.scheme == "blob" {
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
