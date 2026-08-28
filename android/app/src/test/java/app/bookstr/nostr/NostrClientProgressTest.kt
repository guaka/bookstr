package app.bookstr.nostr

import app.bookstr.util.Sha256
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Test

class NostrClientProgressTest {
    private val bookId = "afea92e35940157a01537f5d064d4b9ff9985ab8ae4719985001238f1de45c2b"

    @Test
    fun progressDTag() {
        assertEquals("app.bookstr.progress.$bookId", NostrClient.progressDTag(bookId))
    }

    @Test
    fun roundTripV2Payload() {
        val json = NostrClient.progressContent(
            bookId = bookId,
            progression = 0.42,
            cfi = "epubcfi(/6/4)",
            title = "Little Brother",
            author = "Cory Doctorow",
            updatedAt = 1_700_000_000_000L,
        )
        val obj = JSONObject(json)
        assertEquals(2, obj.getInt("v"))
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
    fun parseLegacyFlatPayloadAcceptsStringProgression() {
        val legacy = """{"progression":"0.55","cfi":"epubcfi(/6/8)"}"""
        val parsed = NostrClient.parseProgressContent(legacy, bookId)!!
        assertEquals(bookId, parsed.first)
        assertEquals(0.55, parsed.second, 1e-9)
        assertEquals("epubcfi(/6/8)", parsed.third)
    }

    @Test
    fun rejectGarbage() {
        assertNull(NostrClient.parseProgressContent("""{"hello":"world"}""", bookId))
        assertNull(NostrClient.parseProgressContent("{}", bookId))
    }

    @Test
    fun rejectMissingLocatorAndLegacyProgression() {
        assertNull(NostrClient.parseProgressContent("""{"bookId":"$bookId","foo":1}""", bookId))
        assertNull(NostrClient.parseProgressContent("""null""", bookId))
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
    fun parseUpdatedAtFallsBackForNonnumericInput() {
        assertEquals(7_000L, NostrClient.parseUpdatedAt("""{"updatedAt":"not-a-number"}""", 7L))
        assertEquals(8_000L, NostrClient.parseUpdatedAt("""{"updatedAt":null}""", 8L))
        assertEquals(1_200L, NostrClient.parseUpdatedAt("""{"updatedAt":"1200"}""", 9L))
    }

    @Test
    fun parseLegacyPayloadWithoutCfiDefaultsEmptyLocatorCfi() {
        val legacy = """{"progression":0.33}"""
        val parsed = NostrClient.parseProgressContent(legacy, bookId)!!
        assertEquals(bookId, parsed.first)
        assertEquals(0.33, parsed.second, 1e-9)
        assertEquals("", parsed.third)
    }

    @Test
    fun parseLegacyPayloadWithInvalidProgressionFallsBackToZero() {
        val legacy = """{"progression":"not-a-number","cfi":"epubcfi(/6/99)"}"""
        val parsed = NostrClient.parseProgressContent(legacy, bookId)!!
        assertEquals(0.0, parsed.second, 1e-9)
        assertEquals("epubcfi(/6/99)", parsed.third)
    }

    @Test
    fun parseProgressPayloadWithNonStringCfiDefaultsToEmpty() {
        val locator = """{"locator":{"progression":0.22,"cfi":123}}"""
        val parsed = NostrClient.parseProgressContent(locator, bookId)!!
        assertEquals(0.22, parsed.second, 1e-9)
        assertEquals("", parsed.third)
    }

    @Test
    fun parseLegacyPayloadMissingProgressionDefaultsToZero() {
        val legacy = """{"locator":{"cfi":"epubcfi(/6/1)"}}"""
        val parsed = NostrClient.parseProgressContent(legacy, bookId)!!
        assertEquals(0.0, parsed.second, 1e-9)
        assertEquals("epubcfi(/6/1)", parsed.third)
    }

    @Test
    fun parseFurthestProgressionFallsBackToFallbackForNonNumericField() {
        assertEquals(0.5, NostrClient.parseFurthestProgression("""{"locator":{"furthestProgression":"bad"}}""", 0.5), 1e-9)
        assertEquals(0.5, NostrClient.parseFurthestProgression("""{"locator":{}}""", 0.5), 1e-9)
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

    @Test
    fun payloadNeverPublishesFurthestProgressBehindCurrentPosition() {
        val json = NostrClient.progressContent(
            bookId = bookId,
            progression = 0.8,
            cfi = "here",
            furthestProgression = 0.2,
        )

        assertEquals(0.8, JSONObject(json).getJSONObject("locator").getDouble("furthestProgression"), 1e-9)
    }

    @Test
    fun parseFurthestProgressionNeverRegressesBelowFallback() {
        val behind = """{"locator":{"furthestProgression":0.2}}"""
        val ahead = """{"locator":{"furthestProgression":0.9}}"""

        assertEquals(0.7, NostrClient.parseFurthestProgression(behind, 0.7), 1e-9)
        assertEquals(0.9, NostrClient.parseFurthestProgression(ahead, 0.7), 1e-9)
        assertEquals(0.7, NostrClient.parseFurthestProgression("garbage", 0.7), 1e-9)
    }

    @Test
    fun blankPayloadBookIdUsesFallback() {
        val parsed = NostrClient.parseProgressContent(
            """{"bookId":"","locator":{"progression":0.3,"cfi":"cfi"}}""",
            bookId,
        )!!

        assertEquals(bookId, parsed.first)
    }

    @Test
    fun nonPositiveUpdatedAtFallsBackToEventTimestamp() {
        assertEquals(10_000L, NostrClient.parseUpdatedAt("""{"updatedAt":0}""", 10L))
        assertEquals(10_000L, NostrClient.parseUpdatedAt("""{"updatedAt":-5}""", 10L))
    }

    @Test
    fun optionalProgressMetadataIsOnlyIncludedWhenPresent() {
        val bare = JSONObject(NostrClient.progressContent(bookId, 0.1, "cfi", updatedAt = 1))
        val described = JSONObject(
            NostrClient.progressContent(
                bookId,
                0.1,
                "cfi",
                title = "Title",
                author = "Author",
                updatedAt = 1,
            ),
        )

        assertFalse(bare.has("title"))
        assertFalse(bare.has("author"))
        assertEquals("Title", described.getString("title"))
        assertEquals("Author", described.getString("author"))
    }

}
