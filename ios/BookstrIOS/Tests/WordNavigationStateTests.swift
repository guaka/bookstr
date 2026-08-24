import XCTest

@testable import BookstrIOS

final class WordNavigationStateTests: XCTestCase {
    func testRequestNormalizesWordAndIncrementsToken() {
        let words = WordNavigationState()

        words.request(word: "  Hello ")

        XCTAssertEqual(words.requestedWord, "Hello")
        XCTAssertEqual(words.requestToken, 1)
    }

    func testRequestIgnoresBlankInput() {
        let words = WordNavigationState()

        words.request(word: "   ")

        XCTAssertNil(words.requestedWord)
        XCTAssertEqual(words.requestToken, 0)
    }

    func testRequestIncrementsTokenForEveryCall() {
        let words = WordNavigationState()

        words.request(word: "first")
        words.request(word: "second")

        XCTAssertEqual(words.requestedWord, "second")
        XCTAssertEqual(words.requestToken, 2)
    }

    func testRequestHandlesLeadingBlankBeforeValidWord() {
        let words = WordNavigationState()

        words.request(word: "   ")
        words.request(word: "  valid ")

        XCTAssertEqual(words.requestedWord, "valid")
        XCTAssertEqual(words.requestToken, 1)
    }

    func testRequestCanHandleNewlinesAndTabs() {
        let words = WordNavigationState()

        words.request(word: "\n\t  spaced \t\n")

        XCTAssertEqual(words.requestedWord, "spaced")
        XCTAssertEqual(words.requestToken, 1)
    }

    func testRequestIgnoresBlankAfterExistingRequest() {
        let words = WordNavigationState()

        words.request(word: "first")
        words.request(word: "   ")

        XCTAssertEqual(words.requestedWord, "first")
        XCTAssertEqual(words.requestToken, 1)
    }

    func testRequestIncrementsTokenOnRepeatedWords() {
        let words = WordNavigationState()

        words.request(word: "hello")
        words.request(word: "hello")

        XCTAssertEqual(words.requestedWord, "hello")
        XCTAssertEqual(words.requestToken, 2)
    }

    func testMatchingWordReturnsNilWhenNoVocabularySaved() {
        let words = WordNavigationState()

        XCTAssertNil(words.matchingWord(for: "anything", in: []))
    }

    func testMatchingWordPrefersFirstMatchWhenDuplicatesExist() {
        let words = WordNavigationState()
        let duplicateOne = VocabularyWord(
            key: "en:test:1",
            word: "Test",
            language: "en",
            syncId: "e:test1",
            bookId: "book-1",
            bookTitle: "First",
            cfi: "epubcfi(page=1)",
            contextSentence: "First test context.",
            partOfSpeech: "verb",
            definitions: ["first"],
            translation: nil,
            sourceUrl: "",
            lookupCount: 1,
            firstSeenAt: 1,
            lastSeenAt: 2,
            deleted: false
        )
        let duplicateTwo = VocabularyWord(
            key: "en:test:2",
            word: "Test",
            language: "en",
            syncId: "e:test2",
            bookId: "book-2",
            bookTitle: "Second",
            cfi: "epubcfi(page=2)",
            contextSentence: "Second test context.",
            partOfSpeech: "noun",
            definitions: ["second"],
            translation: nil,
            sourceUrl: "",
            lookupCount: 1,
            firstSeenAt: 3,
            lastSeenAt: 4,
            deleted: false
        )

        let matched = words.matchingWord(for: "test", in: [duplicateOne, duplicateTwo])

        XCTAssertEqual(matched?.key, "en:test:1")
    }

