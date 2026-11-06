package app.bookstr.nostr

import android.app.Activity
import android.app.Application
import android.content.ContentProvider
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.content.pm.ProviderInfo
import android.database.Cursor
import android.database.MatrixCursor
import android.net.Uri
import android.os.Looper
import androidx.activity.ComponentActivity
import app.bookstr.data.NostrAuthMode
import app.bookstr.data.SettingsRepository
import app.bookstr.data.ShadowEncryptedSharedPreferences
import app.bookstr.data.ShadowMasterKeyBuilder
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowContentResolver

@RunWith(RobolectricTestRunner::class)
@Config(
    application = Application::class,
    sdk = [28],
    instrumentedPackages = ["androidx.security.crypto"],
    shadows = [ShadowMasterKeyBuilder::class, ShadowEncryptedSharedPreferences::class],
)
class ExternalSignerCoverageTest {
    private val context: Context get() = RuntimeEnvironment.getApplication()
    private val secret = ByteArray(32).also { it[31] = 1 }
    private val pubkey get() = NostrCrypto.publicKeyHex(secret)
    private val signerPackage = "fixture.external.signer"

    @After
    fun clearSession() {
        AmberIntentSession.Host.session = null
    }

    @Test
    fun signsThroughProviderAndRejectsMismatchedOrInvalidSignedEvents() = runBlocking<Unit> {
        val settings = SettingsRepository(context)
        val previous = snapshot(settings)
        val provider = installProvider()
        try {
            settings.connectAmber(pubkey, signerPackage)
            val signer = ExternalSigner(context, settings)
            val unsigned = unsignedEvent()
            provider.respond = { uri, projection ->
                assertEquals("$signerPackage.SIGN_EVENT", uri.authority)
                val providerEvent = NostrCrypto.signEvent(secret, JSONObject(requireNotNull(projection)[0]))
                cursor(Nip55.RESULT_EVENT to providerEvent.toString())
            }

            val signed = signer.signEvent(unsigned)
            assertTrue(NostrCrypto.verifyEvent(signed))
            assertEquals(pubkey, signed.getString("pubkey"))

            provider.respond = { _, projection ->
                val altered = NostrCrypto.signEvent(secret, JSONObject(requireNotNull(projection)[0]))
                    .put("content", "altered after signing")
                cursor(Nip55.RESULT_EVENT to altered.toString())
            }
            assertThrows(IllegalArgumentException::class.java) {
                runBlocking { signer.signEvent(unsignedEvent()) }
            }

            provider.respond = { _, projection ->
                val differentEvent = JSONObject(requireNotNull(projection)[0]).put("content", "different")
                val signedDifferent = NostrCrypto.signEvent(secret, differentEvent)
                cursor(Nip55.RESULT_EVENT to signedDifferent.toString())
            }
            assertThrows(IllegalArgumentException::class.java) {
                runBlocking { signer.signEvent(unsignedEvent()) }
            }
        } finally {
            restore(settings, previous)
        }
    }

    @Test
    fun nip44EncryptionAndDecryptionUseProviderResults() = runBlocking<Unit> {
        val settings = SettingsRepository(context)
        val previous = snapshot(settings)
        val provider = installProvider()
        try {
            settings.connectAmber(pubkey, signerPackage)
            val signer = ExternalSigner(context, settings)
            provider.respond = { uri, projection ->
                assertEquals("$signerPackage.NIP44_ENCRYPT", uri.authority)
                assertEquals(listOf("plain text", "peer-key", pubkey), projection?.toList())
                cursor(Nip55.RESULT to "ciphertext")
            }
            assertEquals("ciphertext", signer.nip44Encrypt("plain text", "peer-key"))

            provider.respond = { uri, projection ->
                assertEquals("$signerPackage.NIP44_DECRYPT", uri.authority)
                assertEquals(listOf("ciphertext", "peer-key", pubkey), projection?.toList())
                cursor(Nip55.RESULT to "decrypted text")
            }
            assertEquals("decrypted text", signer.nip44Decrypt("ciphertext", "peer-key"))
        } finally {
            restore(settings, previous)
        }
    }

    @Test
    fun signEventFallsBackToAttachedIntentSessionWhenProviderHasNoPermission() = runBlocking<Unit> {
        val settings = SettingsRepository(context)
        val previous = snapshot(settings)
        val provider = installProvider()
        val controller = Robolectric.buildActivity(ComponentActivity::class.java).create()
        val activity = controller.get()
        val session = AmberIntentSession(activity)
        try {
            settings.connectAmber(pubkey, signerPackage)
            provider.respond = { _, _ -> null }
            controller.start().resume()
            session.attach()

            val unsigned = unsignedEvent()
            val expected = NostrCrypto.prepareUnsignedEvent(pubkey, JSONObject(unsigned.toString()))
            val responseEvent = NostrCrypto.signEvent(secret, JSONObject(expected.toString()))
            val result = async(start = CoroutineStart.UNDISPATCHED) {
                ExternalSigner(context, settings).signEvent(unsigned)
            }
            shadowOf(Looper.getMainLooper()).idle()
            val request = shadowOf(activity).nextStartedActivityForResult
            assertTrue(request.intent.getStringExtra(Nip55.EXTRA_TYPE) == Nip55.TYPE_SIGN_EVENT)
            activity.activityResultRegistry.dispatchResult(
                request.requestCode,
                Activity.RESULT_OK,
                Intent().putExtra(Nip55.RESULT_EVENT, responseEvent.toString()),
            )
            shadowOf(Looper.getMainLooper()).idle()

            assertEquals(expected.getString("id"), withTimeout(5_000) { result.await() }.getString("id"))
        } finally {
            session.detach()
            controller.pause().stop().destroy()
            restore(settings, previous)
        }
    }

