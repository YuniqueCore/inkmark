import XCTest

final class WorkspaceUITests: XCTestCase {
    @MainActor private func tapReady(_ element: XCUIElement, app: XCUIApplication) {
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            guard element.exists, element.isEnabled else { return false }
            let frame = element.frame
            guard !frame.isNull, !frame.isEmpty,
                  frame.origin.x.isFinite, frame.origin.y.isFinite,
                  frame.width.isFinite, frame.height.isFinite else { return false }
            // XCTest can throw while determining hittability for an invalid AX rectangle.
            return element.isHittable
        }, object: nil)
        guard XCTWaiter.wait(for: [ready], timeout: 10) == .completed else {
            let hierarchy = XCTAttachment(string: app.debugDescription)
            hierarchy.name = "native-control-not-ready-hierarchy"; hierarchy.lifetime = .keepAlways
            add(hierarchy)
            let screenshot = XCTAttachment(screenshot: app.screenshot())
            screenshot.name = "native-control-not-ready-screen"; screenshot.lifetime = .keepAlways
            add(screenshot)
            XCTFail("Native control did not become enabled with valid screen geometry and hittability")
            return
        }
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
        let reading = app.buttons["reading-menu"]
        XCTAssertTrue(reading.waitForExistence(timeout: 5), app.debugDescription)
        reading.tap()
        tapReady(app.buttons["reading-preview"], app: app)
        expectation(for: NSPredicate(format: "label == %@", "阅读模式：预览"), evaluatedWith: reading)
        waitForExpectations(timeout: 10)
        let actions = app.buttons["workspace-menu"]
        tapReady(actions, app: app)
        let firstAction = app.buttons["action-new"]
        expectation(for: NSPredicate(format: "enabled == true AND hittable == true"), evaluatedWith: firstAction)
        waitForExpectations(timeout: 10)
        // The complete action list can fill a phone: cancellation must remain explicitly reachable.
        app.swipeUp()
        tapReady(app.buttons["workspace-menu-cancel"], app: app)
        tapReady(actions, app: app)
        tapReady(app.buttons["action-search"], app: app)
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
        let searchEvidence = XCTAttachment(screenshot: app.screenshot())
        searchEvidence.name = "native-search-options-with-keyboard"; searchEvidence.lifetime = .keepAlways
        add(searchEvidence)
        app.buttons["form-close"].tap()
        let saved = app.staticTexts["native-save-status"]
        XCTAssertTrue(saved.waitForExistence(timeout: 5))
        expectation(for: NSPredicate(format: "label == %@", "已保存"), evaluatedWith: saved)
        waitForExpectations(timeout: 10)
        XCTAssertTrue(app.webViews.staticTexts["Native iOS review"].waitForExistence(timeout: 5))
        XCTAssertEqual(app.webViews.textViews.count, 0, "Editing forms must be native, outside the document WebView")
        app.terminate(); app.launch()
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
        tapReady(app.buttons["返回阅读"], app: app)
        XCTAssertTrue(app.webViews.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "Native iOS review")).firstMatch.waitForExistence(timeout: 20))
    }
}
