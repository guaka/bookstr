package app.bookstr.nostr

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import app.bookstr.data.NostrAuthMode
import app.bookstr.data.SettingsRepository
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class Nip46SettingsTest {
    private lateinit var context: Context
    private lateinit var settings: SettingsRepository
    private val secret = "ab".repeat(32)
    private val remote = "cd".repeat(32)
    private val user = "ef".repeat(32)

    @Before fun setUp() {
        context = ApplicationProvider.getApplicationContext()
        settings = SettingsRepository(context)
        settings.disconnectNostr()
    }

    @After fun tearDown() { settings.disconnectNostr() }

    @Test fun credentialsNormalizeAndPersistWithoutLeavingSecretsInPlainPreferences() {
        settings.connectNip46(secret.uppercase(), remote.uppercase(), user.uppercase(),
            listOf(" wss://relay.example ", "", "  ", "wss://relay.example", "wss://second.example"))
        val restored = SettingsRepository(context)
        assertEquals(NostrAuthMode.Nip46, restored.authMode)
        assertEquals(secret, restored.nip46ClientSecretHex)
        assertEquals(remote, restored.nip46RemoteSignerPubkey)
        assertEquals(user, restored.pubkeyHex)
        assertEquals(listOf("wss://relay.example", "wss://second.example"), restored.nip46Relays)
        assertTrue(restored.hasNostrIdentity())
        val plain = context.getSharedPreferences("bookstr_settings", Context.MODE_PRIVATE).all
        assertFalse(plain.values.any { it.toString().contains(secret, ignoreCase = true) })
    }

    @Test fun invalidCredentialsAreRejectedBeforeChangingAnExistingIdentity() {
        settings.connectAmber(user, "app.huddle")
        for ((client, signer, pubkey, relays) in listOf(
            listOf("bad", remote, user, "wss://relay.example"),
            listOf(secret, "bad", user, "wss://relay.example"),
            listOf(secret, remote, "bad", "wss://relay.example"),
            listOf(secret, remote, user, "  "),
        )) {
            assertThrows(IllegalArgumentException::class.java) { settings.connectNip46(client, signer, pubkey, listOf(relays)) }
            assertEquals(NostrAuthMode.Amber, settings.authMode)
            assertEquals("app.huddle", settings.signerPackage)
            assertEquals(user, settings.pubkeyHex)
            assertNull(settings.nip46ClientSecretHex)
        }
    }

    @Test fun reconnectingSameClientPreservesSignerButChangingClientRevokesIt() {
        settings.connectNip46(secret, remote, user, listOf("wss://relay.example"))
        val old = Nip46Sessions.create(settings)!!
        settings.connectNip46(secret.uppercase(), remote, user, listOf("wss://relay.example"))
        assertTrue(old.isConfigured())
        settings.connectNip46("01".repeat(32), remote, user, listOf("wss://relay.example"))
        assertFalse(old.isConfigured())
        assertTrue(settings.hasNostrIdentity())
    }

    @Test fun changingToAmberClearsCredentialsAndRevokesRetainedSigner() {
        settings.connectNip46(secret, remote, user, listOf("wss://relay.example"))
        val signer = Nip46Sessions.create(settings)!!
        settings.connectAmber(user, "app.huddle")
        assertFalse(signer.isConfigured())
        assertNull(settings.nip46ClientSecretHex)
        assertNull(settings.nip46RemoteSignerPubkey)
        assertTrue(settings.nip46Relays.isEmpty())
        assertEquals(NostrAuthMode.Amber, settings.authMode)
    }

    @Test fun sameIdentityPreservesFavoriteCacheAndDifferentIdentityClearsIt() {
        settings.cacheNostrFavorites(user, "favorite-cache")
        settings.connectNip46(secret, remote, user.uppercase(), listOf("wss://relay.example"))
        assertEquals("favorite-cache", settings.cachedNostrFavorites(user))
        settings.connectNip46(secret, remote, "12".repeat(32), listOf("wss://relay.example"))
        assertNull(settings.cachedNostrFavorites(user))
    }

    @Test fun incompletePersistedCredentialsNeverBecomeConfiguredIdentity() {
        val secure = EncryptedSharedPreferences.create(context, "bookstr_secure",
            MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM)
        for (missing in listOf("nip46_client_secret", "nip46_remote_pubkey", "nip46_relays")) {
            settings.connectNip46(secret, remote, user, listOf("wss://relay.example"))
            secure.edit().remove(missing).commit()
            assertFalse("Missing $missing must invalidate identity", SettingsRepository(context).hasNostrIdentity())
            assertNull(Nip46Sessions.create(SettingsRepository(context)))
        }
        settings.connectNip46(secret, remote, user, listOf("wss://relay.example"))
        secure.edit().putString("nip46_remote_pubkey", " ").putString("nip46_relays", "\n\n").commit()
        assertNull(settings.nip46RemoteSignerPubkey)
        assertTrue(settings.nip46Relays.isEmpty())
        assertFalse(settings.hasNostrIdentity())
        settings.pubkeyHex = null
        assertFalse(settings.hasNostrIdentity())
    }
}
