package app.bookstr.nostr

import android.app.Application
import android.content.ContentProvider
import android.content.ContentValues
import android.content.Context
import android.content.pm.ProviderInfo
import android.database.Cursor
import android.database.MatrixCursor
import android.net.Uri
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowContentResolver

@RunWith(RobolectricTestRunner::class)
@Config(application = Application::class, sdk = [28])
class Nip55ContentResolverTest {
    private val context: Context get() = RuntimeEnvironment.getApplication()

    @Test
    fun signEventReadsSignedEventOrRebuildsFromProviderSignatureAndClosesCursor() {
        val provider = install("fixture.event")
        val signedEvent = """{"id":"signed-id","sig":"${"a".repeat(128)}"}"""
        val eventCursor = cursor(Nip55.RESULT_EVENT to signedEvent)
        provider.respond = { eventCursor }

        val parsed = Nip55.signEventViaContentResolver(context, "fixture.event", "{}", "user")

        assertEquals("signed-id", parsed?.getString("id"))
        assertTrue(eventCursor.isClosed)
        assertEquals(Uri.parse("content://fixture.event.SIGN_EVENT"), provider.uris.single())
        assertEquals(listOf("{}", "", "user"), provider.projections.single()?.toList())

        val signatureCursor = cursor(Nip55.RESULT to "b".repeat(128))
        provider.respond = { signatureCursor }
        val rebuilt = Nip55.signEventViaContentResolver(
            context,
            "fixture.event",
            """{"id":"request-id","kind":1}""",
            "user",
        )
        assertEquals("request-id", rebuilt?.getString("id"))
        assertEquals("b".repeat(128), rebuilt?.getString("sig"))
        assertTrue(signatureCursor.isClosed)

        val signatureColumnCursor = cursor(Nip55.RESULT_SIGNATURE to "c".repeat(128))
        provider.respond = { signatureColumnCursor }
        assertEquals(
            "c".repeat(128),
            Nip55.signEventViaContentResolver(
                context,
                "fixture.event",
                """{"id":"request-id"}""",
                "user",
            )?.getString("sig"),
        )
    }

    @Test
    fun signEventReturnsNullForUnavailableEmptyIncompleteOrIdlessResponsesAndThrowsOnRejection() {
        val provider = install("fixture.sign-edge")
        provider.respond = { null }
        assertNull(Nip55.signEventViaContentResolver(context, "fixture.sign-edge", "{}", "user"))

        provider.respond = { MatrixCursor(arrayOf(Nip55.RESULT_EVENT)) }
        assertNull(Nip55.signEventViaContentResolver(context, "fixture.sign-edge", "{}", "user"))

        provider.respond = { cursor("other" to "ignored") }
        assertNull(Nip55.signEventViaContentResolver(context, "fixture.sign-edge", "{}", "user"))

        provider.respond = { cursor(Nip55.RESULT to "d".repeat(128)) }
        assertNull(Nip55.signEventViaContentResolver(context, "fixture.sign-edge", "{}", "user"))

        provider.respond = { cursor(Nip55.RESULT_REJECTED to "") }
        assertThrows(Nip55Exception::class.java) {
            Nip55.signEventViaContentResolver(context, "fixture.sign-edge", "{}", "user")
        }
    }

    @Test
    fun encryptAndDecryptQueryProviderAndHandleResultAndEmptyRows() {
        val provider = install("fixture.crypto")
        val plain = cursor(Nip55.RESULT to "decrypted text")
        provider.respond = { plain }
        assertEquals("decrypted text", Nip55.decryptNip44ViaContentResolver(
            context, "fixture.crypto", "cipher", "other", "current",
        ))
        assertTrue(plain.isClosed)
        assertEquals(listOf("cipher", "other", "current"), provider.projections.last()?.toList())

        val ciphertext = cursor(Nip55.RESULT to "ciphertext")
        provider.respond = { ciphertext }
        assertEquals("ciphertext", Nip55.encryptNip44ViaContentResolver(
            context, "fixture.crypto", "plain", "other", "current",
        ))
        assertEquals(listOf("plain", "other", "current"), provider.projections.last()?.toList())

        provider.respond = { MatrixCursor(arrayOf(Nip55.RESULT)) }
        assertNull(Nip55.decryptNip44ViaContentResolver(context, "fixture.crypto", "c", "o", "u"))
        provider.respond = { cursor("other" to "ignored") }
        assertNull(Nip55.encryptNip44ViaContentResolver(context, "fixture.crypto", "p", "o", "u"))
        provider.respond = { cursor(Nip55.RESULT to "  ") }
        assertNull(Nip55.decryptNip44ViaContentResolver(context, "fixture.crypto", "c", "o", "u"))
    }

