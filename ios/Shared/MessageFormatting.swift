import Foundation

enum MessageFormatting {
    static func reply(_ source: String) -> AttributedString {
        // Keep chat line breaks while interpreting inline emphasis and code.
        // An unfinished delimiter stays readable until the next streamed token.
        (try? AttributedString(
            markdown: source,
            options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)
        )) ?? AttributedString(source)
    }
}
