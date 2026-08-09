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

    var nsec: String?
        get() = securePrefs.getString(KEY_NSEC, null)
        set(value) {
            securePrefs.edit().apply {
                if (value.isNullOrBlank()) remove(KEY_NSEC) else putString(KEY_NSEC, value.trim())
            }.apply()
        }

    companion object {
        const val DEFAULT_CATALOG_URL = "https://example.com/catalog.json"
        const val DEFAULT_RELAYS = "wss://relay.damus.io\nwss://nos.lol"

        private const val KEY_CATALOG_URL = "catalog_url"
        private const val KEY_RELAYS = "relays"
        private const val KEY_THEME = "theme"
        private const val KEY_KEEP_ON_LOCK = "keep_on_lock"
        private const val KEY_NSEC = "nsec"
    }
}
