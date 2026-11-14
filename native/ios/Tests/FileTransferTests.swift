import XCTest
@testable import InkMark

final class FileTransferTests: XCTestCase {
    func testShareAndReimportRetainUnicodeNamesAndExactBytesAndRejectTraversal() throws {
        for name in ["../secret", "a\\b", "a\n/../b", ".", ".."] {
            XCTAssertThrowsError(try ExportFile(["name": name, "type": "application/json", "base64": "e30="]))
        }
        let bytes = Data("{\"review\":\"审阅 😀\"}".utf8)
        let file = try ExportFile(["name": "审阅.json", "type": "application/json", "base64": bytes.base64EncodedString()])
        let url = try file.write()
        defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
        XCTAssertEqual(try Data(contentsOf: url), bytes)
        let imported = try DocumentPicker.read([url])
        XCTAssertEqual(imported.first?["name"], "审阅.json")
        XCTAssertEqual(imported.first?["base64"], bytes.base64EncodedString())
        let handle = try FileHandle(forWritingTo: url)
        try handle.truncate(atOffset: UInt64(ExportFile.maxBytes + 1)); try handle.close()
        XCTAssertThrowsError(try DocumentPicker.read([url]))
        XCTAssertThrowsError(try DocumentPicker.read(Array(repeating: url, count: 101)))
        XCTAssertThrowsError(try ExportFile(["name": "script.html", "type": "text/html", "base64": "e30="]))
    }
}
