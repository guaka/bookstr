package app.bookstr.contracts

import app.bookstr.data.VocabularyWire
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.io.File

class VocabularyWireV1ContractTest {
    private val fixture = JSONObject(File("../../shared/fixtures/vocabulary-wire-v1.json").readText())

    @Test
    fun androidVocabularyAdapterConformsToEverySharedV1Case() {
        assertEquals(1, fixture.getInt("version"))
        val cases = fixture.getJSONArray("cases")
        repeat(cases.length()) { index ->
            val entry = cases.getJSONObject(index)
            val parsed = runCatching { VocabularyWire.parse(entry.getJSONObject("payload")) }.getOrNull()
            if (!entry.getBoolean("valid")) {
                assertNull(entry.getString("name"), parsed)
                return@repeat
            }
            val expected = entry.getJSONObject("expected")
            val actual = JSONObject()
                .put("key", parsed!!.key)
                .put("word", parsed.word)
                .put("language", parsed.language)
                .put("syncId", parsed.syncId)
                .put("bookId", parsed.bookId)
                .put("bookTitle", parsed.bookTitle)
                .put("cfi", parsed.cfi)
                .put("contextSentence", parsed.contextSentence)
                .put("partOfSpeech", parsed.partOfSpeech)
                .put("definitions", parsed.definitions)
                .put("sourceUrl", parsed.sourceUrl)
                .put("lookupCount", parsed.lookupCount)
                .put("firstSeenAt", parsed.firstSeenAt)
                .put("lastSeenAt", parsed.lastSeenAt)
                .put("deleted", parsed.deleted)
            assertEquals(entry.getString("name"), expected.toString(), actual.toString())
            assertEquals(entry.getString("name"), parsed, VocabularyWire.parse(VocabularyWire.encode(parsed)))
        }
    }
}
