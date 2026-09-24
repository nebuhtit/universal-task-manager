import Foundation
import UniformTypeIdentifiers
import UIKit
import WebKit

final class NativeBackupBridge: NSObject, WKScriptMessageHandler, UIDocumentPickerDelegate {
    weak var webView: WKWebView?
    private let queue = DispatchQueue(label: "dev.universal-task-manager.icloud-backup")
    private var transfers: [String: (fileName: String, data: Data, expectedBytes: Int, destination: String)] = [:]
    private var exporting: (id: String, url: URL)?
    private let maximumBackupBytes = 100 * 1024 * 1024

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let payload = message.body as? [String: Any],
              let id = payload["id"] as? String,
              let kind = payload["kind"] as? String else { return }
        switch kind {
        case "backup.begin":
            let fileName = (payload["fileName"] as? String) ?? "universal-backup.utmb"
            let expected = (payload["byteLength"] as? NSNumber)?.intValue ?? 0
            guard expected > 0 && expected <= maximumBackupBytes else { sendStatus(id: id, error: "Backup size is invalid or too large."); return }
            let destination = payload["destination"] as? String ?? "icloud"
            queue.async { self.transfers[id] = (fileName, Data(), expected, destination) }
        case "backup.chunk":
            guard let value = payload["value"] as? String else { sendStatus(id: id, error: "Backup chunk is invalid."); return }
            queue.async {
                guard var active = self.transfers[id] else { return }
                guard let bytes = value.data(using: .utf8), active.data.count + bytes.count <= self.maximumBackupBytes else { self.transfers[id] = nil; self.sendStatus(id: id, error: "Backup is too large."); return }
                active.data.append(bytes)
                self.transfers[id] = active
            }
        case "backup.end":
            queue.async {
                guard let active = self.transfers.removeValue(forKey: id) else { self.sendStatus(id: id, error: "Backup transfer was interrupted."); return }
                guard active.data.count == active.expectedBytes else { self.sendStatus(id: id, error: "Backup size verification failed."); return }
                do {
                    if active.destination == "files" {
                        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
                        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
                        let url = directory.appendingPathComponent(URL(fileURLWithPath: active.fileName).lastPathComponent)
                        try active.data.write(to: url, options: .atomic)
                        DispatchQueue.main.async { self.showExport(id: id, url: url) }
                    } else { try ICloudBackupStore.saveAutomaticBackup(active.data); self.sendStatus(id: id) }
                }
                catch { self.sendStatus(id: id, error: error.localizedDescription) }
            }
        case "backup.import":
            DispatchQueue.main.async { [weak self] in self?.showPicker() }
        default:
            break
        }
    }

    func showExport(id: String, url: URL) {
        guard exporting == nil, let presenter = webView?.window?.rootViewController else {
            try? FileManager.default.removeItem(at: url.deletingLastPathComponent())
            sendStatus(id: id, error: "Another file picker is already open.")
            return
        }
        exporting = (id, url)
        let picker = UIDocumentPickerViewController(forExporting: [url], asCopy: true)
        picker.delegate = self
        presenter.present(picker, animated: true)
    }

    private func finishExport(error: String? = nil) {
        guard let export = exporting else { return }
        exporting = nil
        try? FileManager.default.removeItem(at: export.url.deletingLastPathComponent())
        sendStatus(id: export.id, error: error)
    }

    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        finishExport(error: "Backup export cancelled; no file was saved.")
    }

    private func showPicker() {
        let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.data], asCopy: false)
        picker.delegate = self
        picker.allowsMultipleSelection = false
        webView?.window?.rootViewController?.present(picker, animated: true)
    }

    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        if exporting != nil { finishExport(); return }
        guard let url = urls.first else { return }
        let hasAccess = url.startAccessingSecurityScopedResource()
        defer { if hasAccess { url.stopAccessingSecurityScopedResource() } }
        do {
            let source = try String(contentsOf: url, encoding: .utf8)
            guard source.utf8.count <= maximumBackupBytes else { throw NSError(domain: "Universal", code: 1, userInfo: [NSLocalizedDescriptionKey: "Selected backup is too large."]) }
            sendImportedBackup(source, fileName: url.lastPathComponent)
        } catch { sendStatus(id: "import", error: error.localizedDescription) }
    }

    private func sendImportedBackup(_ source: String, fileName: String) {
        let id = UUID().uuidString
        sendImportMessage(["kind": "begin", "id": id, "fileName": fileName])
        let chunkSize = 48_000
        var offset = source.startIndex
        while offset < source.endIndex {
            let end = source.index(offset, offsetBy: chunkSize, limitedBy: source.endIndex) ?? source.endIndex
            sendImportMessage(["kind": "chunk", "id": id, "value": String(source[offset..<end])])
            offset = end
        }
        sendImportMessage(["kind": "end", "id": id])
    }

    private func sendImportMessage(_ message: [String: String]) {
        guard let data = try? JSONSerialization.data(withJSONObject: message), let json = String(data: data, encoding: .utf8) else { return }
        DispatchQueue.main.async { [weak self] in self?.webView?.evaluateJavaScript("window.__utmNativeBackupReceive && window.__utmNativeBackupReceive(\(json));") }
    }

    private func sendStatus(id: String, error: String? = nil) {
        let payload: [String: Any] = ["id": id, "ok": error == nil, "error": error ?? NSNull()]
        guard let data = try? JSONSerialization.data(withJSONObject: payload), let json = String(data: data, encoding: .utf8) else { return }
        DispatchQueue.main.async { [weak self] in self?.webView?.evaluateJavaScript("window.dispatchEvent(new CustomEvent('utm-native-backup-status', { detail: \(json) }));") }
    }
}
