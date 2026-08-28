package app.bookstr.contracts

import app.bookstr.nostr.NostrClient
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertNotNull
import org.junit.Test
import java.io.File

class ReadingProgressV2ContractTest {
    private val fixture = JSONObject(File("../../shared/fixtures/reading-progress-v2.json").readText())

    @Test
    fun androidProgressAdapterConformsToEverySharedV2Case() {
        assertEquals(2, fixture.getInt("version"))
        val cases = fixture.getJSONArray("cases")
        repeat(cases.length()) { index ->
            val entry = cases.getJSONObject(index)
            val content = entry.getJSONObject("content").toString()
            val parsed = NostrClient.parseProgressContent(content, entry.getString("fallbackBookId"))
            if (!entry.getBoolean("valid")) {
                assertNull(entry.getString("name"), parsed)
                return@repeat
            }
            assertNotNull(entry.getString("name"), parsed)
            val expected = entry.getJSONObject("expected")
            assertEquals(entry.getString("name"), expected.getString("bookId"), parsed!!.first)
            assertEquals(entry.getString("name"), expected.getDouble("progression"), parsed.second, 1e-9)
            assertEquals(entry.getString("name"), expected.getString("cfi"), parsed.third)
            assertEquals(
                entry.getString("name"), expected.getDouble("furthestProgression"),
                NostrClient.parseFurthestProgression(content, parsed.second), 1e-9,
            )
            assertEquals(
                entry.getString("name"), expected.getLong("updatedAt"),
                NostrClient.parseUpdatedAt(content, entry.getLong("eventCreatedAt")),
            )
        }
    }
}
