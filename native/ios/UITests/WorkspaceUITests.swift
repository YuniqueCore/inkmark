import XCTest

final class WorkspaceUITests: XCTestCase {
    @MainActor func testNativeFormAndOfflineMarkdownSurviveProcessRestart() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launch()
        let create = app.buttons["welcome-new"]
        XCTAssertTrue(create.waitForExistence(timeout: 20), app.debugDescription)
        create.tap()
        let input = app.textViews["text-entry"]
        XCTAssertTrue(input.waitForExistence(timeout: 5), app.debugDescription)
        // A fresh simulator may show the system keyboard's introduction on autofocus.
        let introduction = app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "Speed up your typing")).firstMatch
        if introduction.waitForExistence(timeout: 3) { app.buttons["Continue"].tap() }
        input.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5), app.debugDescription)
        input.typeText("# Native iOS review\n\nA **stable primitive** composes.")
        app.buttons["text-submit"].tap()
        let reading = app.descendants(matching: .any)["reading-menu"].firstMatch
        XCTAssertTrue(reading.waitForExistence(timeout: 5), app.debugDescription)
        reading.tap()
        app.descendants(matching: .any)["reading-preview"].firstMatch.tap()
        XCTAssertTrue(app.webViews.staticTexts["Native iOS review"].waitForExistence(timeout: 5))
        XCTAssertEqual(app.webViews.textViews.count, 0, "Editing forms must be native, outside the document WebView")
        let saved = app.staticTexts["native-save-status"]
        XCTAssertTrue(saved.waitForExistence(timeout: 5))
        expectation(for: NSPredicate(format: "label == %@", "已保存"), evaluatedWith: saved)
        waitForExpectations(timeout: 10)
        app.terminate(); app.launch()
        XCTAssertTrue(app.webViews.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "Native iOS review")).firstMatch.waitForExistence(timeout: 20))
        app.buttons["documents-toggle"].tap()
        XCTAssertTrue(app.buttons["new-document"].waitForExistence(timeout: 5), app.debugDescription)
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "native-library-after-offline-restart"; attachment.lifetime = .keepAlways
        add(attachment)
    }
}
