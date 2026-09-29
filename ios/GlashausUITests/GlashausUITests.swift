import XCTest

final class GlashausUITests: XCTestCase {
    func local(_ path: String, body: [String: Any], method: String, csrf: String) async throws {
        var request = URLRequest(url: URL(string: "http://127.0.0.1:17983/api" + path)!)
        request.httpMethod = method; request.setValue("application/json", forHTTPHeaderField: "Content-Type"); request.setValue(csrf, forHTTPHeaderField: "x-glashaus-token")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (_, response) = try await URLSession.shared.data(for: request)
        XCTAssertTrue((200...299).contains((response as! HTTPURLResponse).statusCode))
    }
    @MainActor func pair(_ app: XCUIApplication) async throws {
        let (data, _) = try await URLSession.shared.data(from: URL(string: "http://127.0.0.1:17983/api/state")!)
        let state = try JSONSerialization.jsonObject(with: data) as! [String: Any]
        let csrf = state["csrfToken"] as! String
        let reminder = (state["reminders"] as! [[String: Any]])[0]
        var calendar = Calendar(identifier: .gregorian); calendar.timeZone = TimeZone(identifier: "America/New_York")!
        let nextFriday = calendar.nextDate(after: Date(), matching: DateComponents(hour: 19, minute: 0, weekday: 6), matchingPolicy: .nextTime)!
        try await local("/reminders/" + (reminder["id"] as! String), body: ["revision": reminder["revision"]!, "action": "edit", "title": "Start the French dinner", "dueAt": ISO8601DateFormatter().string(from: nextFriday), "timeZone": "America/New_York"], method: "PATCH", csrf: csrf)
        if let memory = (state["memories"] as? [[String: Any]])?.first, memory["text"] as? String != "I enjoy French cooking on Fridays." {
            try await local("/memories/" + (memory["id"] as! String), body: ["text": "I enjoy French cooking on Fridays."], method: "PATCH", csrf: csrf)
        }
        var request = URLRequest(url: URL(string: "http://127.0.0.1:17983/api/mobile/pair")!)
        request.httpMethod = "POST"; request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(state["csrfToken"] as? String, forHTTPHeaderField: "x-glashaus-token")
        request.httpBody = try JSONSerialization.data(withJSONObject: ["address": "https://127.0.0.1:17984"])
        let (enrollment, _) = try await URLSession.shared.data(for: request)
        let link = (try JSONSerialization.jsonObject(with: enrollment) as! [String: String])["link"]!
        app.launchArguments = ["-ui-test-reset", "-pairing-link", link]
        app.launch()
        XCTAssertTrue(app.buttons["connectMac"].waitForExistence(timeout: 10))
        app.buttons["connectMac"].tap()
        XCTAssertTrue(app.navigationBars["Home"].waitForExistence(timeout: 20), app.debugDescription)
    }
    @MainActor func testWorkspaceLibraryAndPhotoEntry() async throws {
        continueAfterFailure = false
        let app = XCUIApplication(); try await pair(app)
        let files = app.buttons["homeWorkspace"]
        if !files.isHittable { app.swipeUp() }
        XCTAssertTrue(files.waitForExistence(timeout: 10)); files.tap()
        XCTAssertTrue(app.navigationBars["Files and tasks"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons.containing(.staticText, identifier: "Friday dinner plan.txt").firstMatch.waitForExistence(timeout: 10))
        let library = XCTAttachment(screenshot: app.screenshot()); library.name = "workspace-library-phone"; library.lifetime = .keepAlways; add(library)
        app.tabBars.buttons["Conversation"].tap()
        app.buttons["conversationOptions"].tap()
        XCTAssertTrue(app.buttons["Attach photos"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["Files and tasks"].exists)
        let menu = XCTAttachment(screenshot: app.screenshot()); menu.name = "workspace-menu-phone"; menu.lifetime = .keepAlways; add(menu)
    }
    @MainActor func testPairConfirmChatMemoryAndReconnect() async throws {
        continueAfterFailure = false
        let app = XCUIApplication(); try await pair(app)
        XCTAssertTrue(app.staticTexts["Start the French dinner"].waitForExistence(timeout: 15))
        let first = XCTAttachment(screenshot: app.screenshot()); first.name = "activity-dark"; first.lifetime = .keepAlways; add(first)
        for _ in 0..<8 { if app.buttons["Confirm reminder"].isHittable { break }; app.swipeUp() }
        app.buttons["Confirm reminder"].tap()
        for _ in 0..<8 { if app.buttons["homeReminders"].isHittable { break }; app.swipeUp() }
        app.buttons["homeReminders"].tap()
        XCTAssertTrue(app.staticTexts["Scheduled"].waitForExistence(timeout: 10))
        app.tabBars.buttons["Conversation"].tap()
        let field = app.textFields["messageComposer"]
        XCTAssertTrue(field.waitForExistence(timeout: 5)); field.tap(); field.typeText("Hello from the iPhone")
        app.buttons["sendMessage"].tap()
        XCTAssertTrue(app.staticTexts["I’m here. This reply shares the same conversation as your Mac."].waitForExistence(timeout: 20))
        app.terminate(); app.launchArguments = []; app.launch()
        XCTAssertTrue(app.navigationBars["Home"].waitForExistence(timeout: 10))
        app.tabBars.buttons["Conversation"].tap()
        XCTAssertTrue(app.staticTexts["Test visitor: Hello from the iPhone"].waitForExistence(timeout: 10))
        app.tabBars.buttons["Settings"].tap()
        app.buttons["Memories"].tap()
        let memory = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "I enjoy French cooking")).firstMatch
        XCTAssertTrue(memory.waitForExistence(timeout: 10)); memory.tap()
        let editor = app.textFields["memoryText"]
        XCTAssertTrue(editor.waitForExistence(timeout: 5)); editor.tap()
        editor.press(forDuration: 1.2)
        let selectAll = app.menuItems["Select All"]
        if selectAll.waitForExistence(timeout: 2) { selectAll.tap() }
        else { app.buttons["Select All"].tap() }
        editor.typeText("I enjoy French cooking on Saturdays.")
        app.buttons["Save"].tap()
        XCTAssertTrue(app.staticTexts["I enjoy French cooking on Saturdays."].waitForExistence(timeout: 10), app.debugDescription)
        app.tabBars.buttons["Settings"].tap()
        capture(app, "settings-dark")
        app.tabBars.buttons["Home"].tap()
        capture(app, "scheduled-dark")
    }
    @MainActor func testCompanionProfileCheckInsAndManualReminder() async throws {
        continueAfterFailure = false
        let app = XCUIApplication(); try await pair(app)
        app.tabBars.buttons["Settings"].tap()
        app.buttons["companionProfile"].tap()
        XCTAssertTrue(app.staticTexts["Dry humor, direct conversation, and a caring streak."].waitForExistence(timeout: 5))
        capture(app, "profile-dark")
        app.navigationBars.buttons.element(boundBy: 0).tap()
        app.buttons["Personal check-ins"].tap()
        XCTAssertTrue(app.switches["Allow personal check-ins"].waitForExistence(timeout: 5))
        capture(app, "check-in-preferences-dark")
        for _ in 0..<8 { if app.buttons["Save preferences"].isHittable { break }; app.swipeUp() }
        app.buttons["Save preferences"].tap()
        XCTAssertTrue(app.staticTexts["Preferences saved"].waitForExistence(timeout: 10))
        app.tabBars.buttons["Home"].tap()
        app.buttons["newReminder"].tap()
        let title = app.textFields["reminderTitle"]
        XCTAssertTrue(title.waitForExistence(timeout: 5)); title.tap(); title.typeText("Buy coffee for tomorrow")
        capture(app, "new-reminder-dark")
        app.buttons["Save draft"].tap()
        XCTAssertTrue(app.staticTexts["Buy coffee for tomorrow"].waitForExistence(timeout: 10))
        let (data, _) = try await URLSession.shared.data(from: URL(string: "http://127.0.0.1:17983/api/state")!)
        let state = try JSONSerialization.jsonObject(with: data) as! [String: Any]
        let reminder = (state["reminders"] as! [[String: Any]]).first { $0["title"] as? String == "Buy coffee for tomorrow" }!
        XCTAssertEqual(reminder["status"] as? String, "draft", "Saving the form must not schedule a reminder")
        try await local("/reminders/" + (reminder["id"] as! String), body: ["action": "cancel", "revision": reminder["revision"]!], method: "PATCH", csrf: state["csrfToken"] as! String)
        // Source data is disposable. Check-in visibility is covered when a fresh
        // fixture supplies it; API tests cover expiration and dismissal races.
        let continueButton = app.buttons["Continue conversation"]
        for _ in 0..<5 { if continueButton.isHittable { break }; app.swipeUp() }
        XCTAssertTrue(continueButton.waitForExistence(timeout: 10))
        capture(app, "check-in-dark")
        continueButton.tap()
        XCTAssertTrue(app.staticTexts["Elle checked in"].waitForExistence(timeout: 10))
        capture(app, "check-in-conversation-dark")
    }
    @MainActor func testUpdateMacConnectionPreservesConversation() async throws {
        continueAfterFailure = false
        let app = XCUIApplication(); try await pair(app)
        app.tabBars.buttons["Settings"].tap()
        app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Mac connection")).firstMatch.tap()
        for _ in 0..<8 { if app.buttons["Update Mac connection"].isHittable { break }; app.swipeUp() }
        app.buttons["Update Mac connection"].tap()
        XCTAssertTrue(app.buttons["connectMac"].waitForExistence(timeout: 5))
        let invalid = app.textFields["pairingLink"]
        for _ in 0..<5 { if invalid.isHittable { break }; app.swipeUp() }
        invalid.tap(); invalid.typeText("not-a-pairing-link")
        for _ in 0..<5 { if app.buttons["connectMac"].isHittable { break }; app.swipeUp() }
        app.buttons["connectMac"].tap()
        XCTAssertTrue(app.alerts["Couldn’t complete that"].waitForExistence(timeout: 5))
        app.alerts.buttons["OK"].tap()
        app.buttons["Cancel"].tap()
        XCTAssertTrue(app.navigationBars["Mac connection"].waitForExistence(timeout: 5))
        // A failed replacement must leave the saved connection usable after restart.
        app.terminate(); app.launchArguments = []; app.launch()
        XCTAssertTrue(app.navigationBars["Home"].waitForExistence(timeout: 10))
        app.tabBars.buttons["Settings"].tap()
        app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Mac connection")).firstMatch.tap()
        for _ in 0..<8 { if app.buttons["Update Mac connection"].isHittable { break }; app.swipeUp() }
        let (data, _) = try await URLSession.shared.data(from: URL(string: "http://127.0.0.1:17983/api/state")!)
        let state = try JSONSerialization.jsonObject(with: data) as! [String: Any]
        var request = URLRequest(url: URL(string: "http://127.0.0.1:17983/api/mobile/pair")!)
        request.httpMethod = "POST"; request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(state["csrfToken"] as? String, forHTTPHeaderField: "x-glashaus-token")
        request.httpBody = try JSONSerialization.data(withJSONObject: ["address": "https://127.0.0.1:17984"])
        let (enrollment, _) = try await URLSession.shared.data(for: request)
        let link = (try JSONSerialization.jsonObject(with: enrollment) as! [String: String])["link"]!
        // Only the disposable fixture link is typed into test automation.
        app.buttons["Update Mac connection"].tap()
        let field = app.textFields["pairingLink"]
        for _ in 0..<5 { if field.isHittable { break }; app.swipeUp() }
        field.tap(); field.typeText(link)
        XCTAssertEqual(field.value as? String, link)
        for _ in 0..<5 { if app.buttons["connectMac"].isHittable { break }; app.swipeUp() }
        app.buttons["connectMac"].tap()
        XCTAssertTrue(app.buttons["connectMac"].waitForNonExistence(timeout: 15))
        XCTAssertTrue(app.navigationBars["Mac connection"].waitForExistence(timeout: 15))
        app.tabBars.buttons["Conversation"].tap()
        XCTAssertTrue(app.staticTexts["I have the time ready. Confirm it and I’ll keep track of it."].waitForExistence(timeout: 10))
        app.terminate(); app.launchArguments = []; app.launch()
        XCTAssertTrue(app.navigationBars["Home"].waitForExistence(timeout: 10))
        app.tabBars.buttons["Conversation"].tap()
        XCTAssertTrue(app.staticTexts["I have the time ready. Confirm it and I’ll keep track of it."].waitForExistence(timeout: 10))
    }
    @MainActor func capture(_ app: XCUIApplication, _ name: String) {
        // Let system sheet/tab transitions finish before recording visual evidence.
        RunLoop.current.run(until: Date().addingTimeInterval(0.8))
        let image = XCTAttachment(screenshot: app.screenshot()); image.name = name; image.lifetime = .keepAlways; add(image)
    }
    @MainActor func testVisualEvidence() async throws {
        continueAfterFailure = false
        let app = XCUIApplication(); try await pair(app)
        XCTAssertTrue(app.buttons["Confirm reminder"].waitForExistence(timeout: 10)); capture(app, "activity-dark")
        for _ in 0..<8 { if app.buttons["Edit"].isHittable { break }; app.swipeUp() }
        app.buttons["Edit"].tap(); capture(app, "edit-reminder-dark"); app.buttons["Cancel"].tap()
        app.tabBars.buttons["Conversation"].tap(); capture(app, "conversation-dark")
        XCUIDevice.shared.orientation = .landscapeLeft
        RunLoop.current.run(until: Date().addingTimeInterval(2))
        let landscape = XCTAttachment(screenshot: XCUIScreen.main.screenshot()); landscape.name = "conversation-landscape"; landscape.lifetime = .keepAlways; add(landscape)
        XCUIDevice.shared.orientation = .portrait
        RunLoop.current.run(until: Date().addingTimeInterval(1))
        let composer = app.textFields["messageComposer"]
        composer.tap(); composer.typeText("Friday sounds good.")
        capture(app, "composer-keyboard")
        composer.typeText("\nI’ll pick up the ingredients.\nLet’s keep dinner simple.")
        capture(app, "composer-multiline")
        app.buttons["sendMessage"].tap()
        XCTAssertTrue(app.buttons["Stop reply"].waitForNonExistence(timeout: 20))
        let voiceEnabled = XCTNSPredicateExpectation(predicate: NSPredicate(format: "enabled == true"), object: app.buttons["Voice chat"])
        XCTAssertEqual(XCTWaiter.wait(for: [voiceEnabled], timeout: 15), .completed, app.debugDescription)
        app.tabBars.buttons["Settings"].tap(); capture(app, "settings-dark")
        for _ in 0..<8 { if app.buttons["Background"].isHittable { break }; app.swipeUp() }; app.buttons["Background"].tap(); capture(app, "backgrounds-dark")
        app.buttons["Field quiet"].tap(); capture(app, "background-field-quiet")
        app.navigationBars.buttons.element(boundBy: 0).tap()
        for _ in 0..<8 { if app.buttons["Voice"].isHittable { break }; app.swipeUp() }; app.buttons["Voice"].tap(); capture(app, "voice-settings-dark")
        app.navigationBars.buttons.element(boundBy: 0).tap()
        for _ in 0..<8 { if app.buttons["Connections"].isHittable { break }; app.swipeUp() }; app.buttons["Connections"].tap(); capture(app, "connections-dark")
        app.buttons["iCloud Mail"].tap(); capture(app, "mail-settings-dark")
        app.navigationBars.buttons.element(boundBy: 0).tap()
        app.navigationBars.buttons.element(boundBy: 0).tap()
        app.tabBars.buttons["Home"].tap()
        for _ in 0..<8 { if app.buttons["proposal-design-email"].isHittable { break }; app.swipeUp() }
        app.buttons["proposal-design-email"].tap(); capture(app, "review-email")
        XCTAssertTrue(app.staticTexts["studio@example.test"].waitForExistence(timeout: 5))
        app.navigationBars.buttons.element(boundBy: 0).tap()
        app.tabBars.buttons["Conversation"].tap()
        app.buttons["Voice chat"].tap()
        let phase = app.descendants(matching: .any)["voicePhase"]
        XCTAssertTrue(phase.waitForExistence(timeout: 5), app.debugDescription)
        XCTAssertTrue(phase.label.contains("Choose a voice to begin"), phase.debugDescription)
        XCTAssertFalse(app.buttons["Start voice chat"].exists)
        XCTAssertTrue(app.buttons["Voice settings"].exists)
        capture(app, "voice-chat-unconfigured"); app.buttons["Done"].tap()
        let (voiceStateData, _) = try await URLSession.shared.data(from: URL(string: "http://127.0.0.1:17983/api/state")!)
        let voiceState = try JSONSerialization.jsonObject(with: voiceStateData) as! [String: Any]
        let voiceCSRF = voiceState["csrfToken"] as! String
        let (voiceConfigData, _) = try await URLSession.shared.data(from: URL(string: "http://127.0.0.1:17983/api/integrations")!)
        let voiceConfig = try JSONSerialization.jsonObject(with: voiceConfigData) as! [String: Any]
        let voiceRevision = voiceConfig["revision"] as! Int
        try await local("/integrations", body: ["revision": voiceRevision, "voice": ["apiKey": "synthetic-visual-only", "voiceId": "synthetic-voice"]], method: "PATCH", csrf: voiceCSRF)
        try await Task.sleep(for: .seconds(6))
        app.buttons["Voice chat"].tap()
        XCTAssertTrue(app.buttons["Start voice chat"].waitForExistence(timeout: 10))
        capture(app, "voice-chat-ready"); app.buttons["Done"].tap()
        try await local("/integrations", body: ["revision": voiceRevision + 1, "voice": ["apiKey": "", "voiceId": ""]], method: "PATCH", csrf: voiceCSRF)
    }
    @MainActor func testViewClearingIsLocalReversibleAndSurvivesRelaunch() async throws {
        continueAfterFailure = false
        let app = XCUIApplication(); try await pair(app)
        let (beforeData, _) = try await URLSession.shared.data(from: URL(string: "http://127.0.0.1:17983/api/state")!)
        let before = try JSONSerialization.jsonObject(with: beforeData) as! [String: Any]
        app.tabBars.buttons["Conversation"].tap()
        app.buttons["conversationOptions"].tap()
        capture(app, "conversation-options")
        app.buttons["Clear chat view"].tap()
        XCTAssertTrue(app.buttons["Show earlier messages"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.staticTexts["I have the time ready. Confirm it and I’ll keep track of it."].exists)
        capture(app, "cleared-chat")
        app.terminate(); app.launchArguments = []; app.launch(); app.tabBars.buttons["Conversation"].tap()
        XCTAssertTrue(app.buttons["Show earlier messages"].waitForExistence(timeout: 5))
        let (afterData, _) = try await URLSession.shared.data(from: URL(string: "http://127.0.0.1:17983/api/state")!)
        let after = try JSONSerialization.jsonObject(with: afterData) as! [String: Any]
        XCTAssertEqual((before["turns"] as! [[String: Any]]).count, (after["turns"] as! [[String: Any]]).count)
        XCTAssertEqual((before["memories"] as! [[String: Any]]).count, (after["memories"] as! [[String: Any]]).count)
        let composer = app.textFields["messageComposer"]; composer.tap(); composer.typeText("Hello after clearing the view")
        app.buttons["sendMessage"].tap()
        XCTAssertTrue(app.staticTexts["I’m here. This reply shares the same conversation as your Mac."].waitForExistence(timeout: 20))
        for _ in 0..<8 { if app.buttons["Show earlier messages"].isHittable { break }; app.swipeDown() }
        app.buttons["Show earlier messages"].tap()
        for _ in 0..<8 { if app.staticTexts["I have the time ready. Confirm it and I’ll keep track of it."].exists { break }; app.swipeDown() }
        XCTAssertTrue(app.staticTexts["I have the time ready. Confirm it and I’ll keep track of it."].exists)
    }
    @MainActor func testStoppedMessageSurvivesRelaunchAndRevocation() async throws {
        continueAfterFailure = false
        let app = XCUIApplication(); try await pair(app)
        app.tabBars.buttons["Conversation"].tap()
        let message = "Long reply recovery check " + String(UUID().uuidString.prefix(6))
        let composer = app.textFields["messageComposer"]; composer.tap(); composer.typeText(message)
        app.buttons["sendMessage"].tap()
        XCTAssertTrue(app.buttons["Stop reply"].waitForExistence(timeout: 5)); app.buttons["Stop reply"].tap()
        XCTAssertTrue(app.buttons["Retry message"].waitForExistence(timeout: 10))
        app.terminate(); app.launchArguments = []; app.launch()
        app.tabBars.buttons["Conversation"].tap()
        XCTAssertTrue(app.buttons["Retry message"].waitForExistence(timeout: 10))
        app.tabBars.buttons["Settings"].tap()
        app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Mac connection")).firstMatch.tap()
        for _ in 0..<8 { if app.textFields["macAddress"].isHittable { break }; app.swipeUp() }
        let address = app.textFields["macAddress"]
        address.tap()
        let existingAddress = address.value as? String ?? ""
        address.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: existingAddress.count))
        address.typeText("https://127.0.0.1:17984")
        XCTAssertTrue(app.buttons["useMacAddress"].isEnabled, "Pending messages must not block address recovery")
        app.buttons["useMacAddress"].tap()
        XCTAssertTrue(app.staticTexts["Address verified and saved."].waitForExistence(timeout: 15), app.debugDescription)
        app.navigationBars.buttons.element(boundBy: 0).tap()
        app.tabBars.buttons["Conversation"].tap()
        XCTAssertTrue(app.buttons["Retry message"].waitForExistence(timeout: 5), "Address recovery must preserve the pending message. " + app.debugDescription)
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate(format: "enabled == true"), object: app.buttons["Retry message"])
        XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: 12), .completed, app.debugDescription)
        app.buttons["Retry message"].tap()
        XCTAssertTrue(app.staticTexts["I’m here. This reply shares the same conversation as your Mac."].waitForExistence(timeout: 20), app.debugDescription)
        // Wait for this particular pending reply to be acknowledged, rather than
        // mistaking an older identical fixture reply for completion.
        XCTAssertTrue(app.buttons["Stop reply"].waitForNonExistence(timeout: 20))
        let (data, _) = try await URLSession.shared.data(from: URL(string: "http://127.0.0.1:17983/api/state")!)
        let state = try JSONSerialization.jsonObject(with: data) as! [String: Any]
        let turns = state["turns"] as! [[String: Any]]
        XCTAssertEqual(turns.filter { $0["userText"] as? String == message }.count, 1)
        let (devicesData, _) = try await URLSession.shared.data(from: URL(string: "http://127.0.0.1:17983/api/mobile")!)
        let devices = (try JSONSerialization.jsonObject(with: devicesData) as! [String: Any])["devices"] as! [[String: Any]]
        try await local("/mobile/devices/" + (devices.last!["id"] as! String), body: [:], method: "DELETE", csrf: state["csrfToken"] as! String)
        XCTAssertTrue(app.buttons["connectMac"].waitForExistence(timeout: 20))
    }
}
