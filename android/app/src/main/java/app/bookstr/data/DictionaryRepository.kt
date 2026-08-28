package app.bookstr.data

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import org.json.JSONArray
import java.io.File
import java.util.concurrent.TimeUnit
import java.util.zip.GZIPInputStream

data class DictionaryDefinition(
    val word: String,
    val language: String,
    val partOfSpeech: String,
    val definitions: List<String>,
    val sourceUrl: String,
)

data class DictionaryPack(
    val id: String,
    val label: String,
    val sourceLanguage: String,
    val targetLanguage: String,
    val installed: Boolean,
    val bytes: Long,
)

/** Offline-first lookup backed by user-downloadable WikDict SQLite databases. */
class DictionaryRepository(context: Context? = null) {
    private val client = OkHttpClient.Builder()
        .connectTimeout(12, TimeUnit.SECONDS)
        .readTimeout(45, TimeUnit.SECONDS)
        .build()
    private val packDirectory = File(
        context?.filesDir ?: File(System.getProperty("java.io.tmpdir") ?: "."),
        "wikdict",
    ).apply { mkdirs() }

    fun packs(): List<DictionaryPack> = ALL_PACKS.map { spec ->
        val file = packFile(spec.id)
        DictionaryPack(spec.id, spec.label, spec.source, spec.target, file.isFile, file.length())
    }

    fun hasInstalledPackFor(sourceLanguage: String): Boolean {
        val normalized = sourceLanguage.substringBefore('-').lowercase()
        return ALL_PACKS.any { it.source == normalized && packFile(it.id).isFile }
    }

    suspend fun installPack(
        id: String,
        onProgress: suspend (downloadedBytes: Long, totalBytes: Long) -> Unit = { _, _ -> },
    ) = withContext(Dispatchers.IO) {
        val spec = ALL_PACKS.firstOrNull { it.id == id } ?: error("Unknown dictionary pack")
        if (spec.id == KAIKKI_PT_ID) {
            installKaikkiPortuguese(spec, onProgress)
            return@withContext
        }
        val destination = packFile(spec.id)
        val partial = File(packDirectory, "${spec.id}.sqlite3.part")
        downloadTo("$WIKDICT_BASE/${spec.id}.sqlite3", partial, onProgress)
        if (partial.length() < 1024L) {
            partial.delete()
            error("Dictionary download was incomplete")
        }
        SQLiteDatabase.openDatabase(partial.path, null, SQLiteDatabase.OPEN_READONLY).use { database ->
            database.rawQuery("SELECT written_rep FROM simple_translation LIMIT 1", null).use { cursor ->
                if (!cursor.moveToFirst()) error("Dictionary contains no entries")
            }
        }
        if (destination.exists()) destination.delete()
        check(partial.renameTo(destination)) { "Could not save dictionary pack" }
    }

    fun removePack(id: String): Boolean = packFile(id).delete()

    private suspend fun installKaikkiPortuguese(
        spec: PackSpec,
        onProgress: suspend (Long, Long) -> Unit,
    ) {
        val destination = packFile(spec.id)
        val compressed = File(packDirectory, "${spec.id}.jsonl.gz.part")
        val partial = File(packDirectory, "${spec.id}.sqlite3.part")
        try {
            downloadTo(KAIKKI_PT_URL, compressed, onProgress)
            if (compressed.length() < 1024L) error("Dictionary download was incomplete")
            onProgress(compressed.length(), -1L)
            if (partial.exists()) partial.delete()
            SQLiteDatabase.openOrCreateDatabase(partial, null).use { database ->
                database.execSQL(
                    "CREATE TABLE entries (word TEXT COLLATE NOCASE NOT NULL, " +
                        "part_of_speech TEXT NOT NULL, definitions_json TEXT NOT NULL, " +
                        "PRIMARY KEY(word, part_of_speech))",
                )
                val insert = database.compileStatement(
                    "INSERT OR REPLACE INTO entries(word, part_of_speech, definitions_json) VALUES(?, ?, ?)",
                )
                database.beginTransaction()
                try {
                    GZIPInputStream(compressed.inputStream().buffered()).bufferedReader().useLines { lines ->
                        lines.forEach { line ->
                            val entry = runCatching { JSONObject(line) }.getOrNull() ?: return@forEach
                            if (entry.optString("lang_code") != "pt") return@forEach
                            val word = entry.optString("word").trim()
                            if (word.isBlank()) return@forEach
                            val definitions = mutableListOf<String>()
                            val senses = entry.optJSONArray("senses") ?: JSONArray()
                            for (senseIndex in 0 until senses.length()) {
                                val glosses = senses.optJSONObject(senseIndex)?.optJSONArray("glosses") ?: continue
                                for (glossIndex in 0 until glosses.length()) {
                                    glosses.optString(glossIndex).trim().takeIf(String::isNotBlank)?.let {
                                        if (it !in definitions) definitions += it
                                    }
                                }
                            }
                            if (definitions.isEmpty()) return@forEach
                            insert.clearBindings()
                            insert.bindString(1, word)
                            insert.bindString(2, entry.optString("pos_title", entry.optString("pos")))
                            insert.bindString(3, JSONArray(definitions).toString())
                            insert.executeInsert()
                        }
                    }
                    database.setTransactionSuccessful()
                } finally {
                    database.endTransaction()
                }
                database.execSQL("CREATE INDEX entries_word_idx ON entries(word COLLATE NOCASE)")
            }
            if (destination.exists()) destination.delete()
            check(partial.renameTo(destination)) { "Could not save dictionary pack" }
        } finally {
            compressed.delete()
            partial.delete()
        }
    }

