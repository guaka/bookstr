package app.bookstr.nostr

import android.app.Application
import org.robolectric.RuntimeEnvironment
import app.bookstr.data.NostrAuthMode
import app.bookstr.data.SettingsRepository
import app.bookstr.data.ShadowEncryptedSharedPreferences
import app.bookstr.data.ShadowMasterKeyBuilder
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(
    application = Application::class,
    sdk = [28],
    instrumentedPackages = ["androidx.security.crypto"],
    shadows = [ShadowMasterKeyBuilder::class, ShadowEncryptedSharedPreferences::class],
)
class NostrSignerContractCoverageTest {
    private val context get() = RuntimeEnvironment.getApplication()

    @Test
    fun defaultSignerNip44MethodsAreExplicitlyUnsupported() = runBlocking<Unit> {
        val signer = object : NostrSigner {
            override fun isConfigured() = true
            override suspend fun getPublicKey() = "pubkey"
            override suspend fun signEvent(unsigned: JSONObject) = unsigned
        }

        assertThrows(UnsupportedOperationException::class.java) {
            runBlocking { signer.nip44Encrypt("plain", "peer") }
        }
        assertThrows(UnsupportedOperationException::class.java) {
            runBlocking { signer.nip44Decrypt("cipher", "peer") }
        }
    }

    @Test
    fun localSignerDerivesAndCachesKeyThenSignsAndRoundTripsNip44() = runBlocking<Unit> {
        val settings = SettingsRepository(context)
        val oldMode = settings.authMode
        val oldNsec = settings.nsec
        val oldPubkey = settings.pubkeyHex
        try {
            settings.authMode = NostrAuthMode.Nsec
            settings.nsec = "00".repeat(31) + "01"
            settings.pubkeyHex = null
            val signer = LocalNsecSigner(settings)

            assertTrue(signer.isConfigured())
            val pubkey = signer.getPublicKey()
            assertEquals(NostrCrypto.publicKeyHex(NostrCrypto.parsePrivateKey(settings.nsec!!)), pubkey)
            assertEquals(pubkey, settings.pubkeyHex)
            assertEquals(pubkey, signer.getPublicKey())

            val unsigned = JSONObject().put("kind", 1).put("created_at", 1L)
                .put("tags", JSONArray()).put("content", "hello")
            val signed = signer.signEvent(unsigned)
            assertEquals(pubkey, signed.getString("pubkey"))
            assertTrue(NostrCrypto.verifyEvent(signed))

            val ciphertext = signer.nip44Encrypt("private catalog", pubkey)
            assertEquals("private catalog", signer.nip44Decrypt(ciphertext, pubkey))
        } finally {
            settings.authMode = oldMode
            settings.nsec = oldNsec
            settings.pubkeyHex = oldPubkey
        }
    }

    @Test
    fun localSignerConfigurationAndMissingOrInvalidSecretPaths() = runBlocking<Unit> {
        val settings = SettingsRepository(context)
        val oldMode = settings.authMode
        val oldNsec = settings.nsec
        val oldPubkey = settings.pubkeyHex
        try {
            val signer = LocalNsecSigner(settings)
            settings.authMode = NostrAuthMode.Nsec
            settings.nsec = "   "
            assertFalse(signer.isConfigured())
            settings.nsec = null
            assertThrows(IllegalStateException::class.java) { runBlocking { signer.getPublicKey() } }
            assertThrows(IllegalStateException::class.java) { runBlocking { signer.signEvent(JSONObject()) } }
            assertThrows(IllegalArgumentException::class.java) {
                runBlocking { signer.nip44Encrypt("plain", "peer") }
            }
            assertThrows(IllegalArgumentException::class.java) {
                runBlocking { signer.nip44Decrypt("cipher", "peer") }
            }
            settings.nsec = "invalid"
            assertTrue(signer.isConfigured())
            assertThrows(IllegalArgumentException::class.java) { runBlocking { signer.getPublicKey() } }
            settings.authMode = NostrAuthMode.None
            settings.nsec = "00".repeat(31) + "01"
            assertFalse(signer.isConfigured())
        } finally {
            settings.authMode = oldMode
            settings.nsec = oldNsec
            settings.pubkeyHex = oldPubkey
        }
    }

