package app.bookstr.data

import org.json.JSONArray
import org.json.JSONObject

object VocabularyWire {
    fun encode(word: VocabularyWord): JSONObject = JSONObject()
        .put("key", word.key)
        .put("word", word.word)
        .put("language", word.language)
        .put("syncId", word.syncId)
        .put("bookId", word.bookId)
        .put("bookTitle", word.bookTitle)
        .put("cfi", word.cfi)
        .put("contextSentence", word.contextSentence)
        .put("partOfSpeech", word.partOfSpeech)
        .put("definitions", JSONArray(word.definitions))
        .put("sourceUrl", word.sourceUrl)
        .put("lookupCount", word.lookupCount)
        .put("firstSeenAt", word.firstSeenAt)
        .put("lastSeenAt", word.lastSeenAt)
        .put("updatedAt", word.lastSeenAt)
        .put("deleted", word.deleted)

    fun parse(json: JSONObject): VocabularyWord {
        val word = json.getString("word").lowercase()
        val language = json.getString("language").lowercase()
        val syncId = json.getString("syncId")
        val definitions = json.optJSONArray("definitions") ?: JSONArray()
        return VocabularyWord(
            key = json.optString("key").ifBlank { "$language:$word" },
            word = word,
            language = language,
            syncId = syncId,
            bookId = json.getString("bookId"),
            bookTitle = json.getString("bookTitle"),
            cfi = json.optString("cfi"),
            contextSentence = json.optString("contextSentence"),
            partOfSpeech = json.optString("partOfSpeech"),
            definitionsJson = definitions.toString(),
            sourceUrl = json.optString("sourceUrl"),
            lookupCount = json.optInt("lookupCount", 1),
            firstSeenAt = json.optLong("firstSeenAt", json.optLong("updatedAt")),
            lastSeenAt = json.optLong("lastSeenAt", json.optLong("updatedAt")),
            deleted = json.optBoolean("deleted", false),
        )
    }
}
