package app.bookstr.data

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

enum class ReaderTheme(val key: String) {
    White("white"),
    Paper("paper"),
    Night("night"),
    ;

    companion object {
        fun fromKey(key: String?): ReaderTheme =
            entries.firstOrNull { it.key == key } ?: Paper
    }
}

enum class NostrAuthMode(val key: String) {
    None("none"),
    Nsec("nsec"),
    Amber("amber"),
    ;

    companion object {
        fun fromKey(key: String?): NostrAuthMode =
            entries.firstOrNull { it.key == key } ?: None
    }
}

data class ReaderSession(
    val bookId: String,
    val bookTitle: String,
    val format: BookFormat,
    val author: String? = null,
    val year: String? = null,
    val locator: String? = null,
    val pageIndex: Int = 0,
    val pageOffset: Int = 0,
    val rightsStatus: String = RIGHTS_UNKNOWN,
    val license: String? = null,
    val licenseUrl: String? = null,
    val rightsSource: String? = null,
)

class SettingsRepository(context: Context) {
    private val plainPrefs = context.getSharedPreferences("bookstr_settings", Context.MODE_PRIVATE)

    private val securePrefs = EncryptedSharedPreferences.create(
        context,
        "bookstr_secure",
        MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

    var relays: List<String>
        get() = (plainPrefs.getString(KEY_RELAYS, DEFAULT_RELAYS) ?: DEFAULT_RELAYS)
            .split('\n', ',')
            .map { it.trim() }
            .filter { it.isNotEmpty() }
        set(value) = plainPrefs.edit().putString(KEY_RELAYS, value.joinToString("\n")).apply()

    var theme: ReaderTheme
        get() = ReaderTheme.fromKey(plainPrefs.getString(KEY_THEME, ReaderTheme.Paper.key))
        set(value) = plainPrefs.edit().putString(KEY_THEME, value.key).apply()

    var keepReadingOnLockScreen: Boolean
        get() = plainPrefs.getBoolean(KEY_KEEP_ON_LOCK, true)
        set(value) = plainPrefs.edit().putBoolean(KEY_KEEP_ON_LOCK, value).apply()

    var wordSort: String
        get() = plainPrefs.getString(KEY_WORD_SORT, "recent") ?: "recent"
        set(value) = plainPrefs.edit().putString(KEY_WORD_SORT, value).apply()

    var dictionarySource: String
        get() = plainPrefs.getString(KEY_DICTIONARY_SOURCE, "en") ?: "en"
        set(value) = plainPrefs.edit().putString(KEY_DICTIONARY_SOURCE, value).apply()

    var dictionaryTarget: String
        get() = plainPrefs.getString(KEY_DICTIONARY_TARGET, "pt") ?: "pt"
        set(value) = plainPrefs.edit().putString(KEY_DICTIONARY_TARGET, value).apply()

    fun pdfZoom(bookId: String): Float =
        plainPrefs.getFloat("$KEY_PDF_ZOOM_PREFIX$bookId", 1f).coerceIn(1f, 5f)

    fun savePdfZoom(bookId: String, zoom: Float) {
        plainPrefs.edit()
            .putFloat("$KEY_PDF_ZOOM_PREFIX$bookId", zoom.coerceIn(1f, 5f))
            .apply()
    }

    var authMode: NostrAuthMode
        get() {
            val stored = plainPrefs.getString(KEY_AUTH_MODE, null)
            if (stored != null) return NostrAuthMode.fromKey(stored)
            // Legacy: nsec alone implied local signing
            return if (!nsec.isNullOrBlank()) NostrAuthMode.Nsec else NostrAuthMode.None
        }
        set(value) = plainPrefs.edit().putString(KEY_AUTH_MODE, value.key).apply()

    /** Hex pubkey for the configured identity (Amber or derived from nsec). */
    var pubkeyHex: String?
        get() = plainPrefs.getString(KEY_PUBKEY, null)?.takeIf { it.isNotBlank() }
        set(value) {
            plainPrefs.edit().apply {
                if (value.isNullOrBlank()) remove(KEY_PUBKEY) else putString(KEY_PUBKEY, value.trim().lowercase())
            }.apply()
        }

    /** Package name of the NIP-55 signer (e.g. Amber). */
    var signerPackage: String?
        get() = plainPrefs.getString(KEY_SIGNER_PACKAGE, null)?.takeIf { it.isNotBlank() }
        set(value) {
            plainPrefs.edit().apply {
                if (value.isNullOrBlank()) remove(KEY_SIGNER_PACKAGE) else putString(KEY_SIGNER_PACKAGE, value.trim())
            }.apply()
        }

    var nsec: String?
        get() = securePrefs.getString(KEY_NSEC, null)
        set(value) {
            securePrefs.edit().apply {
                if (value.isNullOrBlank()) remove(KEY_NSEC) else putString(KEY_NSEC, value.trim())
            }.apply()
        }

    fun hasNostrIdentity(): Boolean =
        when (authMode) {
            NostrAuthMode.None -> false
            NostrAuthMode.Nsec -> !nsec.isNullOrBlank()
            NostrAuthMode.Amber -> !pubkeyHex.isNullOrBlank() && !signerPackage.isNullOrBlank()
        }

    fun connectAmber(pubkeyHex: String, signerPackage: String) {
        clearFavoriteCacheForDifferentIdentity(pubkeyHex)
        this.nsec = null
        this.pubkeyHex = pubkeyHex
        this.signerPackage = signerPackage
        this.authMode = NostrAuthMode.Amber
    }

    fun connectNsec(nsecValue: String, pubkeyHex: String) {
        clearFavoriteCacheForDifferentIdentity(pubkeyHex)
        this.signerPackage = null
        this.nsec = nsecValue
        this.pubkeyHex = pubkeyHex
        this.authMode = NostrAuthMode.Nsec
    }

    fun disconnectNostr() {
        nsec = null
        pubkeyHex = null
        signerPackage = null
        authMode = NostrAuthMode.None
        securePrefs.edit()
            .remove(KEY_FAVORITES_CACHE_PUBKEY)
            .remove(KEY_FAVORITES_CACHE_CONTENT)
            .remove(KEY_COLLECTIONS_CACHE_PUBKEY)
            .remove(KEY_COLLECTIONS_CACHE_CONTENT)
            .apply()
    }

    fun cacheNostrFavorites(pubkeyHex: String, plaintext: String) {
        securePrefs.edit()
            .putString(KEY_FAVORITES_CACHE_PUBKEY, pubkeyHex.lowercase())
            .putString(KEY_FAVORITES_CACHE_CONTENT, plaintext)
            .apply()
    }

    fun cachedNostrFavorites(pubkeyHex: String): String? {
        val cachedPubkey = securePrefs.getString(KEY_FAVORITES_CACHE_PUBKEY, null)
        if (!cachedPubkey.equals(pubkeyHex, ignoreCase = true)) return null
        return securePrefs.getString(KEY_FAVORITES_CACHE_CONTENT, null)?.takeIf(String::isNotBlank)
    }

    fun cacheNostrCollections(pubkeyHex: String, snapshot: CollectionSnapshot) {
        securePrefs.edit()
            .putString(KEY_COLLECTIONS_CACHE_PUBKEY, pubkeyHex.lowercase())
            .putString(KEY_COLLECTIONS_CACHE_CONTENT, CollectionSnapshotCodec.encode(snapshot))
            .apply()
    }

    fun cachedNostrCollections(pubkeyHex: String): CollectionSnapshot {
        val cachedPubkey = securePrefs.getString(KEY_COLLECTIONS_CACHE_PUBKEY, null)
        if (!cachedPubkey.equals(pubkeyHex, ignoreCase = true)) return CollectionSnapshot()
        return CollectionSnapshotCodec.decode(securePrefs.getString(KEY_COLLECTIONS_CACHE_CONTENT, null))
    }

    fun saveReaderSession(session: ReaderSession) {
        securePrefs.edit()
            .putString(KEY_READER_BOOK_ID, session.bookId)
            .putString(KEY_READER_BOOK_TITLE, session.bookTitle)
            .putString(KEY_READER_AUTHOR, session.author.orEmpty())
            .putString(KEY_READER_YEAR, session.year.orEmpty())
            .putString(KEY_READER_FORMAT, session.format.extension)
            .putString(KEY_READER_LOCATOR, session.locator.orEmpty())
            .putInt(KEY_READER_PAGE, session.pageIndex.coerceAtLeast(0))
            .putInt(KEY_READER_OFFSET, session.pageOffset.coerceAtLeast(0))
            .putString(KEY_READER_RIGHTS_STATUS, session.rightsStatus)
            .putString(KEY_READER_LICENSE, session.license.orEmpty())
            .putString(KEY_READER_LICENSE_URL, session.licenseUrl.orEmpty())
            .putString(KEY_READER_RIGHTS_SOURCE, session.rightsSource.orEmpty())
            .apply()
    }

    fun readerSession(): ReaderSession? {
        val bookId = securePrefs.getString(KEY_READER_BOOK_ID, null)?.takeIf(String::isNotBlank)
            ?: return null
        return ReaderSession(
            bookId = bookId,
            bookTitle = securePrefs.getString(KEY_READER_BOOK_TITLE, null)?.takeIf(String::isNotBlank)
                ?: "Book",
            author = securePrefs.getString(KEY_READER_AUTHOR, null)?.takeIf(String::isNotBlank),
            year = securePrefs.getString(KEY_READER_YEAR, null)?.takeIf(String::isNotBlank),
            format = BookFormat.from(securePrefs.getString(KEY_READER_FORMAT, null)),
            locator = securePrefs.getString(KEY_READER_LOCATOR, null)?.takeIf(String::isNotBlank),
            pageIndex = securePrefs.getInt(KEY_READER_PAGE, 0).coerceAtLeast(0),
            pageOffset = securePrefs.getInt(KEY_READER_OFFSET, 0).coerceAtLeast(0),
            rightsStatus = securePrefs.getString(KEY_READER_RIGHTS_STATUS, RIGHTS_UNKNOWN) ?: RIGHTS_UNKNOWN,
            license = securePrefs.getString(KEY_READER_LICENSE, null)?.takeIf(String::isNotBlank),
            licenseUrl = securePrefs.getString(KEY_READER_LICENSE_URL, null)?.takeIf(String::isNotBlank),
            rightsSource = securePrefs.getString(KEY_READER_RIGHTS_SOURCE, null)?.takeIf(String::isNotBlank),
        )
    }

    fun clearReaderSession() {
        securePrefs.edit()
            .remove(KEY_READER_BOOK_ID)
            .remove(KEY_READER_BOOK_TITLE)
            .remove(KEY_READER_AUTHOR)
            .remove(KEY_READER_YEAR)
            .remove(KEY_READER_FORMAT)
            .remove(KEY_READER_LOCATOR)
            .remove(KEY_READER_PAGE)
            .remove(KEY_READER_OFFSET)
            .remove(KEY_READER_RIGHTS_STATUS)
            .remove(KEY_READER_LICENSE)
            .remove(KEY_READER_LICENSE_URL)
            .remove(KEY_READER_RIGHTS_SOURCE)
            .apply()
    }

    private fun clearFavoriteCacheForDifferentIdentity(pubkeyHex: String) {
        val cachedPubkey = securePrefs.getString(KEY_FAVORITES_CACHE_PUBKEY, null)
        if (cachedPubkey == null || cachedPubkey.equals(pubkeyHex, ignoreCase = true)) return
        securePrefs.edit()
            .remove(KEY_FAVORITES_CACHE_PUBKEY)
            .remove(KEY_FAVORITES_CACHE_CONTENT)
            .remove(KEY_COLLECTIONS_CACHE_PUBKEY)
            .remove(KEY_COLLECTIONS_CACHE_CONTENT)
            .apply()
    }

    companion object {
        const val DEFAULT_RELAYS = "wss://relay.nomadwiki.org"

        private const val KEY_RELAYS = "relays"
        private const val KEY_THEME = "theme"
        private const val KEY_KEEP_ON_LOCK = "keep_on_lock"
        private const val KEY_WORD_SORT = "word_sort"
        private const val KEY_DICTIONARY_SOURCE = "dictionary_source"
        private const val KEY_DICTIONARY_TARGET = "dictionary_target"
        private const val KEY_PDF_ZOOM_PREFIX = "pdf_zoom_"
        private const val KEY_AUTH_MODE = "auth_mode"
        private const val KEY_PUBKEY = "pubkey_hex"
        private const val KEY_SIGNER_PACKAGE = "signer_package"
        private const val KEY_NSEC = "nsec"
        private const val KEY_FAVORITES_CACHE_PUBKEY = "nostr_favorites_cache_pubkey"
        private const val KEY_FAVORITES_CACHE_CONTENT = "nostr_favorites_cache_content"
        private const val KEY_COLLECTIONS_CACHE_PUBKEY = "nostr_collections_cache_pubkey"
        private const val KEY_COLLECTIONS_CACHE_CONTENT = "nostr_collections_cache_content"
        private const val KEY_READER_BOOK_ID = "reader_book_id"
        private const val KEY_READER_BOOK_TITLE = "reader_book_title"
        private const val KEY_READER_AUTHOR = "reader_author"
        private const val KEY_READER_YEAR = "reader_year"
        private const val KEY_READER_FORMAT = "reader_format"
        private const val KEY_READER_LOCATOR = "reader_locator"
        private const val KEY_READER_PAGE = "reader_page"
        private const val KEY_READER_OFFSET = "reader_offset"
        private const val KEY_READER_RIGHTS_STATUS = "reader_rights_status"
        private const val KEY_READER_LICENSE = "reader_license"
        private const val KEY_READER_LICENSE_URL = "reader_license_url"
        private const val KEY_READER_RIGHTS_SOURCE = "reader_rights_source"
    }
}