    @Test
    fun factorySelectsOnlyConfiguredSignerForEachMode() {
        val settings = SettingsRepository(context)
        val oldMode = settings.authMode
        val oldNsec = settings.nsec
        val oldPubkey = settings.pubkeyHex
        val oldPackage = settings.signerPackage
        try {
            settings.authMode = NostrAuthMode.None
            settings.nsec = "00".repeat(31) + "01"
            assertNull(NostrSignerFactory.create(context, settings))

            settings.authMode = NostrAuthMode.Nsec
            settings.nsec = null
            assertNull(NostrSignerFactory.create(context, settings))
            settings.nsec = "   "
            assertNull(NostrSignerFactory.create(context, settings))
            settings.nsec = "00".repeat(31) + "01"
            assertTrue(NostrSignerFactory.create(context, settings) is LocalNsecSigner)

            settings.authMode = NostrAuthMode.Amber
            settings.pubkeyHex = null
            settings.signerPackage = "com.example.amber"
            assertNull(NostrSignerFactory.create(context, settings))
            settings.pubkeyHex = "aa"
            settings.signerPackage = null
            assertNull(NostrSignerFactory.create(context, settings))
            settings.signerPackage = "   "
            assertNull(NostrSignerFactory.create(context, settings))
            settings.signerPackage = "com.example.amber"
            assertTrue(NostrSignerFactory.create(context, settings) is ExternalSigner)
        } finally {
            settings.authMode = oldMode
            settings.nsec = oldNsec
            settings.pubkeyHex = oldPubkey
            settings.signerPackage = oldPackage
        }
    }

    @Test
    fun externalSignerConfigurationAndPublicKeyReflectConnectionState() = runBlocking<Unit> {
        val settings = SettingsRepository(context)
        val oldMode = settings.authMode
        val oldPubkey = settings.pubkeyHex
        val oldPackage = settings.signerPackage
        try {
            val signer = ExternalSigner(context, settings)
            settings.authMode = NostrAuthMode.Amber
            settings.pubkeyHex = null
            settings.signerPackage = null
            assertThrows(IllegalStateException::class.java) { runBlocking { signer.getPublicKey() } }

            settings.pubkeyHex = "aa".repeat(32)
            settings.signerPackage = "com.example.amber"
            assertTrue(signer.isConfigured())
            assertEquals(settings.pubkeyHex, signer.getPublicKey())

            settings.pubkeyHex = "   "
            assertFalse(signer.isConfigured())
            settings.pubkeyHex = "aa"
            settings.signerPackage = "   "
            assertFalse(signer.isConfigured())
            settings.signerPackage = "com.example.amber"
            settings.authMode = NostrAuthMode.None
            assertFalse(signer.isConfigured())

            settings.pubkeyHex = null
            assertThrows(IllegalStateException::class.java) { runBlocking { signer.getPublicKey() } }
        } finally {
            settings.authMode = oldMode
            settings.pubkeyHex = oldPubkey
            settings.signerPackage = oldPackage
        }
    }

    @Test
    fun externalSignerNip44RequiresPackageAndConnectedIdentity() = runBlocking<Unit> {
        val settings = SettingsRepository(context)
        val oldMode = settings.authMode
        val oldPubkey = settings.pubkeyHex
        val oldPackage = settings.signerPackage
        try {
            settings.authMode = NostrAuthMode.Amber
            settings.pubkeyHex = null
            settings.signerPackage = null
            val signer = ExternalSigner(context, settings)
            assertThrows(Nip55Exception::class.java) {
                runBlocking { signer.nip44Encrypt("plain", "peer") }
            }
            assertThrows(Nip55Exception::class.java) {
                runBlocking { signer.nip44Decrypt("cipher", "peer") }
            }

            settings.signerPackage = "com.example.amber"
            assertThrows(IllegalStateException::class.java) {
                runBlocking { signer.nip44Encrypt("plain", "peer") }
            }
            assertThrows(IllegalStateException::class.java) {
                runBlocking { signer.nip44Decrypt("cipher", "peer") }
            }
        } finally {
            settings.authMode = oldMode
            settings.pubkeyHex = oldPubkey
            settings.signerPackage = oldPackage
        }
    }
}
