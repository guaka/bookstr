package app.bookstr.data

import android.content.Context
import android.util.Log
import app.bookstr.nostr.AmberIntentSession
import app.bookstr.nostr.Nip55
import app.bookstr.nostr.Nip55Exception
import app.bookstr.nostr.NostrClient
import app.bookstr.nostr.NostrCrypto
import app.bookstr.nostr.NostrSignerFactory
import org.json.JSONArray
import org.json.JSONObject
import java.net.URI

data class SharedFavoriteRef(
    val bookstrId: String? = null,
    val libvaultMd5: String? = null,
    val isbn: String? = null,
    val url: String? = null,
    val title: String? = null,
    val author: String? = null,
    val year: String? = null,
    val format: String? = null,
    val blossomSha256: String? = null,
    val blossomUrl: String? = null,
    val addedAt: Long? = null,
    val rightsStatus: String = RIGHTS_UNKNOWN,
    val license: String? = null,
    val licenseUrl: String? = null,
    val rightsSource: String? = null,
)

data class ExternalFavorite(
    val key: String,
    val title: String,
    val author: String?,
    val year: String? = null,
    val url: String?,
    val isbn: String?,
    val libvaultMd5: String?,
    val format: String? = null,
    val blossomSha256: String? = null,
    val blossomUrl: String? = null,
    val addedAt: Long? = null,
    val rightsStatus: String = RIGHTS_UNKNOWN,
    val license: String? = null,
    val licenseUrl: String? = null,
    val rightsSource: String? = null,
)

data class SharedFavorites(
    val bookIds: Set<String> = emptySet(),
    val external: List<ExternalFavorite> = emptyList(),
)

data class FavoriteChunkManifest(val count: Int, val prefix: String)