    @Test
    fun providerRejectionAndQueryFallbackAndSecurityFailuresAreHandled() {
        val provider = install("fixture.fallback")
        provider.query = { projection, selectionArgs ->
            if (projection != null) throw IllegalArgumentException("expects selection args")
            assertNull(projection)
            assertEquals(listOf("payload", "peer", "current"), selectionArgs?.toList())
            cursor(Nip55.RESULT to "plain")
        }
        assertEquals("plain", Nip55.decryptNip44ViaContentResolver(
            context, "fixture.fallback", "payload", "peer", "current",
        ))
        assertEquals(2, provider.projections.size)
        assertEquals(listOf("payload", "peer", "current"), provider.projections.first()?.toList())
        assertNull(provider.projections.last())
        assertEquals(listOf("payload", "peer", "current"), provider.selectionArgs.last()?.toList())

        provider.query = { _, _ -> throw SecurityException("no permission") }
        assertNull(Nip55.encryptNip44ViaContentResolver(context, "fixture.fallback", "p", "o", "u"))

        provider.query = { projection, _ ->
            if (projection != null) throw IllegalArgumentException("retry")
            throw SecurityException("no permission on fallback")
        }
        assertNull(Nip55.signEventViaContentResolver(context, "fixture.fallback", "{}", "u"))

        provider.query = { _, _ -> cursor(Nip55.RESULT_REJECTED to "") }
        assertThrows(Nip55Exception::class.java) {
            Nip55.encryptNip44ViaContentResolver(context, "fixture.fallback", "p", "o", "u")
        }
        provider.query = { _, _ -> cursor(Nip55.RESULT_REJECTED to "") }
        assertThrows(Nip55Exception::class.java) {
            Nip55.decryptNip44ViaContentResolver(context, "fixture.fallback", "c", "o", "u")
        }
    }

    @Test
    fun responseParsersAcceptLegacySignatureAndRejectMalformedOrEmptyPayloads() {
        val pkg = "fixture.signer"
        val key = "1a".repeat(32)
        assertEquals(
            key to pkg,
            Nip55.parseGetPublicKeyResult(
                android.app.Activity.RESULT_OK,
                android.content.Intent().putExtra(Nip55.RESULT, key.uppercase()).putExtra(Nip55.RESULT_PACKAGE, pkg),
            ),
        )
        assertThrows(Nip55Exception::class.java) {
            Nip55.parseGetPublicKeyResult(android.app.Activity.RESULT_OK, android.content.Intent().putExtra(Nip55.RESULT, key))
        }
        assertThrows(IllegalArgumentException::class.java) {
            Nip55.parseGetPublicKeyResult(
                android.app.Activity.RESULT_OK,
                android.content.Intent().putExtra(Nip55.RESULT, "bad-key").putExtra(Nip55.RESULT_PACKAGE, pkg),
            )
        }

        val unsigned = """{"id":"event-id"}"""
        assertEquals(
            "f".repeat(128),
            Nip55.parseSignEventResult(
                android.app.Activity.RESULT_OK,
                android.content.Intent().putExtra(Nip55.RESULT_SIGNATURE, "f".repeat(128)),
                unsigned,
            ).getString("sig"),
        )
        assertThrows(Nip55Exception::class.java) {
            Nip55.parseSignEventResult(
                android.app.Activity.RESULT_OK,
                android.content.Intent().putExtra(Nip55.RESULT, "short"),
                unsigned,
            )
        }
        assertThrows(org.json.JSONException::class.java) {
            Nip55.parseSignEventResult(
                android.app.Activity.RESULT_OK,
                android.content.Intent().putExtra(Nip55.RESULT_EVENT, "not-json"),
            )
        }

        assertThrows(Nip55Exception::class.java) {
            Nip55.parseNip44DecryptResult(android.app.Activity.RESULT_OK, android.content.Intent().putExtra(Nip55.RESULT, " "))
        }
        assertThrows(Nip55Exception::class.java) {
            Nip55.parseNip44EncryptResult(android.app.Activity.RESULT_OK, android.content.Intent())
        }
    }

    private fun install(authority: String): RecordingProvider {
        val provider = RecordingProvider()
        val authorities = listOf("SIGN_EVENT", "NIP44_DECRYPT", "NIP44_ENCRYPT")
            .map { "$authority.$it" }
        val info = ProviderInfo().apply { this.authority = authorities.joinToString(";") }
        provider.attachInfo(context, info)
        authorities.forEach { ShadowContentResolver.registerProviderInternal(it, provider) }
        return provider
    }

    private fun cursor(vararg values: Pair<String, String>): MatrixCursor =
        MatrixCursor(values.map { it.first }.toTypedArray()).apply {
            addRow(values.map { it.second }.toTypedArray())
        }

    private class RecordingProvider : ContentProvider() {
        val uris = mutableListOf<Uri>()
        val projections = mutableListOf<Array<out String>?>()
        val selectionArgs = mutableListOf<Array<out String>?>()
        var respond: (() -> Cursor?)? = null
        var query: ((Array<out String>?, Array<out String>?) -> Cursor?)? = null

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
        ): Cursor? {
            uris += uri
            projections += projection
            this.selectionArgs += selectionArgs
            return query?.invoke(projection, selectionArgs) ?: respond?.invoke()
        }
    }
}
