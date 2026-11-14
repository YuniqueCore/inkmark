import XCTest

final class WorkspaceUITests: XCTestCase {
    @MainActor func testOfflineMarkdownSurvivesProcessRestart() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launch()
        let create = app.webViews.buttons.matching(NSPredicate(format: "label CONTAINS %@", "粘贴新建文档")).firstMatch
        XCTAssertTrue(create.waitForExistence(timeout: 20), app.staticTexts["workspace-error"].exists
            ? app.staticTexts["workspace-error"].label : app.debugDescription)
        create.tap()
        let input = app.webViews.textViews["新文档内容"]
        XCTAssertTrue(input.waitForExistence(timeout: 5))
        input.tap(); input.typeText("# Native iOS review\n\nA **stable primitive** composes.")
        app.webViews.buttons["创建文档"].tap()
        // WebKit exposes aria-pressed buttons as accessibility switches.
        let preview = app.webViews.switches["预览"]
        XCTAssertTrue(preview.waitForExistence(timeout: 5)); preview.tap()
        XCTAssertEqual(preview.value as? String, "1")
        XCTAssertTrue(app.webViews.staticTexts["Native iOS review"].waitForExistence(timeout: 5))
        let saved = app.webViews.otherElements.matching(NSPredicate(format: "label BEGINSWITH %@", "已保存")).firstMatch
        XCTAssertTrue(saved.waitForExistence(timeout: 10))
        app.terminate(); app.launch()
        XCTAssertTrue(app.webViews.staticTexts["Native iOS review"].waitForExistence(timeout: 20))
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "offline-markdown-after-restart"; attachment.lifetime = .keepAlways
        add(attachment)
    }
}