    func testMatchingWordIsCaseInsensitive() {
        let words = WordNavigationState()
        let catalog = [
            VocabularyWord(
                key: "en:hello",
                word: "Hello",
                language: "en",
                syncId: "e:hello",
                bookId: "book-1",
                bookTitle: "Book of Words",
                cfi: "epubcfi(page=1)",
                contextSentence: "Greetings, hello world.",
                partOfSpeech: "noun",
                definitions: ["A greeting."],
                translation: nil,
                sourceUrl: "",
                lookupCount: 1,
                firstSeenAt: 0,
                lastSeenAt: 0,
                deleted: false
            )
        ]

        XCTAssertNotNil(words.matchingWord(for: "HELLO", in: catalog))
        XCTAssertNotNil(words.matchingWord(for: "hello", in: catalog))
        XCTAssertNotNil(words.matchingWord(for: "HeLLo", in: catalog))
        XCTAssertNil(words.matchingWord(for: "goodbye", in: catalog))
    }

    func testMatchingWordTrimsWhitespaceAndNormalizesQuery() {
        let words = WordNavigationState()
        let catalog = [
            VocabularyWord(
                key: "en:bonjour",
                word: "Bonjour",
                language: "fr",
                syncId: "fr:bonjour",
                bookId: "book-2",
                bookTitle: "Bonjour Livre",
                cfi: "epubcfi(page=2)",
                contextSentence: "Bonjour le monde.",
                partOfSpeech: "interj",
                definitions: ["Hello in French."],
                translation: nil,
                sourceUrl: "",
                lookupCount: 1,
                firstSeenAt: 0,
                lastSeenAt: 0,
                deleted: false
            )
        ]

        XCTAssertNotNil(words.matchingWord(for: "  BONJOUR ", in: catalog))
        XCTAssertNotNil(words.matchingWord(for: "bonjour", in: catalog))
    }

    func testMatchingWordReturnsNilForOnlyWhitespaceQuery() {
        let words = WordNavigationState()
        let catalog = [VocabularyWord(
            key: "en:empty",
            word: "Empty",
            language: "en",
            syncId: "e:empty",
            bookId: "book-3",
            bookTitle: "Some Book",
            cfi: "epubcfi(page=3)",
            contextSentence: "Nothing",
            partOfSpeech: "noun",
            definitions: ["Nothing."],
            translation: nil,
            sourceUrl: "",
            lookupCount: 1,
            firstSeenAt: 0,
            lastSeenAt: 0,
            deleted: false
        )]

        XCTAssertNil(words.matchingWord(for: "   ", in: catalog))
    }

    func testMatchingWordMatchesUnicodeAndPunctuationInsensitive() {
        let words = WordNavigationState()
        let catalog = [VocabularyWord(
            key: "en:caf\u00e9",
            word: "Café",
            language: "fr",
            syncId: "f:cafe",
            bookId: "book-4",
            bookTitle: "French Basics",
            cfi: "epubcfi(page=4)",
            contextSentence: "Prenez un café.",
            partOfSpeech: "noun",
            definitions: ["coffee"],
            translation: nil,
            sourceUrl: "",
            lookupCount: 1,
            firstSeenAt: 0,
            lastSeenAt: 0,
            deleted: false
        )]

        XCTAssertNotNil(words.matchingWord(for: "CAFÉ", in: catalog))
        XCTAssertNotNil(words.matchingWord(for: " café ", in: catalog))
    }

    func testRequestIsPublishedToMatchingLookupPath() {
        let words = WordNavigationState()
        let catalog = [
            VocabularyWord(
                key: "en:bonjour",
                word: "Bonjour",
                language: "fr",
                syncId: "f:bonjour",
                bookId: "book-2",
                bookTitle: "Bonjour Livre",
                cfi: "epubcfi(page=2)",
                contextSentence: "Bonjour le monde.",
                partOfSpeech: "interj",
                definitions: ["Hello in French."],
                translation: nil,
                sourceUrl: "",
                lookupCount: 1,
                firstSeenAt: 0,
                lastSeenAt: 0,
                deleted: false
            )
        ]

        words.request(word: "BONJOUR")
        let match = words.matchingWord(for: words.requestedWord ?? "", in: catalog)

        XCTAssertEqual(match?.key, "en:bonjour")
    }
}
