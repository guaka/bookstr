package app.bookstr.nostr

import android.app.Activity
import android.content.Context
import android.content.Intent
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import app.bookstr.E2eScreenshotRule
import app.bookstr.data.NostrAuthMode
import app.bookstr.data.SettingsRepository
import org.junit.After
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class Nip55ParseAndFactoryCoverageTest {
    @get:org.junit.Rule
    val screenshots = E2eScreenshotRule()

    private lateinit var context: Context
    private lateinit var settings: SettingsRepository

    @Before
    fun setUp() {
        context = ApplicationProvider.getApplicationContext()
        clearStoredSettings()
        settings = SettingsRepository(context)
    }

    @After
    fun tearDown() {
        clearStoredSettings()
    }

    @Test
    fun parseSignEventResultRejectsWhenPayloadIsMissingOrBlank() {
        assertThrows(Nip55Exception::class.java) {
            Nip55.parseSignEventResult(Activity.RESULT_OK, Intent())
        }
        assertThrows(Nip55Exception::class.java) {
            Nip55.parseSignEventResult(
                Activity.RESULT_OK,
                Intent().apply {
                    putExtra(Nip55.RESULT_EVENT, "  ")
                },
            )
        }
    }

    @Test
    fun parseNip44DecryptResultRejectsRejectedOrFailedResultCode() {
        val rejected = Intent().apply { putExtra(Nip55.RESULT_REJECTED, true) }
        assertThrows(Nip55Exception::class.java) {
            Nip55.parseNip44DecryptResult(Activity.RESULT_OK, rejected)
        }
        assertThrows(Nip55Exception::class.java) {
            Nip55.parseNip44DecryptResult(Activity.RESULT_CANCELED, Intent())
        }
    }

    @Test
    fun parseNip44EncryptResultRejectsWhenPayloadIsMissing() {
        assertThrows(Nip55Exception::class.java) {
            Nip55.parseNip44EncryptResult(Activity.RESULT_OK, Intent())
        }
        assertThrows(Nip55Exception::class.java) {
            Nip55.parseNip44EncryptResult(
                Activity.RESULT_OK,
                Intent().apply {
                    putExtra(Nip55.RESULT_REJECTED, true)
                },
            )
        }
    }

    @Test
    fun signerFactoryReturnsNullForAmberWithoutBothCredentials() {
        settings.authMode = NostrAuthMode.Amber
        settings.pubkeyHex = null
        settings.signerPackage = null
        assertNull(NostrSignerFactory.create(context, settings))

        settings.pubkeyHex = "a".repeat(16)
        assertNull(NostrSignerFactory.create(context, settings))

        settings.signerPackage = "com.example.amber"
        settings.pubkeyHex = "   "
        assertNull(NostrSignerFactory.create(context, settings))
    }

    @Test
    fun signerFactoryIgnoresNsecWhenModeIsNone() {
        settings.authMode = NostrAuthMode.None
        settings.nsec = "00".repeat(32)
        settings.pubkeyHex = "a".repeat(64)

        val signer = NostrSignerFactory.create(context, settings)
        assertNull(signer)

        settings.authMode = NostrAuthMode.Nsec
        assertTrue(NostrSignerFactory.create(context, settings) is LocalNsecSigner)
        settings.authMode = NostrAuthMode.None
        assertNull(NostrSignerFactory.create(context, settings))
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
