package app.bookstr.data

import app.bookstr.nostr.Nip55
import org.json.JSONArray
import org.junit.Assert.*
import org.junit.Test

class AndroidDownloadSourcesTest {
    @Test fun libraryPermissionsOnlyRequestReadingAndCatalogCapabilities() {
        val permissions = JSONArray(Nip55.LIBRARY_PERMISSIONS)
        val signingKinds = (0 until permissions.length()).map { permissions.getJSONObject(it) }
            .filter { it.getString("type") == "sign_event" }.map { it.getInt("kind") }.toSet()
        assertEquals(setOf(30078, 30003, 13), signingKinds)
        assertEquals(5, permissions.length())
    }

    @Test fun ignoresUnsupportedFavoriteNamespacesAndKeepsSupportedMetadata() {
        val id = "a".repeat(32)
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags("""[
            ["book","unsupported","${"b".repeat(64)}","1","https://retired.example/file"],
            ["libvault","$id"],
            ["libvault-book","$id","Book","Author","epub"],
            ["unsupported","$id","${"b".repeat(64)}","https://retired.example/file","pdf"]
        ]""")
        assertEquals(1, refs.size)
        assertEquals(id, refs.single().libvaultMd5)
        assertEquals("Book", refs.single().title)
        assertEquals("epub", refs.single().format)
        assertNull(refs.single().url)
        assertEquals(refs, NostrFavoritesRepository.parseSharedFavoriteTags(NostrFavoritesRepository.serializeSharedFavoriteTags(refs)))
    }

    @Test fun legacyMetadataMergesIntoExistingUrlReference() {
        val md5 = "a".repeat(32)
        val refs = NostrFavoritesRepository.parseSharedFavoriteTags("""[
            ["book","url","https://example.org/book","1"],
            ["libvault","$md5","https://example.org/book"]
        ]""")
        assertEquals(1, refs.size)
        assertEquals(md5, refs.single().libvaultMd5)
        assertEquals("https://example.org/book", refs.single().url)
    }

    @Test fun searchPreservesOrdinaryHttpDownloadLinks() {
        val result = BookSearchResult("public:1", "public", "Book", "Author", format = BookFormat.Pdf,
            downloadUrl = "https://publisher.example/book.pdf")
        assertEquals("https://publisher.example/book.pdf", result.asCatalogBook()!!.epubUrl)
    }
}
