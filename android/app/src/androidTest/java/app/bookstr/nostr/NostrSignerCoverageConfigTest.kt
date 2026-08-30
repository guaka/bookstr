package app.bookstr.nostr

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import app.bookstr.E2eScreenshotRule
import app.bookstr.data.NostrAuthMode
import app.bookstr.data.SettingsRepository
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class NostrSignerCoverageConfigTest {
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

    @Test
    fun localNsecSignerIsConfiguredOnlyWhenAuthModeIsNsecAndNsecIsNotBlank() {
        settings.authMode = NostrAuthMode.Amber
        settings.nsec = "00".repeat(32)

        val amberModeSigner = LocalNsecSigner(settings)
        assertFalse(amberModeSigner.isConfigured())

        settings.authMode = NostrAuthMode.Nsec
        settings.nsec = "   "
        assertFalse(amberModeSigner.isConfigured())

        settings.nsec = "00".repeat(32)
        assertTrue(amberModeSigner.isConfigured())
    }

    @Test
    fun localNsecSignerFactoryRequiresConfiguredSignerForNsecMode() {
        settings.authMode = NostrAuthMode.Nsec
        settings.nsec = "   "
        assertNull(NostrSignerFactory.create(context, settings))

        settings.nsec = "00".repeat(32)
        val signer = NostrSignerFactory.create(context, settings)
        assertTrue(signer is LocalNsecSigner)
        assertEquals(NostrAuthMode.Nsec, settings.authMode)
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