class NostrFavoritesRepository(
    private val context: Context,
    private val settings: SettingsRepository,
) {
    suspend fun fetch(books: List<CatalogBook>): SharedFavorites {
        if (!settings.hasNostrIdentity()) return SharedFavorites()
        val pubkey = settings.pubkeyHex ?: return SharedFavorites()
        val event = NostrClient(settings.relays).fetchLatestFavorites(pubkey)
        if (event == null) {
            Log.w(TAG, "No favorite event returned by relays; keeping cached favorites")
            return cached(books) ?: SharedFavorites()
        }

        require(event.optString("pubkey").equals(pubkey, ignoreCase = true)) {
            "LibVault favorite event has the wrong author"
        }
        if (!NostrCrypto.verifyEvent(event)) {
            val eventId = event.optString("id")
            val computedId = NostrCrypto.eventId(event)
            Log.w(
                TAG,
                "Favorite signature invalid: event=$eventId computed=$computedId",
            )
            throw IllegalArgumentException(
                "LibVault favorite event signature is invalid (${eventId.take(8)} != ${computedId.take(8)})",
            )
        }

        val rootPlaintext = event.getString("content").let { decryptFromSelf(pubkey, it) }
        val plaintext = resolveFavoriteChunks(pubkey, rootPlaintext, event.optLong("created_at"))
        settings.cacheNostrFavorites(pubkey, plaintext)
        return matchSharedFavorites(parseSharedFavoriteTags(plaintext), books)
    }

    private suspend fun resolveFavoriteChunks(
        pubkey: String,
        rootPlaintext: String,
        fallbackAddedAt: Long,
    ): String {
        val manifest = chunkManifest(rootPlaintext)
            ?: return ensureFavoriteAddedAtTags(rootPlaintext, fallbackAddedAt)
        val combined = JSONArray(rootPlaintext)
        val client = NostrClient(settings.relays)
        for (index in 0 until manifest.count) {
            val dTag = "${manifest.prefix}-$index"
            val event = client.fetchLatestAddressableEvent(pubkey, dTag, "bookstr-favorites-chunk-$index")
                ?: throw IllegalStateException(
                    "Favorite sync is incomplete: chunk ${index + 1} of ${manifest.count} is missing",
                )
            require(event.optString("pubkey").equals(pubkey, ignoreCase = true)) {
                "Favorite chunk ${index + 1} has the wrong author"
            }
            require(NostrCrypto.verifyEvent(event)) {
                "Favorite chunk ${index + 1} has an invalid signature"
            }
            val chunk = runCatching {
                JSONArray(decryptFromSelf(pubkey, event.getString("content")))
            }.getOrElse {
                throw IllegalStateException(
                    "Favorite sync is incomplete: chunk ${index + 1} of ${manifest.count} could not be read",
                    it,
                )
            }
            for (tagIndex in 0 until chunk.length()) combined.put(chunk.get(tagIndex))
        }
        return ensureFavoriteAddedAtTags(combined.toString(), fallbackAddedAt)
    }

    fun cached(books: List<CatalogBook>): SharedFavorites? {
        val pubkey = settings.pubkeyHex ?: return null
        val plaintext = settings.cachedNostrFavorites(pubkey) ?: return null
        return runCatching { matchSharedFavorites(parseSharedFavoriteTags(plaintext), books) }.getOrNull()
    }

    suspend fun removeFavorite(book: CatalogBook, books: List<CatalogBook>): SharedFavorites =
        removeFavoriteMatching(books) { ref ->
            ref.bookstrId == book.id ||
                (!book.libvaultMd5.isNullOrBlank() &&
                    ref.libvaultMd5.equals(book.libvaultMd5, ignoreCase = true)) ||
                (normalizeIsbn(book.isbn).isNotEmpty() && normalizeIsbn(ref.isbn) == normalizeIsbn(book.isbn)) ||
                (!book.sourceUrl.isNullOrBlank() && ref.url == book.sourceUrl)
        }

    suspend fun addFavorite(book: CatalogBook, books: List<CatalogBook>): SharedFavorites {
        return addFavorite(
            SharedFavoriteRef(
                bookstrId = book.id,
                libvaultMd5 = book.libvaultMd5,
                isbn = book.isbn,
                url = book.sourceUrl,
                title = book.title,
                author = book.author,
                year = book.year,
                format = book.format.extension,
                blossomSha256 = book.blossomSha256,
                blossomUrl = book.epubUrl.takeIf { !book.blossomSha256.isNullOrBlank() },
                rightsStatus = book.rightsStatus,
                license = book.license,
                licenseUrl = book.licenseUrl,
                rightsSource = book.rightsSource,
            ),
            books,
        )
    }

    suspend fun addFavorite(reference: SharedFavoriteRef, books: List<CatalogBook>): SharedFavorites {
        val pubkey = settings.pubkeyHex ?: throw Nip55Exception("Connect Nostr to edit favorites")
        var plaintext = settings.cachedNostrFavorites(pubkey)
        if (plaintext == null) {
            fetch(books)
            plaintext = settings.cachedNostrFavorites(pubkey)
        }
        val refs = parseSharedFavoriteTags(plaintext ?: "[]").toMutableList()
        val alreadyPresent = refs.any { ref ->
            (!reference.bookstrId.isNullOrBlank() && ref.bookstrId == reference.bookstrId) ||
                (!reference.libvaultMd5.isNullOrBlank() &&
                    ref.libvaultMd5.equals(reference.libvaultMd5, ignoreCase = true)) ||
                (normalizeIsbn(reference.isbn).isNotEmpty() &&
                    normalizeIsbn(ref.isbn) == normalizeIsbn(reference.isbn)) ||
                (!reference.url.isNullOrBlank() && ref.url == reference.url)
        }
        if (!alreadyPresent) {
            refs += reference.copy(
                addedAt = System.currentTimeMillis() / 1000,
            )
        }
        return publishFavorites(pubkey, refs, books)
    }

    suspend fun removeFavorite(favorite: ExternalFavorite, books: List<CatalogBook>): SharedFavorites =
        removeFavoriteMatching(books) { ref ->
            ref.bookstrId == favorite.key ||
                (!favorite.libvaultMd5.isNullOrBlank() &&
                    ref.libvaultMd5.equals(favorite.libvaultMd5, ignoreCase = true)) ||
                (normalizeIsbn(favorite.isbn).isNotEmpty() &&
                    normalizeIsbn(ref.isbn) == normalizeIsbn(favorite.isbn)) ||
                (!favorite.url.isNullOrBlank() && ref.url == favorite.url)
        }

    private suspend fun removeFavoriteMatching(
        books: List<CatalogBook>,
        matches: (SharedFavoriteRef) -> Boolean,
    ): SharedFavorites {
        val pubkey = settings.pubkeyHex ?: throw Nip55Exception("Connect Nostr to edit favorites")
        var plaintext = settings.cachedNostrFavorites(pubkey)
        if (plaintext == null) {
            fetch(books)
            plaintext = settings.cachedNostrFavorites(pubkey)
        }
        val refs = parseSharedFavoriteTags(plaintext ?: "[]")
        val remaining = refs.filterNot(matches)
        require(remaining.size != refs.size) { "This book is not in the synced favorites list" }
        return publishFavorites(pubkey, remaining, books)
    }

    private suspend fun publishFavorites(
        pubkey: String,
        refs: List<SharedFavoriteRef>,
        books: List<CatalogBook>,
    ): SharedFavorites {
        val updatedPlaintext = serializeSharedFavoriteTags(refs)
        val ciphertext = encryptToSelf(pubkey, updatedPlaintext)
        val signer = NostrSignerFactory.create(context, settings)
            ?: throw Nip55Exception("Connect Nostr to edit favorites")
        val now = System.currentTimeMillis() / 1000
        val unsigned = JSONObject()
            .put("kind", NostrClient.KIND_FAVORITES)
            .put("created_at", now)
            .put(
                "tags",
                JSONArray().put(JSONArray().put("d").put(NostrClient.FAVORITES_D_TAG)),
            )
            .put("content", ciphertext)
        val signed = signer.signEvent(unsigned)
        val relays = (settings.relays + NostrClient.DEFAULT_INTEROP_RELAY).distinct()
        require(NostrClient(relays).publishEvent(signed)) { "Relays did not accept the updated favorites" }
        settings.cacheNostrFavorites(pubkey, updatedPlaintext)
        return matchSharedFavorites(refs, books)
    }

    private suspend fun encryptToSelf(pubkey: String, plaintext: String): String {
        if (settings.authMode != NostrAuthMode.Amber) {
            throw Nip55Exception("Editing private favorites currently requires Amber on Android")
        }
        val pkg = settings.signerPackage ?: throw Nip55Exception("Amber is not connected")
        return Nip55.encryptNip44ViaContentResolver(context, pkg, plaintext, pubkey, pubkey)
            ?: AmberIntentSession.Host.session?.encryptNip44(plaintext, pubkey, pubkey, pkg)
            ?: throw Nip55Exception(
                "Amber needs approval to encrypt favorites. Reconnect Amber in Settings.",
            )
    }

    private suspend fun decryptFromSelf(pubkey: String, ciphertext: String): String {
        return when (settings.authMode) {
            NostrAuthMode.Amber -> {
                val pkg = settings.signerPackage ?: throw Nip55Exception("Amber is not connected")
                Nip55.decryptNip44ViaContentResolver(context, pkg, ciphertext, pubkey, pubkey)
                    ?: AmberIntentSession.Host.session?.decryptNip44(ciphertext, pubkey, pubkey, pkg)
                    ?: throw Nip55Exception(
                        "Amber needs approval to decrypt favorites. Open Settings and reconnect Amber.",
                    )
            }
            NostrAuthMode.Nsec -> throw Nip55Exception(
                "Private favorite decryption currently requires Amber on Android.",
            )
            NostrAuthMode.None -> throw Nip55Exception("Connect Nostr to load LibVault favorites")
        }
    }

    companion object {
        fun chunkManifest(plaintext: String): FavoriteChunkManifest? {
            val tags = JSONArray(plaintext)
            for (index in 0 until tags.length()) {
                val tag = tags.optJSONArray(index) ?: continue
                if (tag.optString(0) != "bookstr-chunks" && tag.optString(0) != "libvault-chunks") continue
                val count = tag.optString(1).toIntOrNull() ?: return null
                if (count !in 1..10_000) return null
                val prefix = tag.optString(2).ifBlank { "libvault-favorites-chunk" }
                if (prefix.isBlank()) return null
                return FavoriteChunkManifest(count, prefix)
            }
            return null
        }

        fun ensureFavoriteAddedAtTags(plaintext: String, fallbackAddedAt: Long): String {
            if (fallbackAddedAt <= 0) return plaintext
            val tags = JSONArray(plaintext)
            val favoriteIds = linkedSetOf<String>()
            val timestampedIds = mutableSetOf<String>()
            val invalidTimestampIndexes = mutableListOf<Int>()
            for (index in 0 until tags.length()) {
                val tag = tags.optJSONArray(index) ?: continue
                val name = tag.optString(0)
                val md5 = tag.optString(1).lowercase()
                if (!MD5.matches(md5)) continue
                if (name == "libvault" || name == "libvault-book" || name == "blossom") {
                    favoriteIds += md5
                }
                if (name == "libvault-added") {
                    if (tag.optString(2).toLongOrNull()?.let { it > 0 } == true) {
                        timestampedIds += md5
                    } else {
                        invalidTimestampIndexes += index
                    }
                }
            }
            invalidTimestampIndexes.asReversed().forEach(tags::remove)
            var changed = invalidTimestampIndexes.isNotEmpty()
            for (md5 in favoriteIds - timestampedIds) {
                tags.put(
                    JSONArray()
                        .put("libvault-added")
                        .put(md5)
                        .put(fallbackAddedAt.toString()),
                )
                changed = true
            }
            return if (changed) tags.toString() else plaintext
        }

        fun serializeSharedFavoriteTags(refs: List<SharedFavoriteRef>): String {
            val tags = JSONArray().put(JSONArray().put("bookstr-publications").put("2"))
            refs.forEach { ref ->
                if (!ref.url.isNullOrBlank()) tags.put(JSONArray().put("r").put(ref.url))
                when {
                    !ref.libvaultMd5.isNullOrBlank() -> {
                        tags.put(JSONArray().put("libvault").put(ref.libvaultMd5))
                        if (ref.addedAt != null && ref.addedAt > 0) {
                            tags.put(
                                JSONArray()
                                    .put("libvault-added")
                                    .put(ref.libvaultMd5)
                                    .put(ref.addedAt.toString()),
                            )
                        }
                        tags.put(
                            JSONArray()
                                .put("libvault-book")
                                .put(ref.libvaultMd5)
                                .put(ref.title.orEmpty())
                                .put(ref.author.orEmpty())
                                .put(ref.format.orEmpty())
                                .put("")
                                .put(ref.year.orEmpty())
                                .put("")
                                .put("")
                                .put("")
                                .put("")
                                .put(ref.rightsStatus)
                                .put(ref.license.orEmpty())
                                .put(ref.licenseUrl.orEmpty())
                                .put(ref.rightsSource.orEmpty()),
                        )
                        if (!ref.blossomSha256.isNullOrBlank() || !ref.blossomUrl.isNullOrBlank()) {
                            tags.put(
                                JSONArray()
                                    .put("blossom")
                                    .put(ref.libvaultMd5)
                                    .put(ref.blossomSha256.orEmpty())
                                    .put(ref.blossomUrl.orEmpty())
                                    .put(ref.format.orEmpty()),
                            )
                        }
                    }
                    !ref.bookstrId.isNullOrBlank() -> {
                        tags.put(
                            JSONArray()
                                .put("book")
                                .put("bookstr")
                                .put(ref.bookstrId)
                                .put((ref.addedAt ?: 0L).toString())
                                .put(ref.url.orEmpty()),
                        )
                        tags.put(
                            JSONArray()
                                .put("bookstr")
                                .put(ref.bookstrId)
                                .put(ref.title.orEmpty())
                                .put(ref.author.orEmpty())
                                .put(ref.url.orEmpty())
                                .put(ref.format.orEmpty())
                                .put(ref.year.orEmpty())
                                .put("")
                                .put("")
                                .put("")
                                .put("")
                                .put(ref.rightsStatus)
                                .put(ref.license.orEmpty())
                                .put(ref.licenseUrl.orEmpty())
                                .put(ref.rightsSource.orEmpty()),
                        )
                    }
                    !ref.blossomSha256.isNullOrBlank() && SHA256.matches(ref.blossomSha256) -> tags.put(
                        JSONArray()
                            .put("book")
                            .put("blossom")
                            .put(ref.blossomSha256.lowercase())
                            .put((ref.addedAt ?: 0L).toString())
                            .put(ref.blossomUrl ?: ref.url.orEmpty()),
                    )
                    !ref.url.isNullOrBlank() && normalizeIsbn(ref.isbn).isEmpty() -> tags.put(
                        JSONArray()
                            .put("book")
                            .put("url")
                            .put(ref.url)
                            .put((ref.addedAt ?: 0L).toString()),
                    )
                }
                val isbn = normalizeIsbn(ref.isbn)
                if (isbn.isNotEmpty()) {
                    if (ref.libvaultMd5.isNullOrBlank() && ref.bookstrId.isNullOrBlank()) {
                        tags.put(
                            JSONArray()
                                .put("book")
                                .put("isbn")
                                .put(isbn)
                                .put((ref.addedAt ?: 0L).toString())
                                .put(ref.url.orEmpty()),
                        )
                    }
                    tags.put(JSONArray().put("i").put("isbn:$isbn").put(ref.url.orEmpty()))
                }
            }
            return tags.toString()
        }

        fun parseSharedFavoriteTags(plaintext: String): List<SharedFavoriteRef> {
            val value = JSONArray(plaintext)
            val refs = mutableListOf<SharedFavoriteRef>()
            var pendingUrl: String? = null
            var currentIndex: Int? = null
            val blossomOnlyIds = mutableSetOf<String>()

            fun validUrl(value: String?): String? {
                val candidate = value?.takeIf { it.isNotBlank() } ?: return null
                return runCatching { URI(candidate) }.getOrNull()
                    ?.takeIf { it.scheme == "http" || it.scheme == "https" }
                    ?.let { candidate }
            }

            fun supportedFormat(value: String): String? =
                value.lowercase().takeIf { it == "epub" || it == "pdf" }

            fun mergeAt(index: Int, ref: SharedFavoriteRef, preferIncomingUrl: Boolean = false) {
                val old = refs[index]
                refs[index] = old.copy(
                    bookstrId = old.bookstrId ?: ref.bookstrId,
                    libvaultMd5 = old.libvaultMd5 ?: ref.libvaultMd5,
                    isbn = old.isbn ?: ref.isbn,
                    url = if (preferIncomingUrl) ref.url ?: old.url else old.url ?: ref.url,
                    blossomSha256 = old.blossomSha256 ?: ref.blossomSha256,
                    blossomUrl = old.blossomUrl ?: ref.blossomUrl,
                    addedAt = listOfNotNull(old.addedAt, ref.addedAt).minOrNull(),
                )
                currentIndex = index
            }

            fun replaceCurrent(transform: (SharedFavoriteRef) -> SharedFavoriteRef) {
                val index = currentIndex ?: return
                refs[index] = transform(refs[index])
            }

            for (i in 0 until value.length()) {
                val item = value.optJSONArray(i) ?: continue
                val name = item.optString(0)
                when {
                    name == "book" && item.length() > 3 -> {
                        val namespace = item.optString(1)
                        val identifier = item.optString(2)
                        val addedAt = item.optString(3).toLongOrNull()?.takeIf { it > 0 }
                        val locator = validUrl(item.optString(4)) ?: pendingUrl
                        val ref = when {
                            namespace == "libvault" && MD5.matches(identifier) -> SharedFavoriteRef(
                                libvaultMd5 = identifier.lowercase(), url = locator, addedAt = addedAt,
                            )
                            namespace == "bookstr" && identifier.isNotBlank() -> SharedFavoriteRef(
                                bookstrId = identifier, url = locator, addedAt = addedAt,
                            )
                            namespace == "isbn" && normalizeIsbn(identifier).isNotEmpty() -> SharedFavoriteRef(
                                isbn = normalizeIsbn(identifier), url = locator, addedAt = addedAt,
                            )
                            namespace == "url" && validUrl(identifier) != null -> SharedFavoriteRef(
                                url = validUrl(identifier), addedAt = addedAt,
                            )
                            namespace == "blossom" && SHA256.matches(identifier) -> SharedFavoriteRef(
                                url = locator, blossomSha256 = identifier.lowercase(),
                                blossomUrl = locator, addedAt = addedAt,
                            )
                            else -> null
                        }
                        if (ref != null) {
                            val existing = refs.indexOfFirst {
                                (ref.libvaultMd5 != null && it.libvaultMd5 == ref.libvaultMd5) ||
                                    (ref.bookstrId != null && it.bookstrId == ref.bookstrId) ||
                                    (ref.isbn != null && normalizeIsbn(it.isbn) == ref.isbn) ||
                                    (ref.blossomSha256 != null && it.blossomSha256 == ref.blossomSha256) ||
                                    (ref.url != null && it.url == ref.url)
                            }
                            if (existing >= 0) {
                                val old = refs[existing]
                                mergeAt(existing, ref, preferIncomingUrl = old.addedAt == null && ref.addedAt != null)
                            } else if (currentIndex != null) {
                                val current = refs[currentIndex!!]
                                val currentIsUrlOnly = current.libvaultMd5 == null && current.bookstrId == null &&
                                    current.isbn == null && current.blossomSha256 == null
                                val incomingIsUrlOnly = ref.libvaultMd5 == null && ref.bookstrId == null &&
                                    ref.isbn == null && ref.blossomSha256 == null
                                if ((currentIsUrlOnly && ref.libvaultMd5 != null) ||
                                    (current.libvaultMd5 != null && incomingIsUrlOnly)
                                ) {
                                    mergeAt(currentIndex!!, ref)
                                } else {
                                    refs += ref
                                    currentIndex = refs.lastIndex
                                }
                            } else {
                                refs += ref
                                currentIndex = refs.lastIndex
                            }
                            pendingUrl = null
                        }
                    }
                    name == "r" && item.optString(1).isNotBlank() -> {
                        pendingUrl = item.optString(1)
                    }
                    name == "libvault" && MD5.matches(item.optString(1)) -> {
                        val md5 = item.optString(1).lowercase()
                        val existing = refs.indexOfFirst { it.libvaultMd5 == md5 }
                        val legacyUrl = validUrl(item.optString(2)) ?: pendingUrl
                        if (existing >= 0) {
                            refs[existing] = refs[existing].copy(url = refs[existing].url ?: legacyUrl)
                            currentIndex = existing
                        } else {
                            val current = currentIndex?.let(refs::get)
                            if (legacyUrl != null && current != null && current.libvaultMd5 == null &&
                                current.bookstrId == null && current.isbn == null && current.blossomSha256 == null
                            ) {
                                mergeAt(currentIndex!!, SharedFavoriteRef(libvaultMd5 = md5, url = legacyUrl))
                            } else {
                                refs += SharedFavoriteRef(libvaultMd5 = md5, url = legacyUrl)
                                currentIndex = refs.lastIndex
                            }
                        }
                        pendingUrl = null
                    }
                    name == "bookstr" && item.optString(1).isNotBlank() -> {
                        val rights = rightsFromTag(item, 11)
                        val next = SharedFavoriteRef(
                            bookstrId = item.optString(1),
                            title = item.optString(2).ifBlank { null },
                            author = item.optString(3).ifBlank { null },
                            url = item.optString(4).ifBlank { pendingUrl },
                            format = item.optString(5).ifBlank { null },
                            year = item.optString(6).ifBlank { null },
                            rightsStatus = rights.status,
                            license = rights.license,
                            licenseUrl = rights.licenseUrl,
                            rightsSource = rights.source,
                        )
                        val existing = refs.indexOfFirst { it.bookstrId == next.bookstrId }
                        if (existing >= 0) {
                            val old = refs[existing]
                            refs[existing] = old.copy(
                                title = old.title ?: next.title,
                                author = old.author ?: next.author,
                                url = old.url ?: next.url,
                                format = old.format ?: next.format,
                                year = old.year ?: next.year,
                                rightsStatus = BookRightsMetadata.preferred(
                                    BookRightsMetadata.normalize(old.rightsStatus, old.license, old.licenseUrl, old.rightsSource),
                                    rights,
                                ).status,
                                license = BookRightsMetadata.preferred(
                                    BookRightsMetadata.normalize(old.rightsStatus, old.license, old.licenseUrl, old.rightsSource),
                                    rights,
                                ).license,
                                licenseUrl = BookRightsMetadata.preferred(
                                    BookRightsMetadata.normalize(old.rightsStatus, old.license, old.licenseUrl, old.rightsSource),
                                    rights,
                                ).licenseUrl,
                                rightsSource = BookRightsMetadata.preferred(
                                    BookRightsMetadata.normalize(old.rightsStatus, old.license, old.licenseUrl, old.rightsSource),
                                    rights,
                                ).source,
                            )
                            currentIndex = existing
                        } else {
                            refs += next
                            currentIndex = refs.lastIndex
                        }
                        pendingUrl = null
                    }
                    name == "libvault-added" && MD5.matches(item.optString(1)) -> {
                        val md5 = item.optString(1).lowercase()
                        val addedAt = item.optString(2).toLongOrNull()?.takeIf { it > 0 } ?: continue
                        val index = refs.indexOfFirst { it.libvaultMd5 == md5 }
                        if (index >= 0) {
                            currentIndex = index
                            replaceCurrent {
                                it.copy(addedAt = it.addedAt?.let { existing -> minOf(existing, addedAt) } ?: addedAt)
                            }
                        } else {
                            refs += SharedFavoriteRef(libvaultMd5 = md5, addedAt = addedAt)
                            currentIndex = refs.lastIndex
                        }
                    }
                    name == "libvault-book" || name == "bookstr-book" -> {
                        val identifier = item.optString(1)
                        val isLibvault = MD5.matches(identifier)
                        val index = if (isLibvault) refs.indexOfFirst { it.libvaultMd5 == identifier.lowercase() }
                        else refs.indexOfFirst { it.bookstrId == identifier }
                        if (index < 0 && !isLibvault) continue
                        val format = supportedFormat(item.optString(4))
                        val rights = rightsFromTag(item, if (name == "libvault-book") 11 else 10)
                        if (index >= 0) {
                            currentIndex = index
                            replaceCurrent {
                                it.copy(
                                    title = item.optString(2).ifBlank { it.title },
                                    author = item.optString(3).ifBlank { it.author },
                                    format = format ?: it.format,
                                    year = item.optString(6).ifBlank { it.year },
                                    rightsStatus = rights.status,
                                    license = rights.license,
                                    licenseUrl = rights.licenseUrl,
                                    rightsSource = rights.source,
                                )
                            }
                        } else {
                            refs += SharedFavoriteRef(
                                libvaultMd5 = identifier.lowercase(),
                                title = item.optString(2).ifBlank { null },
                                author = item.optString(3).ifBlank { null },
                                format = format,
                                year = item.optString(6).ifBlank { null },
                                rightsStatus = rights.status,
                                license = rights.license,
                                licenseUrl = rights.licenseUrl,
                                rightsSource = rights.source,
                            )
                            currentIndex = refs.lastIndex
                        }
                    }
                    name == "blossom" && MD5.matches(item.optString(1)) -> {
                        val md5 = item.optString(1).lowercase()
                        val index = refs.indexOfFirst { it.libvaultMd5 == md5 }
                        if (index >= 0) {
                            currentIndex = index
                            replaceCurrent {
                                it.copy(
                                    blossomSha256 = item.optString(2).ifBlank { it.blossomSha256 },
                                    blossomUrl = item.optString(3).ifBlank { it.blossomUrl },
                                    format = if (md5 in blossomOnlyIds) it.format ?: item.optString(4).ifBlank { null }
                                    else supportedFormat(item.optString(4)) ?: it.format,
                                )
                            }
                        } else {
                            refs += SharedFavoriteRef(
                                libvaultMd5 = md5,
                                blossomSha256 = item.optString(2).takeIf { SHA256.matches(it) }?.lowercase(),
                                blossomUrl = validUrl(item.optString(3)),
                                format = item.optString(4).ifBlank { null },
                            )
                            blossomOnlyIds += md5
                            currentIndex = refs.lastIndex
                        }
                    }
                    name == "i" && item.optString(1).startsWith("isbn:") -> {
                        val isbn = normalizeIsbn(item.optString(1).removePrefix("isbn:"))
                        if (isbn.isEmpty()) continue
                        if (currentIndex != null) {
                            replaceCurrent {
                                it.copy(
                                    isbn = isbn,
                                    url = it.url ?: item.optString(2).ifBlank { null },
                                )
                            }
                        } else {
                            refs += SharedFavoriteRef(
                                isbn = isbn,
                                url = item.optString(2).ifBlank { pendingUrl },
                            )
                            currentIndex = refs.lastIndex
                        }
                        pendingUrl = null
                    }
                }
            }
            return refs
        }

        fun matchSharedFavorites(
            refs: List<SharedFavoriteRef>,
            books: List<CatalogBook>,
        ): SharedFavorites {
            val matched = linkedSetOf<String>()
            val external = linkedMapOf<String, ExternalFavorite>()

            for (ref in refs) {
                val isbn = normalizeIsbn(ref.isbn)
                val book = books.firstOrNull { candidate ->
                    candidate.id == ref.bookstrId ||
                        (ref.libvaultMd5 != null &&
                            candidate.libvaultMd5.equals(ref.libvaultMd5, ignoreCase = true)) ||
                        (isbn.isNotEmpty() && normalizeIsbn(candidate.isbn) == isbn) ||
                        (ref.blossomSha256 != null &&
                            candidate.blossomSha256.equals(ref.blossomSha256, ignoreCase = true)) ||
                        (ref.url != null && (candidate.sourceUrl == ref.url || candidate.epubUrl == ref.url))
                }
                if (book != null) {
                    matched += book.id
                    continue
                }

                val key = ref.libvaultMd5 ?: ref.bookstrId ?: isbn.ifEmpty { null }
                    ?: ref.blossomSha256 ?: ref.url ?: continue
                external[key] = ExternalFavorite(
                    key = key,
                    title = ref.title ?: "LibVault favorite",
                    author = ref.author,
                    year = ref.year,
                    url = ref.url,
                    isbn = isbn.ifEmpty { null },
                    libvaultMd5 = ref.libvaultMd5,
                    format = ref.format,
                    blossomSha256 = ref.blossomSha256,
                    blossomUrl = ref.blossomUrl,
                    addedAt = ref.addedAt,
                    rightsStatus = ref.rightsStatus,
                    license = ref.license,
                    licenseUrl = ref.licenseUrl,
                    rightsSource = ref.rightsSource,
                )
            }
            return SharedFavorites(matched, external.values.toList())
        }

        fun normalizeIsbn(value: String?): String {
            val normalized = value.orEmpty().filter { it.isDigit() || it.equals('X', ignoreCase = true) }.uppercase()
            return normalized.takeIf { it.length == 10 || it.length == 13 }.orEmpty()
        }

        private fun rightsFromTag(item: JSONArray, offset: Int): BookRights = BookRightsMetadata.normalize(
            status = item.optString(offset).ifBlank { null },
            license = item.optString(offset + 1).ifBlank { null },
            licenseUrl = item.optString(offset + 2).ifBlank { null },
            source = item.optString(offset + 3).ifBlank { null },
        )

        private val MD5 = Regex("^[a-fA-F0-9]{32}$")
        private val SHA256 = Regex("^[a-fA-F0-9]{64}$")
        private const val TAG = "NostrFavorites"
    }
}
