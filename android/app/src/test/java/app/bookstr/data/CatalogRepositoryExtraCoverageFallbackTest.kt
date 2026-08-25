package app.bookstr.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class CatalogRepositoryExtraCoverageFallbackTest {
    @Test
    fun parseSearchResponseDefaultsSourceWhenSourceIsLowercaseUndefined() {
        val results = CatalogRepository.parseSearchResponse(
            """{"results":[
              {"source":"undefined","id":"lower-undefined","title":"Lowercase undefined","url":"https://example.org/story.epub"}
            ]}""",
        )

        assertEquals(1, results.size)
        assertEquals("all.books.party:lower-undefined", results[0].id)
        assertEquals(BookFormat.Epub, results[0].format)
        assertTrue(results[0].isReadable)
    }

    @Test
    fun parseSearchResponseDefaultsSourceWhenSourceIsUppercaseUndefined() {
        val results = CatalogRepository.parseSearchResponse(
            """{"results":[
              {"source":"UNDEFINED","id":"upper-undefined","title":"Uppercase undefined","url":"https://example.org/story.epub"}
            ]}""",
        )

        assertEquals(1, results.size)
        assertEquals("all.books.party:upper-undefined", results[0].id)
        assertEquals(BookFormat.Epub, results[0].format)
        assertTrue(results[0].isReadable)
    }

    @Test
    fun parseSearchResponseDefaultsSourceWhenSourceIsLowercaseNull() {
        val results = CatalogRepository.parseSearchResponse(
            """{"results":[
              {"source":"null","id":"lower-null","title":"Lowercase null","url":"https://example.org/story.epub"}
            ]}""",
        )

        assertEquals(1, results.size)
        assertEquals("all.books.party:lower-null", results[0].id)
        assertEquals(BookFormat.Epub, results[0].format)
        assertTrue(results[0].isReadable)
    }

    @Test
    fun parseSearchResponseDefaultsSourceWhenSourceIsWhitespace() {
        val results = CatalogRepository.parseSearchResponse(
            """{"results":[
              {"source":"   ","id":"space-source","title":"Whitespace source","url":"https://example.org/story.epub"}
            ]}""",
        )

        assertEquals(1, results.size)
        assertEquals("all.books.party:space-source", results[0].id)
        assertEquals(BookFormat.Epub, results[0].format)
        assertTrue(results[0].isReadable)
    }

    @Test
    fun parseSearchResponseDefaultsSourceWhenSourceIsMixedCaseUndefined() {
        val results = CatalogRepository.parseSearchResponse(
            """{"results":[
              {"source":"UnDeFiNeD","id":"mixed-case-undefined","title":"Mixedcase undefined","url":"https://example.org/story.epub"}
            ]}""",
        )

        assertEquals(1, results.size)
        assertEquals("all.books.party:mixed-case-undefined", results[0].id)
        assertEquals(BookFormat.Epub, results[0].format)
        assertTrue(results[0].isReadable)
    }

    @Test
    fun parseSearchResponseDefaultsSourceWhenSourceIsMixedCaseNull() {
        val results = CatalogRepository.parseSearchResponse(
            """{"results":[
              {"source":"NuLl","id":"mixed-case-null","title":"Mixedcase null","url":"https://example.org/story.epub"}
            ]}""",
        )

        assertEquals(1, results.size)
        assertEquals("all.books.party:mixed-case-null", results[0].id)
        assertEquals(BookFormat.Epub, results[0].format)
        assertTrue(results[0].isReadable)
    }

    @Test
    fun parseSearchResponseDefaultsSourceWhenSourceIsUndefinedWithWhitespace() {
        val results = CatalogRepository.parseSearchResponse(
            """{"results":[
              {"source":"  undefined ","id":"padded-undefined","title":"Padded undefined","url":"https://example.org/story.epub"}
            ]}""",
        )

        assertEquals(1, results.size)
        assertEquals("all.books.party:padded-undefined", results[0].id)
        assertEquals(BookFormat.Epub, results[0].format)
        assertTrue(results[0].isReadable)
    }

    @Test
    fun parseSearchResponseDefaultsTitleWhenTitleIsNull() {
        val results = CatalogRepository.parseSearchResponse(
            """{"results":[
              {"source":"openlibrary","id":"null-title","title":null,"url":"https://example.org/story.epub"}
            ]}""",
        )

        assertEquals(1, results.size)
        assertEquals("openlibrary:null-title", results[0].id)
        assertEquals("Untitled", results[0].title)
        assertEquals(BookFormat.Epub, results[0].format)
    }

    @Test
    fun parseSearchResponseUsesNumericSourceNativeIdWhenIdMissing() {
        val results = CatalogRepository.parseSearchResponse(
            """{"results":[
              {"source":"openlibrary","source_native_id":777,"title":"Numeric fallback","url":"https://example.org/story.epub"}
            ]}""",
        )

        assertEquals(1, results.size)
        assertEquals("openlibrary:777", results[0].id)
        assertEquals(BookFormat.Epub, results[0].format)
        assertTrue(results[0].isReadable)
    }
}