    @Test
    fun nip44OperationsFallBackToAttachedIntentSession() = runBlocking<Unit> {
        val settings = SettingsRepository(context)
        val previous = snapshot(settings)
        val provider = installProvider()
        val controller = Robolectric.buildActivity(ComponentActivity::class.java).create()
        val activity = controller.get()
        val session = AmberIntentSession(activity)
        try {
            settings.connectAmber(pubkey, signerPackage)
            provider.respond = { _, _ -> null }
            controller.start().resume()
            session.attach()
            val signer = ExternalSigner(context, settings)

            val encrypted = async(start = CoroutineStart.UNDISPATCHED) {
                signer.nip44Encrypt("plain text", "peer-key")
            }
            shadowOf(Looper.getMainLooper()).idle()
            val encryptRequest = shadowOf(activity).nextStartedActivityForResult
            assertEquals(Nip55.TYPE_NIP44_ENCRYPT, encryptRequest.intent.getStringExtra(Nip55.EXTRA_TYPE))
            activity.activityResultRegistry.dispatchResult(
                encryptRequest.requestCode,
                Activity.RESULT_OK,
                Intent().putExtra(Nip55.RESULT, "ciphertext"),
            )
            shadowOf(Looper.getMainLooper()).idle()
            assertEquals("ciphertext", withTimeout(5_000) { encrypted.await() })

            val decrypted = async(start = CoroutineStart.UNDISPATCHED) {
                signer.nip44Decrypt("ciphertext", "peer-key")
            }
            shadowOf(Looper.getMainLooper()).idle()
            val decryptRequest = shadowOf(activity).nextStartedActivityForResult
            assertEquals(Nip55.TYPE_NIP44_DECRYPT, decryptRequest.intent.getStringExtra(Nip55.EXTRA_TYPE))
            activity.activityResultRegistry.dispatchResult(
                decryptRequest.requestCode,
                Activity.RESULT_OK,
                Intent().putExtra(Nip55.RESULT, "plain text"),
            )
            shadowOf(Looper.getMainLooper()).idle()
            assertEquals("plain text", withTimeout(5_000) { decrypted.await() })
        } finally {
            session.detach()
            controller.pause().stop().destroy()
            restore(settings, previous)
        }
    }

    @Test
    fun connectViaIntentRequiresSessionAndPersistsReturnedIdentity() = runBlocking<Unit> {
        val settings = SettingsRepository(context)
        val previous = snapshot(settings)
        try {
            assertThrows(Nip55Exception::class.java) {
                runBlocking { ExternalSigner.connectViaIntent(settings) }
            }

            val controller = Robolectric.buildActivity(ComponentActivity::class.java).create()
            val activity = controller.get()
            val session = AmberIntentSession(activity)
            controller.start().resume()
            session.attach()
            try {
                val connected = async(start = CoroutineStart.UNDISPATCHED) {
                    ExternalSigner.connectViaIntent(settings)
                }
                val request = shadowOf(activity).nextStartedActivityForResult
                assertEquals(Nip55.TYPE_GET_PUBLIC_KEY, request.intent.getStringExtra(Nip55.EXTRA_TYPE))
                activity.activityResultRegistry.dispatchResult(
                    request.requestCode,
                    Activity.RESULT_OK,
                    Intent().putExtra(Nip55.RESULT, pubkey.uppercase()).putExtra(Nip55.RESULT_PACKAGE, signerPackage),
                )

                assertEquals(pubkey to signerPackage, connected.await())
                assertEquals(pubkey, settings.pubkeyHex)
                assertEquals(signerPackage, settings.signerPackage)
                assertEquals(NostrAuthMode.Amber, settings.authMode)
            } finally {
                session.detach()
                controller.pause().stop().destroy()
            }
        } finally {
            restore(settings, previous)
        }
    }

    private fun unsignedEvent() = JSONObject()
        .put("kind", 30078)
        .put("created_at", 1L)
        .put("tags", JSONArray())
        .put("content", "private catalog")

    private fun installProvider(): FixtureProvider {
        val provider = FixtureProvider()
        val authorities = listOf("SIGN_EVENT", "NIP44_ENCRYPT", "NIP44_DECRYPT")
            .map { "$signerPackage.$it" }
        provider.attachInfo(context, ProviderInfo().apply { authority = authorities.joinToString(";") })
        authorities.forEach { ShadowContentResolver.registerProviderInternal(it, provider) }
        return provider
    }

    private fun cursor(vararg result: Pair<String, String>) =
        MatrixCursor(result.map { it.first }.toTypedArray()).apply {
            addRow(result.map { it.second }.toTypedArray())
        }

    private fun snapshot(settings: SettingsRepository) =
        listOf(settings.authMode, settings.nsec, settings.pubkeyHex, settings.signerPackage)

    private fun restore(settings: SettingsRepository, values: List<Any?>) {
        settings.authMode = values[0] as NostrAuthMode
        settings.nsec = values[1] as String?
        settings.pubkeyHex = values[2] as String?
        settings.signerPackage = values[3] as String?
    }

    private class FixtureProvider : ContentProvider() {
        var respond: ((Uri, Array<out String>?) -> Cursor?)? = null

        override fun onCreate() = true
        override fun getType(uri: Uri): String? = null
        override fun insert(uri: Uri, values: ContentValues?): Uri? = null
        override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?): Int = 0
        override fun update(
            uri: Uri,
            values: ContentValues?,
            selection: String?,
            selectionArgs: Array<out String>?,
        ): Int = 0

        override fun query(
            uri: Uri,
            projection: Array<out String>?,
            selection: String?,
            selectionArgs: Array<out String>?,
            sortOrder: String?,
        ): Cursor? = respond?.invoke(uri, projection)
    }
}
