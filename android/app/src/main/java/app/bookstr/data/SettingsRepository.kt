package app.bookstr.data

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

enum class ReaderTheme(val key: String) {
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

class SettingsRepository(context: Context) {
    private val plainPrefs = context.getSharedPreferences("bookstr_settings", Context.MODE_PRIVATE)

    private val securePrefs = EncryptedSharedPreferences.create(
        context,
        "bookstr_secure",
        MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

    var catalogUrl: String
        get() = plainPrefs.getString(KEY_CATALOG_URL, DEFAULT_CATALOG_URL) ?: DEFAULT_CATALOG_URL
        set(value) = plainPrefs.edit().putString(KEY_CATALOG_URL, value.trim()).apply()

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
        get() = plainPrefs.getBoolean(KEY_KEEP_ON_LOCK, false)
        set(value) = plainPrefs.edit().putBoolean(KEY_KEEP_ON_LOCK, value).apply()

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
        this.nsec = null
        this.pubkeyHex = pubkeyHex
        this.signerPackage = signerPackage
        this.authMode = NostrAuthMode.Amber
    }

    fun connectNsec(nsecValue: String, pubkeyHex: String) {
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
    }

    companion object {
        const val DEFAULT_CATALOG_URL = "https://example.org/catalog.json"
        const val DEFAULT_RELAYS = "wss://relay.damus.io\nwss://nos.lol"

        private const val KEY_CATALOG_URL = "catalog_url"
        private const val KEY_RELAYS = "relays"
        private const val KEY_THEME = "theme"
        private const val KEY_KEEP_ON_LOCK = "keep_on_lock"
        private const val KEY_AUTH_MODE = "auth_mode"
        private const val KEY_PUBKEY = "pubkey_hex"
        private const val KEY_SIGNER_PACKAGE = "signer_package"
        private const val KEY_NSEC = "nsec"
    }
}
