import XCTest

final class WorkspaceUITests: XCTestCase {
    @MainActor func testOfflineMarkdownSurvivesProcessRestart() throws {
        let app = XCUIApplication()
        app.launch()
        let create = app.webViews.buttons.matching(NSPredicate(format: "label CONTAINS %@", "粘贴新建文档")).firstMatch
        XCTAssertTrue(create.waitForExistence(timeout: 20))
        create.tap()
        let input = app.webViews.textViews["新文档内容"]
        XCTAssertTrue(input.waitForExistence(timeout: 5))
        input.tap(); input.typeText("# Native iOS review\n\nA **stable primitive** composes.")
        app.webViews.buttons["创建文档"].tap()
        let preview = app.webViews.buttons["预览"]
        XCTAssertTrue(preview.waitForExistence(timeout: 5)); preview.tap()
        XCTAssertTrue(app.webViews.staticTexts["Native iOS review"].waitForExistence(timeout: 5))
        let saved = app.webViews.staticTexts["已保存"]
        XCTAssertTrue(saved.waitForExistence(timeout: 10))
        app.terminate(); app.launch()
        XCTAssertTrue(app.webViews.staticTexts["Native iOS review"].waitForExistence(timeout: 20))
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "offline-markdown-after-restart"; attachment.lifetime = .keepAlways
        add(attachment)
    }
}
