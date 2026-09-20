package app.bookstr.data

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File

class PrivateCatalogModelsTest {
    private val hash = "a".repeat(32)
    @Test fun invitationMatchesSharedFixtureAndRejectsUnsafeInputs() {
        val fixture = JSONObject(File("../../shared/fixtures/catalog-invitation-v1.json").readText())
        val uri = fixture.getString("uri")
        val connection = CatalogConnection.parse(uri)
        assertEquals(fixture.getString("pubkey"), connection.pubkey)
        assertEquals(fixture.getString("name"), connection.name)
        assertEquals("wss://relay.example", connection.service.relay)
        assertEquals(connection.pubkey, connection.service.pubkey)
        for (bad in listOf(uri + "&v=1", uri + "&unknown=x", uri + "#fragment", uri.replace("wss%3A", "ws%3A"),
            uri.replace("v=1", "v=2"), uri.replace("My+Libcat", ""), uri.replace("My+Libcat", "%00"),
            uri.replace("catalog?", "catalog/extra?"), uri.replace("bookstr:", "https:"), "x".repeat(2049))) {
            assertThrows(Exception::class.java) { CatalogConnection.parse(bad) }
        }
    }
    @Test fun parsesPrivatePagesWithoutPublicDownloadUrls() {
        val response = JSONObject("""{"books":[{"md5":"$hash","title":"Book","authors":"Author","extension":"epub"},{"md5":"$hash"},{"md5":"bad"},null],"next_offset":50}""")
        val page = CatalogSearchPage.parse(response, 0)
        assertEquals(50, page.nextOffset)
        val book = page.books.single()
        assertTrue(book.isReadable); assertNull(book.downloadUrl)
        assertEquals(hash, book.asCatalogBook()?.libvaultMd5)
        assertEquals("", book.asCatalogBook()?.epubUrl)
        assertEquals(1, CatalogSearchPage.merge(page.books, page.books).size)
        assertNull(CatalogSearchPage.parse(response, 50).nextOffset)
        val unsupported = CatalogSearchPage.parse(JSONObject("""{"books":[{"md5":"$hash","extension":"exe"}]}"""), 0).books.single()
        assertFalse(unsupported.isReadable); assertNull(unsupported.asCatalogBook())
        assertTrue(CatalogSearchPage.parse(JSONObject(), 0).books.isEmpty())
        assertThrows(Exception::class.java) { CatalogSearchPage.parse(JSONObject().put("books", "bad"), 0) }
    }
    @Test fun resolvesAndRoundTripsEveryCollection() {
        for ((collection, path) in listOf("nonfiction" to "libgen_rs_non_fic/r_000", "fiction" to "libgen_rs_fic/f_0", "comics" to "libgen_li_comics/c_0")) {
            val edition = TorrentEdition.parse(JSONObject().put("md5", hash).put("id", 42).put("collection", collection).put("filesize", "128"), hash)
            assertEquals(128L, edition.expectedSize)
            assertTrue(edition.metadataUrls.single().endsWith("$path.torrent"))
            assertEquals(edition, TorrentEdition.parse(edition.json(), hash))
        }
        val unknown = TorrentEdition.parse(JSONObject().put("md5", hash).put("id", 1234), hash)
        assertEquals(3, unknown.metadataUrls.size)
        assertTrue(unknown.metadataUrls[0].endsWith("r_1000.torrent"))
        val zlib = JSONObject().put("md5", hash).put("collection", "zlib").put("torrent", JSONObject().put("filename", "42")
            .put("metadata_url", "https://annas-archive.gl/dyn/small_file/torrents/managed_by_aa/zlib/pilimi-zlib-1-100.torrent"))
        val edition = TorrentEdition.parse(zlib, hash)
        assertEquals("42", edition.filename); assertEquals(edition, TorrentEdition.parse(edition.json(), hash))
        for (bad in listOf(JSONObject(zlib.toString()).put("md5", "bad"), JSONObject(zlib.toString()).put("collection", "unknown"),
            JSONObject(zlib.toString()).put("filesize", -1), JSONObject(zlib.toString()).put("filesize", TorrentEdition.MAX_BYTES + 1),
            JSONObject().put("md5", hash).put("id", 0), JSONObject(zlib.toString()).put("torrent", JSONObject().put("filename", "042").put("metadata_url", edition.metadataUrl)))) {
            assertThrows(Exception::class.java) { TorrentEdition.parse(bad, hash) }
        }
        zlib.getJSONObject("torrent").put("metadata_url", "https://evil.example/a.torrent")
        assertThrows(Exception::class.java) { TorrentEdition.parse(zlib, hash) }
    }
}
