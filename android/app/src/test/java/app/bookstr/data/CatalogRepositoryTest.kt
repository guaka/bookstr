package app.bookstr.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CatalogRepositoryTest {
    @Test
    fun parsesAndPrioritizesReadableWebSearchResults() {
        val results = CatalogRepository.parseSearchResponse(
            """{"results":[
              {"id":42,"source":"openlibrary","title":"Metadata","authors":"A Writer"},
              {"id":1342,"source":"gutenberg","title":"Pride and Prejudice","authors":"Jane Austen","issued":"1998-06-01","language":"en","avg_rating":4.21}
            ]}""",
        )

        assertEquals("gutenberg:1342", results.first().id)
        assertEquals("1998", results.first().year)
        assertEquals(BookFormat.Epub, results.first().format)
        assertTrue(results.first().isReadable)
        assertTrue(results.first().downloadUrl!!.endsWith("/books/1342/download"))
        assertFalse(results.last().isReadable)
    }
}
