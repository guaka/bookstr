package app.bookstr.data

import app.bookstr.nostr.CatalogService
import app.bookstr.util.Bech32
import org.json.JSONObject
import java.net.URI
import java.net.URLDecoder

/** Invitation validation mirrors the iOS v1 catalog invitation contract. */
data class CatalogConnection(val name: String, val pubkey: String, val relays: List<String>, val uri: String) {
    val service get() = CatalogService(pubkey, relays.first())
    companion object {
        fun parse(value: String): CatalogConnection {
            require(value.toByteArray().size <= 2048)
            val uri = URI(value)
            require(uri.scheme == "bookstr" && uri.host == "catalog" && uri.port == -1 && uri.userInfo == null && uri.fragment == null && uri.path in listOf("", "/"))
            val pairs = requireNotNull(uri.rawQuery).split('&').map {
                val parts = it.split('=', limit = 2)
                URLDecoder.decode(parts[0], "UTF-8") to URLDecoder.decode(parts.getOrElse(1) { "" }, "UTF-8")
            }
            require(pairs.all { it.first in listOf("v", "npub", "name", "relay") })
            fun single(key: String): String = pairs.filter { it.first == key }.also { require(it.size == 1) }.first().second
            require(single("v") == "1")
            val npub = single("npub")
            require(Regex("npub1[023456789acdefghjklmnpqrstuvwxyz]{58}").matches(npub))
            val key = Bech32.decode("npub", npub).also { require(it.size == 32) }.joinToString("") { "%02x".format(it) }
            val name = single("name").trim()
            require(name.isNotBlank() && name.toByteArray().size <= 80 && name.none(Char::isISOControl))
            val relays = pairs.filter { it.first == "relay" }.map { it.second }
            require(relays.size in 1..3)
            relays.forEach {
                val relay = URI(it)
                require(it.toByteArray().size <= 256 && it.none { c -> c.isWhitespace() || c.isISOControl() } && relay.scheme == "wss" &&
                    !relay.host.isNullOrBlank() && relay.userInfo == null && relay.fragment == null && relay.query == null)
            }
            return CatalogConnection(name, key, relays.distinct(), value)
        }
    }
}

data class CatalogSearchPage(val books: List<BookSearchResult>, val nextOffset: Int?) {
    companion object {
        fun parse(response: JSONObject, offset: Int): CatalogSearchPage {
            val records = if (!response.has("books")) org.json.JSONArray() else response.getJSONArray("books")
            val books = (0 until records.length()).mapNotNull { index ->
                val record = records.optJSONObject(index) ?: return@mapNotNull null
                val md5 = record.optString("md5").lowercase()
                if (!Regex("[0-9a-f]{32}").matches(md5)) return@mapNotNull null
                val format = BookFormat.entries.find { it.extension == record.optString("extension").lowercase() }
                fun text(key: String) = record.optString(key).takeUnless { it.isBlank() || it == "null" }
                BookSearchResult(id = md5, source = "libcat", title = text("title") ?: "Untitled",
                    author = text("authors") ?: text("author") ?: "Unknown author", year = text("year"),
                    publisher = text("publisher"), language = text("language"), format = format,
                    libvaultMd5 = md5, rightsStatus = text("rights_status") ?: RIGHTS_UNKNOWN,
                    license = text("license"), licenseUrl = text("license_url"), rightsSource = text("rights_source"))
            }.distinctBy { it.id }
            return CatalogSearchPage(books, response.optInt("next_offset", -1).takeIf { it > offset })
        }
        fun merge(first: List<BookSearchResult>, next: List<BookSearchResult>) = (first + next).distinctBy { it.id }
    }
}

data class TorrentEdition(val md5: String, val catalogId: Long, val collection: String, val expectedSize: Long?,
                          val filename: String? = null, val metadataUrl: String? = null) {
    val metadataUrls: List<String> get() = metadataUrl?.let { listOf(it) } ?: (if (collection.isEmpty()) listOf("nonfiction", "fiction", "comics") else listOf(collection)).map {
        val batch = catalogId / 1000 * 1000
        val folder = when (it) { "fiction" -> "libgen_rs_fic"; "comics" -> "libgen_li_comics"; else -> "libgen_rs_non_fic" }
        val prefix = when (it) { "fiction" -> "f_"; "comics" -> "c_"; else -> "r_" }
        val number = if (it == "nonfiction" && batch == 0L) "000" else batch.toString()
        "https://annas-archive.gl/dyn/small_file/torrents/external/$folder/$prefix$number.torrent"
    }
    fun json(): JSONObject = JSONObject().put("md5", md5).put("libgen_id", catalogId).put("collection", collection)
        .put("filesize_bytes", expectedSize ?: 0).also {
            if (filename != null) it.put("torrent", JSONObject().put("filename", filename).put("metadata_url", metadataUrl))
        }
    companion object {
        const val MAX_BYTES = 8L * 1024 * 1024 * 1024
        fun parse(record: JSONObject, md5: String): TorrentEdition {
            require(Regex("[0-9a-f]{32}").matches(md5) && record.optString("md5").lowercase() == md5) { "Invalid edition hash" }
            val kind = record.optString("collection").trim().lowercase()
            require(kind in listOf("", "nonfiction", "fiction", "comics", "zlib"))
            val rawSize = record.opt("filesize_bytes") ?: record.opt("filesize")
            val size = rawSize?.toString()?.toLongOrNull()?.takeIf { it != 0L }
            require(size == null || size in 1..MAX_BYTES)
            var filename: String? = null
            var url: String? = null
            val id = if (kind == "zlib") {
                val torrent = record.getJSONObject("torrent")
                filename = torrent.getString("filename")
                val number = filename.toLong()
                require(number.toString() == filename)
                url = torrent.getString("metadata_url")
                val match = Regex("https://annas-archive\\.gl/dyn/small_file/torrents/managed_by_aa/zlib/pilimi-zlib-([0-9]+)-([0-9]+)\\.torrent").matchEntire(url) ?: error("Invalid torrent URL")
                require(number in match.groupValues[1].toLong()..match.groupValues[2].toLong())
                number
            } else (record.opt("libgen_id") ?: record.get("id")).toString().toLong()
            require(id in 1 until 9_007_199_254_740_991L)
            return TorrentEdition(md5, id, kind, size, filename, url)
        }
    }
}