    private suspend fun downloadTo(
        url: String,
        destination: File,
        onProgress: suspend (Long, Long) -> Unit,
    ) {
        client.newCall(Request.Builder().url(url).build()).execute().use { response ->
            if (!response.isSuccessful) error("Dictionary download failed: HTTP ${response.code}")
            val body = response.body ?: error("Dictionary download was empty")
            val total = body.contentLength()
            var copied = 0L
            var lastReported = 0L
            body.byteStream().buffered().use { input ->
                destination.outputStream().buffered().use { output ->
                    val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
                    while (true) {
                        val count = input.read(buffer)
                        if (count < 0) break
                        output.write(buffer, 0, count)
                        copied += count
                        if (copied - lastReported >= 256 * 1024 || copied == total) {
                            onProgress(copied, total)
                            lastReported = copied
                        }
                    }
                }
            }
            onProgress(copied, total)
        }
    }

    suspend fun lookup(word: String, context: String): DictionaryDefinition =
        lookupPreferred(word, languageFor(context))

    suspend fun lookupPreferred(word: String, preferredLanguage: String): DictionaryDefinition =
        withContext(Dispatchers.IO) {
            val requested = preferredLanguage.substringBefore('-').lowercase()
            val preferred = requested.takeIf(LANGUAGES::containsKey) ?: "en"
            val fallbackLanguages = listOf(preferred, "en", "pt").distinct()
            fallbackLanguages.firstNotNullOfOrNull { lookupOffline(word, it) }
                ?: fallbackLanguages.firstNotNullOfOrNull { lookupLanguage(word, it) }
                ?: throw IllegalStateException("No definition found for “$word”")
        }

    private fun lookupOffline(word: String, language: String): DictionaryDefinition? {
        val installed = ALL_PACKS.filter { it.source == language && packFile(it.id).isFile }
        val definitions = mutableListOf<String>()
        val matchedTargets = mutableListOf<String>()
        val partsOfSpeech = mutableListOf<String>()
        installed.forEach { spec ->
            val rows = mutableListOf<String>()
            runCatching {
                SQLiteDatabase.openDatabase(packFile(spec.id).path, null, SQLiteDatabase.OPEN_READONLY).use { database ->
                    if (spec.id == KAIKKI_PT_ID) {
                        database.rawQuery(
                            "SELECT part_of_speech, definitions_json FROM entries " +
                                "WHERE word = ? COLLATE NOCASE LIMIT 8",
                            arrayOf(word),
                        ).use { cursor ->
                            while (cursor.moveToNext()) {
                                cursor.getString(0).orEmpty().takeIf(String::isNotBlank)?.let(partsOfSpeech::add)
                                val values = JSONArray(cursor.getString(1).orEmpty())
                                for (index in 0 until values.length()) {
                                    values.optString(index).takeIf(String::isNotBlank)?.let(rows::add)
                                }
                            }
                        }
                    } else {
                        database.rawQuery(
                            "SELECT trans_list, sense_list FROM translation_grouped " +
                                "WHERE written_rep = ? COLLATE NOCASE ORDER BY score DESC, importance DESC LIMIT 6",
                            arrayOf(word),
                        ).use { cursor ->
                            while (cursor.moveToNext()) {
                                val translations = cursor.getString(0).orEmpty().replace(" | ", ", ").trim()
                                val sense = cursor.getString(1).orEmpty().trim()
                                val definition = if (sense.isBlank()) translations else "$translations — $sense"
                                if (definition.isNotBlank() && definition !in rows) rows += definition
                            }
                        }
                    }
                }
            }.onFailure { return@forEach }
            if (rows.isNotEmpty()) {
                val target = spec.target.uppercase()
                matchedTargets += target
                definitions += rows.take(if (spec.id == KAIKKI_PT_ID) 8 else 4).map { "$target · $it" }
            }
        }
        if (definitions.isEmpty()) return null
        val sourceName = LANGUAGES[language] ?: language.uppercase()
        return DictionaryDefinition(
            word = word,
            language = language,
            partOfSpeech = listOfNotNull(
                "$sourceName → ${matchedTargets.distinct().joinToString(", ")}",
                partsOfSpeech.distinct().joinToString(", ").takeIf(String::isNotBlank),
            ).joinToString(" · "),
            definitions = definitions.distinct(),
            sourceUrl = if (language == "pt" && "PT" in matchedTargets)
                "https://kaikki.org/ptwiktionary/" else "https://www.wikdict.com/",
        )
    }

