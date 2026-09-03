import Foundation

enum ICloudBackupStore {
    private static let containerIdentifier = "iCloud.dev.universal-task-manager"
    private static let directoryName = "Universal Task Manager/Backups"
    private static let currentName = "automatic-current.utmb"
    private static let previousName = "automatic-previous.utmb"

    enum BackupError: LocalizedError {
        case unavailable
        case invalidFormat

        var errorDescription: String? {
            switch self {
            case .unavailable: return "iCloud Drive is unavailable. Enable iCloud Drive for Universal and try again."
            case .invalidFormat: return "The app refused an invalid encrypted backup."
            }
        }
    }

    static func saveAutomaticBackup(_ data: Data) throws {
        guard isEncryptedRecovery(data) else { throw BackupError.invalidFormat }
        guard let root = FileManager.default.url(forUbiquityContainerIdentifier: containerIdentifier) else { throw BackupError.unavailable }
        let directory = root.appendingPathComponent("Documents", isDirectory: true).appendingPathComponent(directoryName, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let current = directory.appendingPathComponent(currentName)
        let previous = directory.appendingPathComponent(previousName)
        let temporary = directory.appendingPathComponent(".incoming-\(UUID().uuidString).utmb")
        try data.write(to: temporary, options: .atomic)
        var coordinatorError: NSError?
        let coordinator = NSFileCoordinator(filePresenter: nil)
        coordinator.coordinate(writingItemAt: directory, options: .forReplacing, error: &coordinatorError) { _ in
            do {
                if FileManager.default.fileExists(atPath: current.path) {
                    try? FileManager.default.removeItem(at: previous)
                    try FileManager.default.copyItem(at: current, to: previous)
                    _ = try FileManager.default.replaceItemAt(current, withItemAt: temporary, backupItemName: nil, options: [])
                } else {
                    try FileManager.default.moveItem(at: temporary, to: current)
                }
            } catch {
                try? FileManager.default.removeItem(at: temporary)
                coordinatorError = error as NSError
            }
        }
        if let coordinatorError { throw coordinatorError }
    }

    private static func isEncryptedRecovery(_ data: Data) -> Bool {
        guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              object["magic"] as? String == "UTM-LOCAL-ENCRYPTED",
              object["version"] as? Int == 1,
              object["metadata"] as? [String: Any] != nil,
              object["workspace"] as? [String: Any] != nil else { return false }
        return true
    }
}
