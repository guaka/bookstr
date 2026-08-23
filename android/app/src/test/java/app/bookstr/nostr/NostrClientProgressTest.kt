package app.bookstr.nostr

import app.bookstr.util.Sha256
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class NostrClientProgressTest {
    private val bookId = "afea92e35940157a01537f5d064d4b9ff9985ab8ae4719985001238f1de45c2b"

    @Test
    fun progressDTag() {
        assertEquals("app.bookstr.progress.$bookId", NostrClient.progressDTag(bookId))
    }

    @Test
    fun roundTripV1Payload() {
        val json = NostrClient.progressContent(
            bookId = bookId,
            progression = 0.42,
            cfi = "epubcfi(/6/4)",
            title = "Little Brother",
            author = "Cory Doctorow",
            updatedAt = 1_700_000_000_000L,
        )
        val obj = JSONObject(json)
        assertEquals(1, obj.getInt("v"))
        assertEquals(bookId, obj.getString("bookId"))
        assertEquals(0.42, obj.getJSONObject("locator").getDouble("progression"), 1e-9)
        assertEquals("epubcfi(/6/4)", obj.getJSONObject("locator").getString("cfi"))
        assertEquals(1_700_000_000_000L, obj.getLong("updatedAt"))

        val parsed = NostrClient.parseProgressContent(json, "fallback")!!
        assertEquals(bookId, parsed.first)
        assertEquals(0.42, parsed.second, 1e-9)
        assertEquals("epubcfi(/6/4)", parsed.third)
        assertEquals(1_700_000_000_000L, NostrClient.parseUpdatedAt(json, 99L))
    }

    @Test
    fun parseLegacyFlatPayload() {
        val legacy = """{"progression":0.55,"cfi":"epubcfi(/6/8)"}"""
        val parsed = NostrClient.parseProgressContent(legacy, bookId)!!
        assertEquals(bookId, parsed.first)
        assertEquals(0.55, parsed.second, 1e-9)
        assertEquals("epubcfi(/6/8)", parsed.third)
        assertEquals(1_700_000_002_000L, NostrClient.parseUpdatedAt(legacy, 1_700_000_002L))
    }

    @Test
    fun rejectGarbage() {
        assertNull(NostrClient.parseProgressContent("""{"hello":"world"}""", bookId))
        assertNull(NostrClient.parseProgressContent("{}", bookId))
    }

    @Test
    fun parseUpdatedAtFallsBackToEventTime() {
        val withUpdated = NostrClient.progressContent(
            bookId = bookId,
            progression = 0.1,
            cfi = "",
            updatedAt = 42L,
        )
        assertEquals(42L, NostrClient.parseUpdatedAt(withUpdated, 99L))
        assertEquals(99_000L, NostrClient.parseUpdatedAt("""{"progression":0.1}""", 99L))
    }

    @Test
    fun eventIdUsesCanonicalJsonWithoutEscapingSlashes() {
        val event = JSONObject()
            .put("pubkey", "00".repeat(32))
            .put("created_at", 1L)
            .put("kind", 30003)
            .put("tags", JSONArray().put(JSONArray().put("d").put("libvault/favorites")))
            .put("content", "https://example.com/a/b")

        val canonical = """[0,"${"00".repeat(32)}",1,30003,[["d","libvault/favorites"]],"https://example.com/a/b"]"""
        assertEquals(Sha256.hash(canonical), NostrCrypto.eventId(event))
    }

}
