import Foundation
import UniformTypeIdentifiers

/** Reads security-scoped user selections with a strict aggregate bound, including unknown file sizes. */
enum DocumentPicker {
    static func read(_ urls: [URL]) throws -> [[String: String]] {
        guard urls.count <= 100 else { throw ExportError.message("一次最多导入 100 个文件") }
        var total = 0
        return try urls.map { url in
            let access = url.startAccessingSecurityScopedResource()
            defer { if access { url.stopAccessingSecurityScopedResource() } }
            var coordinationError: NSError?
            var result: Result<[String: String], Error>?
            NSFileCoordinator().coordinate(readingItemAt: url, options: [], error: &coordinationError) { coordinated in
                result = Result {
                    let name = coordinated.lastPathComponent
                    try ExportFile.validateName(name)
                    let metadata = try coordinated.resourceValues(forKeys: [.fileSizeKey, .contentTypeKey])
                    let remaining = ExportFile.maxBytes - total
                    if let size = metadata.fileSize, size > remaining { throw ExportError.message("所选文件合计超过 32 MB") }
                    let input = try FileHandle(forReadingFrom: coordinated)
                    defer { try? input.close() }
                    var bytes = Data()
                    while let chunk = try input.read(upToCount: min(65536, remaining - bytes.count + 1)), !chunk.isEmpty {
                        guard bytes.count + chunk.count <= remaining else { throw ExportError.message("所选文件合计超过 32 MB") }
                        bytes.append(chunk)
                    }
                    total += bytes.count
                    return ["name": name, "type": metadata.contentType?.preferredMIMEType ?? "application/octet-stream", "base64": bytes.base64EncodedString()]
                }
            }
            if let coordinationError { throw coordinationError }
            guard let result else { throw ExportError.message("文件提供程序未返回文件") }
            return try result.get()
        }
    }
}