    private fun lookupLanguage(word: String, language: String): DictionaryDefinition? {
        val host = if (language == "pt") "pt.wiktionary.org" else "en.wiktionary.org"
        val url = "https://$host/w/api.php".toHttpUrl().newBuilder()
            .addQueryParameter("action", "query")
            .addQueryParameter("prop", "extracts")
            .addQueryParameter("explaintext", "1")
            .addQueryParameter("redirects", "1")
            .addQueryParameter("titles", word)
            .addQueryParameter("format", "json")
            .addQueryParameter("formatversion", "2")
            .build()
        val extract = client.newCall(Request.Builder().url(url).build()).execute().use { response ->
            if (!response.isSuccessful) return null
            val root = JSONObject(response.body?.string().orEmpty())
            root.optJSONObject("query")?.optJSONArray("pages")?.optJSONObject(0)?.optString("extract")
        }.orEmpty()
        val parsed = parseExtract(extract, language, word)
        if (parsed.second.isEmpty()) return null
        return DictionaryDefinition(
            word = word,
            language = language,
            partOfSpeech = parsed.first,
            definitions = parsed.second,
            sourceUrl = "https://$host/wiki/${java.net.URLEncoder.encode(word, "UTF-8")}",
        )
    }

    internal fun parseExtract(extract: String, language: String, word: String): Pair<String, List<String>> {
        val wanted = if (language == "pt") "Português" else "English"
        val lines = extract.lines().map(String::trim)
        val languageIndex = lines.indexOfFirst { headingText(it).equals(wanted, ignoreCase = true) }
        if (languageIndex < 0) return "" to emptyList()
        val languageLevel = headingLevel(lines[languageIndex])
        val ignored = Regex(
            "^(Etimologia|Pronúncia|Tradução|Ver também|Ligações externas|Etymology.*|Pronunciation|Translations|Related terms|Derived terms|See also|Further reading|Anagrams)$",
            RegexOption.IGNORE_CASE,
        )
        var partOfSpeech = ""
        val definitions = mutableListOf<String>()
        var accepting = false
        for (index in languageIndex + 1 until lines.size) {
            val line = lines[index]
            val level = headingLevel(line)
            if (level > 0) {
                if (level <= languageLevel) break
                val heading = headingText(line)
                if (accepting) break
                if (ignored.matches(heading) || heading.isBlank()) continue
                accepting = true
                partOfSpeech = heading
                continue
            }
            if (!accepting || line.isBlank()) continue
            val lettersOnly = line.replace(Regex("[^\\p{L}]"), "").lowercase()
            if (lettersOnly == word.replace(Regex("[^\\p{L}]"), "").lowercase()) continue
            if (line.startsWith("IPA") || line.startsWith("Rhymes:") || line.startsWith("Hyphenation:")) continue
            if (line.length < 3 || line in definitions) continue
            definitions += line
            if (definitions.size == 4) break
        }
        return partOfSpeech to definitions
    }

    private fun headingLevel(line: String): Int =
        Regex("^(=+)\\s*.*?\\s*\\1$").matchEntire(line)?.groupValues?.get(1)?.length ?: 0

    private fun headingText(line: String): String = line.trim().trim('=').trim()

    fun languageFor(context: String): String {
        val normalized = " ${context.lowercase()} "
        val portugueseSignals = listOf(" de ", " para ", " que ", " não ", " uma ", " com ", " por ", "ção")
        return if (portugueseSignals.any(normalized::contains)) "pt" else "en"
    }

    private fun packFile(id: String) = File(packDirectory, "$id.sqlite3")

    private data class PackSpec(val id: String, val label: String, val source: String, val target: String)

    companion object {
        private const val WIKDICT_BASE = "https://download.wikdict.com/dictionaries/sqlite/2"
        private const val KAIKKI_PT_ID = "kaikki-pt-pt"
        private const val KAIKKI_PT_URL = "https://kaikki.org/ptwiktionary/raw-wiktextract-data.jsonl.gz"
        private val LANGUAGES = linkedMapOf(
            "bg" to "Bulgarian", "ca" to "Catalan", "cs" to "Czech", "da" to "Danish",
            "de" to "German", "el" to "Greek", "en" to "English", "es" to "Spanish",
            "fi" to "Finnish", "fr" to "French", "ga" to "Irish", "id" to "Indonesian",
            "it" to "Italian", "ja" to "Japanese", "ku" to "Kurdish", "la" to "Latin",
            "lt" to "Lithuanian", "mg" to "Malagasy", "nl" to "Dutch", "no" to "Norwegian",
            "pl" to "Polish", "pt" to "Portuguese", "ru" to "Russian", "sv" to "Swedish",
            "tr" to "Turkish", "zh" to "Chinese",
        )
        private val PACKS = LANGUAGES.flatMap { (source, sourceName) ->
            LANGUAGES.filterKeys { it != source }.map { (target, targetName) ->
                PackSpec("$source-$target", "$sourceName → $targetName", source, target)
            }
        }
        private val ALL_PACKS = PACKS + PackSpec(
            KAIKKI_PT_ID,
            "Portuguese → Portuguese (Kaikki)",
            "pt",
            "pt",
        )
    }
}
