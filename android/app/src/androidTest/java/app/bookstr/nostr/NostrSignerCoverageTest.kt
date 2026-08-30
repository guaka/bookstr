package app.bookstr.nostr

import android.app.Activity
import android.content.Context
import android.content.Intent
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import app.bookstr.data.NostrAuthMode
import app.bookstr.data.SettingsRepository
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class NostrSignerCoverageTest {
    private lateinit var context: Context
    private lateinit var settings: SettingsRepository

    @Before
    fun setUp() {
        context = ApplicationProvider.getApplicationContext()
        clearStoredSettings()
        settings = SettingsRepository(context)
        AmberIntentSession.Host.session = null
    }

    @After
    fun tearDown() {
        AmberIntentSession.Host.session = null
        clearStoredSettings()
    }

    @Test
    fun nsecSignerRequiresNonBlankSecret() {
        settings.authMode = NostrAuthMode.Nsec
        settings.nsec = "   "

        val signer = NostrSignerFactory.create(context, settings)

        assertNull(signer)
    }

    @Test
    fun factoryIgnoresNsecIfModeIsNone() {
        settings.authMode = NostrAuthMode.None
        settings.nsec = "00".repeat(31) + "01"

        val signer = NostrSignerFactory.create(context, settings)

        assertNull(signer)
    }

    @Test
    fun localNsecSignerCachesDerivedPubkeyAndSignsEvent() = kotlinx.coroutines.runBlocking {
        settings.authMode = NostrAuthMode.Nsec
        settings.nsec = "00".repeat(31) + "01"

        val signer = NostrSignerFactory.create(context, settings) as? LocalNsecSigner
            ?: throw AssertionError("Expected LocalNsecSigner")

        val unsigned = JSONObject()
            .put("kind", 1)
            .put("created_at", 1L)
            .put("tags", JSONArray())
            .put("content", "hello")
        val pubkey = signer.getPublicKey()
        val signed = signer.signEvent(unsigned)

        assertEquals(pubkey, settings.pubkeyHex)
        assertEquals(pubkey, signed.getString("pubkey"))
        assertTrue(NostrCrypto.verifyEvent(signed))
    }

    @Test
    fun localNsecSignerRejectsInvalidSecret() {
        settings.authMode = NostrAuthMode.Nsec
        settings.nsec = "invalid"

        val signer = LocalNsecSigner(settings)
        assertThrows(IllegalArgumentException::class.java) {
            kotlinx.coroutines.runBlocking {
                signer.getPublicKey()
            }
        }
    }

    @Test
    fun localNsecSignerThrowsWhenSecretMissing() {
        settings.authMode = NostrAuthMode.Nsec
        settings.nsec = null
        val signer = LocalNsecSigner(settings)

        assertThrows(IllegalStateException::class.java) {
            kotlinx.coroutines.runBlocking {
                signer.getPublicKey()
            }
        }
    }

    @Test
    fun externalSignerRequiresBothPubkeyAndPackage() {
        settings.authMode = NostrAuthMode.Amber
        assertNull(NostrSignerFactory.create(context, settings))

        settings.pubkeyHex = "aa"
        assertNull(NostrSignerFactory.create(context, settings))

        settings.signerPackage = "com.example.amber"
        assertTrue(NostrSignerFactory.create(context, settings) is ExternalSigner)
    }

    @Test
    fun externalSignerConfigurationFlagDependsOnAuthAndCredentials() {
        settings.authMode = NostrAuthMode.Amber
        settings.pubkeyHex = "aa"
        settings.signerPackage = "com.example.amber"

        val signer = ExternalSigner(context, settings)
        assertTrue(signer.isConfigured())

        settings.pubkeyHex = "   "
        assertEquals(false, signer.isConfigured())
        settings.pubkeyHex = "aa"
        settings.signerPackage = "   "
        assertEquals(false, signer.isConfigured())
    }

    @Test
    fun externalSignerGetPublicKeyThrowsWhenCredentialsMissing() {
        settings.authMode = NostrAuthMode.Amber
        val signer = ExternalSigner(context, settings)

        assertThrows(IllegalStateException::class.java) {
            kotlinx.coroutines.runBlocking {
                signer.getPublicKey()
            }
        }
    }

    @Test
    fun externalSignerSignEventThrowsWhenCredentialsAreMissing() {
        settings.authMode = NostrAuthMode.Amber
        settings.signerPackage = "com.example.amber"

        val signer = ExternalSigner(context, settings)
        val unsigned = JSONObject()
            .put("kind", 30078)
            .put("created_at", 1L)
            .put("tags", JSONArray())
            .put("content", "pending")

        assertThrows(IllegalStateException::class.java) {
            kotlinx.coroutines.runBlocking {
                signer.signEvent(unsigned)
            }
        }
    }

    @Test
    fun externalSignerGetPublicKeyThrowsWhenPubkeyIsMissing() {
        settings.authMode = NostrAuthMode.Amber
        settings.signerPackage = "com.example.amber"

        val signer = ExternalSigner(context, settings)

        assertThrows(IllegalStateException::class.java) {
            kotlinx.coroutines.runBlocking {
                signer.getPublicKey()
            }
        }
    }

    @Test
    fun externalSignerSignEventRequiresInteractiveSessionWhenProviderIsUnavailable() {
        settings.authMode = NostrAuthMode.Amber
        settings.pubkeyHex = "aa".repeat(32)
        settings.signerPackage = "com.example.amber"

        val signer = ExternalSigner(context, settings)
        val unsigned = JSONObject()
            .put("kind", 30078)
            .put("created_at", 1L)
            .put("tags", JSONArray())
            .put("content", "pending")

        val error = assertThrows(Nip55Exception::class.java) {
            kotlinx.coroutines.runBlocking {
                signer.signEvent(unsigned)
            }
        }
        assertTrue(error.message?.contains("Amber needs approval") == true)
    }

    @Test
    fun connectViaIntentRequiresActiveSession() {
        settings.signerPackage = "com.example.amber"
        assertThrows(Nip55Exception::class.java) {
            kotlinx.coroutines.runBlocking {
                ExternalSigner.connectViaIntent(settings)
            }
        }
    }

    @Test
    fun parseGetPublicKeyResultRejectsUnsuccessfulAndRejectedResponses() {
        val rejected = Intent().apply { putExtra(Nip55.RESULT_REJECTED, true) }
        assertThrows(Nip55Exception::class.java) {
            Nip55.parseGetPublicKeyResult(Activity.RESULT_CANCELED, Intent())
        }
        assertThrows(Nip55Exception::class.java) {
            Nip55.parseGetPublicKeyResult(Activity.RESULT_OK, rejected)
        }
    }

    @Test
    fun parseGetPublicKeyResultRejectsWhenMissingPayload() {
        assertThrows(Nip55Exception::class.java) {
            Nip55.parseGetPublicKeyResult(Activity.RESULT_OK, Intent())
        }
    }

    @Test
    fun parseGetPublicKeyResultRejectsMalformedPublicKey() {
        val badPayload = Intent().apply {
            putExtra(Nip55.RESULT, "not-a-hex")
            putExtra(Nip55.RESULT_PACKAGE, "com.example.amber")
        }

        assertThrows(IllegalArgumentException::class.java) {
            Nip55.parseGetPublicKeyResult(Activity.RESULT_OK, badPayload)
        }
    }

    @Test
    fun parseGetPublicKeyResultRejectsBlankPublicKey() {
        val blankPayload = Intent().apply {
            putExtra(Nip55.RESULT, "   ")
            putExtra(Nip55.RESULT_PACKAGE, "com.example.amber")
        }

        assertThrows(IllegalArgumentException::class.java) {
            Nip55.parseGetPublicKeyResult(Activity.RESULT_OK, blankPayload)
        }
    }

    @Test
    fun parseGetPublicKeyResultAcceptsUppercaseHexAndReturnsNormalizedPackage() {
        val payload = Intent().apply {
            putExtra(Nip55.RESULT, "AA".repeat(32))
            putExtra(Nip55.RESULT_PACKAGE, "com.example.amber")
        }

        val (pubkey, pkg) = Nip55.parseGetPublicKeyResult(Activity.RESULT_OK, payload)
        assertEquals("aa".repeat(32), pubkey)
        assertEquals("com.example.amber", pkg)
    }

    @Test
    fun parseGetPublicKeyResultRejectsWhenPackageMissing() {
        val payload = Intent().apply {
            putExtra(Nip55.RESULT, "aa".repeat(32))
        }

        assertThrows(Nip55Exception::class.java) {
            Nip55.parseGetPublicKeyResult(Activity.RESULT_OK, payload)
        }
    }

    @Test
    fun parseSignEventResultValidatesAndRejectsMissingEvent() {
        assertThrows(Nip55Exception::class.java) {
            Nip55.parseSignEventResult(Activity.RESULT_OK, Intent())
        }
    }

    @Test
    fun parseSignEventResultRejectsWhenResultRejected() {
        val rejected = Intent().apply { putExtra(Nip55.RESULT_REJECTED, true) }
        assertThrows(Nip55Exception::class.java) {
            Nip55.parseSignEventResult(Activity.RESULT_OK, rejected)
        }
    }

    @Test
    fun parseSignEventResultThrowsForMalformedJson() {
        val malformed = Intent().apply { putExtra(Nip55.RESULT_EVENT, "{not-json") }
        assertThrows(org.json.JSONException::class.java) {
            Nip55.parseSignEventResult(Activity.RESULT_OK, malformed)
        }
    }

    @Test
    fun parseSignEventResultRejectsBlankEventPayload() {
        val blank = Intent().apply { putExtra(Nip55.RESULT_EVENT, "   ") }
        assertThrows(Nip55Exception::class.java) {
            Nip55.parseSignEventResult(Activity.RESULT_OK, blank)
        }
    }

    @Test
    fun parseNip44DecryptResultRejectsMalformedResponses() {
        assertThrows(Nip55Exception::class.java) {
            Nip55.parseNip44DecryptResult(Activity.RESULT_CANCELED, Intent())
        }
        val rejected = Intent().apply { putExtra(Nip55.RESULT_REJECTED, true) }
        assertThrows(Nip55Exception::class.java) {
            Nip55.parseNip44DecryptResult(Activity.RESULT_OK, rejected)
        }
    }

    @Test
    fun parseNip44DecryptResultRejectsBlankResultPayload() {
        val blank = Intent().apply { putExtra(Nip55.RESULT, "   ") }
        assertThrows(Nip55Exception::class.java) {
            Nip55.parseNip44DecryptResult(Activity.RESULT_OK, blank)
        }
    }

    @Test
    fun parseNip44EncryptResultRejectsMalformedResponses() {
        assertThrows(Nip55Exception::class.java) {
            Nip55.parseNip44EncryptResult(Activity.RESULT_CANCELED, Intent())
        }
        val rejected = Intent().apply { putExtra(Nip55.RESULT_REJECTED, true) }
        assertThrows(Nip55Exception::class.java) {
            Nip55.parseNip44EncryptResult(Activity.RESULT_OK, rejected)
        }
    }

    @Test
    fun parseNip44EncryptResultRejectsBlankResultPayload() {
        val blank = Intent().apply { putExtra(Nip55.RESULT, "   ") }
        assertThrows(Nip55Exception::class.java) {
            Nip55.parseNip44EncryptResult(Activity.RESULT_OK, blank)
        }
    }

    private fun clearStoredSettings() {
        context.getSharedPreferences("bookstr_settings", Context.MODE_PRIVATE)
            .edit()
            .clear()
            .apply()
        context.getSharedPreferences("bookstr_secure", Context.MODE_PRIVATE)
            .edit()
            .clear()
            .apply()
    }
}
