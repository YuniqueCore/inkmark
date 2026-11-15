import XCTest

final class WorkspaceUITests: XCTestCase {
    @MainActor private func tapReady(_ element: XCUIElement) {
        expectation(for: NSPredicate(format: "enabled == true AND hittable == true"), evaluatedWith: element)
        waitForExpectations(timeout: 10)
        element.tap()
    }

    @MainActor func testNativeFormAndOfflineMarkdownSurviveProcessRestart() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launch()
        let create = app.buttons["welcome-new"]
        XCTAssertTrue(create.waitForExistence(timeout: 20), app.debugDescription)
        create.tap()
        let input = app.otherElements["text-entry"].textViews.firstMatch
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
        tapReady(app.descendants(matching: .any)["reading-preview"].firstMatch)
        XCTAssertTrue(app.webViews.staticTexts["Native iOS review"].waitForExistence(timeout: 5))
        XCTAssertEqual(app.webViews.textViews.count, 0, "Editing forms must be native, outside the document WebView")
        let actions = app.descendants(matching: .any)["workspace-menu"].firstMatch
        tapReady(actions)
        let searchAction = app.descendants(matching: .any)["action-search"].firstMatch
        expectation(for: NSPredicate(format: "enabled == true AND hittable == true"), evaluatedWith: searchAction)
        waitForExpectations(timeout: 10)
        // Cancel outside the sheet and immediately request another opening: closing must finish first.
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.14)).tap()
        tapReady(actions)
        tapReady(app.descendants(matching: .any)["action-search"].firstMatch)
        let query = app.otherElements["search-query"].textFields.firstMatch
        XCTAssertTrue(query.waitForExistence(timeout: 5), app.debugDescription)
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
        query.tap(); query.typeText("STABLE")
        XCTAssertTrue(app.keyboards.firstMatch.exists, "This interaction must run with the native keyboard open")
        XCTAssertTrue(app.staticTexts["命中 1 处"].waitForExistence(timeout: 5))
        // The first tap must perform the action, rather than only dismiss the keyboard.
        let caseSensitive = app.buttons["区分大小写"]
        caseSensitive.tap()
        expectation(for: NSPredicate(format: "selected == true"), evaluatedWith: caseSensitive)
        waitForExpectations(timeout: 5)
        XCTAssertTrue(app.staticTexts["命中 0 处"].waitForExistence(timeout: 5))
        XCTAssertEqual(query.value as? String, "STABLE", "Changing options must preserve native input")
        app.buttons["form-close"].tap()
        let saved = app.staticTexts["native-save-status"]
        XCTAssertTrue(saved.waitForExistence(timeout: 5))
        expectation(for: NSPredicate(format: "label == %@", "已保存"), evaluatedWith: saved)
        waitForExpectations(timeout: 10)
        app.terminate(); app.launch()
        XCTAssertTrue(app.webViews.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "Native iOS review")).firstMatch.waitForExistence(timeout: 20))
        expectation(for: NSPredicate(format: "label == %@", "已保存"), evaluatedWith: app.staticTexts["native-save-status"])
        let library = app.buttons["documents-toggle"]
        expectation(for: NSPredicate(format: "hittable == true AND enabled == true"), evaluatedWith: library)
        waitForExpectations(timeout: 10)
        XCTAssertFalse(library.isSelected)
        library.tap()
        expectation(for: NSPredicate(format: "selected == true"), evaluatedWith: library)
        waitForExpectations(timeout: 10)
        XCTAssertTrue(app.buttons["new-document"].waitForExistence(timeout: 5), app.debugDescription)
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "native-library-after-offline-restart"; attachment.lifetime = .keepAlways
        add(attachment)
    }
}
