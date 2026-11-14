import Foundation

enum ExportError: LocalizedError {
    case message(String)
    var errorDescription: String? {
        switch self { case let .message(message): return message }
    }
}

/** Bytes for a system share, with a host-owned filename and bounded temporary lifetime. */
struct ExportFile: Sendable {
    static let maxBytes = 32 * 1024 * 1024
    let name: String
    let bytes: Data

    init(_ value: Any?) throws {
        guard let values = value as? [String: Any], values.count == 3,
              let name = values["name"] as? String, let type = values["type"] as? String,
              let base64 = values["base64"] as? String else { throw ExportError.message("无效的导出请求") }
        try Self.validateName(name)
        let mediaType = String(type.split(separator: ";", maxSplits: 1).first ?? "")
        guard ["application/json", "application/zip", "text/markdown", "text/plain"].contains(mediaType),
              base64.utf8.count <= (Self.maxBytes + 2) / 3 * 4,
              let bytes = Data(base64Encoded: base64), bytes.count <= Self.maxBytes else {
            throw ExportError.message("导出内容无效或超过 32 MB")
        }
        self.name = name
        self.bytes = bytes
    }

    static func validateName(_ name: String) throws {
        guard !name.isEmpty, name.utf16.count <= 255, name != ".", name != "..",
              !name.contains("/"), !name.contains("\\"), !name.unicodeScalars.contains(where: { $0.value < 32 || $0.value == 127 }) else {
            throw ExportError.message("无效的文件名")
        }
    }

    func write() throws -> URL {
        let manager = FileManager.default
        let cache = try manager.url(for: .cachesDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
            .appendingPathComponent("inkmark-exports", isDirectory: true)
        try manager.createDirectory(at: cache, withIntermediateDirectories: true)
        var used = 0
        let expiration = Date().addingTimeInterval(-24 * 60 * 60)
        for directory in try manager.contentsOfDirectory(at: cache, includingPropertiesForKeys: nil) {
            for file in try manager.contentsOfDirectory(at: directory, includingPropertiesForKeys: [.contentModificationDateKey, .fileSizeKey]) {
                let values = try file.resourceValues(forKeys: [.contentModificationDateKey, .fileSizeKey])
                if let modified = values.contentModificationDate, modified < expiration { try manager.removeItem(at: file) }
                else { used += values.fileSize ?? 0 }
            }
            if try manager.contentsOfDirectory(atPath: directory.path).isEmpty { try manager.removeItem(at: directory) }
        }
        guard used + bytes.count <= 512 * 1024 * 1024 else {
            throw ExportError.message("导出缓存已满；较早文件会在 24 小时后自动清理，请稍后重试")
        }
        let directory = cache.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try manager.createDirectory(at: directory, withIntermediateDirectories: false)
        let file = directory.appendingPathComponent(name)
        do { try bytes.write(to: file, options: .atomic) }
        catch { try? manager.removeItem(at: directory); throw error }
        return file
    }
}
