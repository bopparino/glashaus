import XCTest
@testable import GlasHausCore

final class MessageFormattingTests: XCTestCase {
    func testActionsAreEmphasizedWithoutChangingDialogueOrLineBreaks() {
        let value = MessageFormatting.reply("Hey.\n\n*I wave.*\nCome in.")
        XCTAssertEqual(String(value.characters), "Hey.\n\nI wave.\nCome in.")
        let actions = value.runs.filter { $0.inlinePresentationIntent?.contains(.emphasized) == true }
        XCTAssertEqual(actions.map { String(value[$0.range].characters) }, ["I wave."])
        XCTAssertNil(value.runs.first?.inlinePresentationIntent)
    }

    func testLiteralAsterisksAndInlineCodeAreNotActions() {
        let value = MessageFormatting.reply(#"2 * 3 = 6. \*literal\* and `*code*`."#)
        XCTAssertEqual(String(value.characters), "2 * 3 = 6. *literal* and *code*.")
        XCTAssertFalse(value.runs.contains { $0.inlinePresentationIntent?.contains(.emphasized) == true })
        XCTAssertTrue(value.runs.contains { $0.inlinePresentationIntent?.contains(.code) == true })
    }

    func testStreamingKeepsUnfinishedActionReadableThenFormatsCompletedAction() {
        let unfinished = MessageFormatting.reply("Hello. *I wave")
        XCTAssertEqual(String(unfinished.characters), "Hello. *I wave")
        let finished = MessageFormatting.reply("Hello. *I wave*")
        XCTAssertEqual(String(finished.characters), "Hello. I wave")
        XCTAssertTrue(finished.runs.contains { $0.inlinePresentationIntent?.contains(.emphasized) == true })
    }

    func testUnicodeAndMultipleActionsSurviveFormatting() {
        let value = MessageFormatting.reply("*I smile.* Hey, Renée 🖤\n*I sit beside you.*")
        XCTAssertEqual(String(value.characters), "I smile. Hey, Renée 🖤\nI sit beside you.")
        XCTAssertEqual(value.runs.filter { $0.inlinePresentationIntent?.contains(.emphasized) == true }.count, 2)
    }
}
