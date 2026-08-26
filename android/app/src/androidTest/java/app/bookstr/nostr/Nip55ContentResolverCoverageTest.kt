package app.bookstr.nostr

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class Nip55ContentResolverCoverageTest {
    private lateinit var context: Context

    @Before
    fun setUp() {
        context = ApplicationProvider.getApplicationContext()
        FakeNip55ContentProvider.reset()
    }

    @Test
    fun signEventViaContentResolverReturnsEventColumnPayload() = runBlocking {
        val source = """{"id":"local-id","kind":1,"created_at":1,"tags":[],"content":"local"}"""
        val providerEvent = """{"id":"provider-id","kind":1,"created_at":2,"tags":[],"content":"provider"}"""
        FakeNip55ContentProvider.signEventResponse = FakeNip55ContentProvider.Response(
            FakeNip55ContentProvider.CursorKind.Event,
            providerEvent,
        )

        val result = NIP55.signEventViaContentResolver(
            context,
            FakeNip55ContentProvider.signerPackage,
            source,
            "aabb",
        )

        assertNotNull(result)
        assertEquals("provider-id", result?.getString("id"))
        assertEquals(1, FakeNip55ContentProvider.queryCalls)
    }

    @Test
    fun signEventViaContentResolverFallbacksToSignatureColumn() = runBlocking {
        FakeNip55ContentProvider.throwOnProjection = true
        FakeNip55ContentProvider.signEventResponse = FakeNip55ContentProvider.Response(
            FakeNip55ContentProvider.CursorKind.Signature,
            "sig-value",
        )
        val source = """{"id":"local-id","kind":1,"created_at":1,"tags":[],"content":"local"}"""

        val result = NIP55.signEventViaContentResolver(
            context,
            FakeNip55ContentProvider.signerPackage,
            source,
            "aabb",
        )

        assertNotNull(result)
        assertEquals("local-id", result?.getString("id"))
        assertEquals("sig-value", result?.getString("sig"))
        assertEquals(2, FakeNip55ContentProvider.queryCalls)
    }

    @Test
    fun signEventViaContentResolverUsesResultColumnWhenEventNotProvided() = runBlocking {
        FakeNip55ContentProvider.signEventResponse = FakeNip55ContentProvider.Response(
            FakeNip55ContentProvider.CursorKind.Result,
            "result-signature",
        )
        val source = """{"id":"local-id","kind":1,"created_at":1,"tags":[],"content":"local"}"""

        val result = NIP55.signEventViaContentResolver(
            context,
            FakeNip55ContentProvider.signerPackage,
            source,
            "aabb",
        )

        assertNotNull(result)
        assertEquals("local-id", result?.getString("id"))
        assertEquals("result-signature", result?.getString("sig"))
        assertEquals(1, FakeNip55ContentProvider.queryCalls)
    }

    @Test
    fun signEventViaContentResolverReturnsNullWhenResultColumnIsBlank() = runBlocking {
        FakeNip55ContentProvider.signEventResponse = FakeNip55ContentProvider.Response(
            FakeNip55ContentProvider.CursorKind.Result,
            "   ",
        )
        val source = """{"id":"local-id","kind":1,"created_at":1,"tags":[],"content":"local"}"""

        val result = NIP55.signEventViaContentResolver(
            context,
            FakeNip55ContentProvider.signerPackage,
            source,
            "aabb",
        )

        assertNull(result)
    }

    @Test
    fun signEventViaContentResolverThrowsWhenEventColumnPayloadIsNotJson() = runBlocking {
        FakeNip55ContentProvider.signEventResponse = FakeNip55ContentProvider.Response(
            FakeNip55ContentProvider.CursorKind.Event,
            "{not-json",
        )
        val source = """{"id":"local-id","kind":1,"created_at":1,"tags":[],"content":"local"}"""

        assertThrows(org.json.JSONException::class.java) {
            NIP55.signEventViaContentResolver(
                context,
                FakeNip55ContentProvider.signerPackage,
                source,
                "aabb",
            )
        }
    }

    @Test
    fun signEventViaContentResolverReturnsNullWhenSignatureWithoutLocalEventId() = runBlocking {
        FakeNip55ContentProvider.signEventResponse = FakeNip55ContentProvider.Response(
            FakeNip55ContentProvider.CursorKind.Signature,
            "sig-value",
        )
        val source = """{"kind":1,"created_at":1,"tags":[],"content":"local"}"""

        val result = NIP55.signEventViaContentResolver(
            context,
            FakeNip55ContentProvider.signerPackage,
            source,
            "aabb",
        )

        assertNull(result)
    }

    @Test
    fun signEventViaContentResolverRejectsWhenProviderReturnsRejectedColumn() {
        FakeNip55ContentProvider.signEventResponse = FakeNip55ContentProvider.Response(
            FakeNip55ContentProvider.CursorKind.Rejected,
            "rejected",
        )
        val source = """{"id":"local-id","kind":1,"created_at":1,"tags":[],"content":"local"}"""

        assertThrows(Nip55Exception::class.java) {
            runBlocking {
                NIP55.signEventViaContentResolver(
                    context,
                    FakeNip55ContentProvider.signerPackage,
                    source,
                    "aabb",
                )
            }
        }
    }

    @Test
    fun signEventViaContentResolverReturnsNullWhenCursorIsEmpty() = runBlocking {
        FakeNip55ContentProvider.signEventResponse = FakeNip55ContentProvider.Response(
            FakeNip55ContentProvider.CursorKind.NoRows,
        )
        val source = """{"id":"local-id","kind":1,"created_at":1,"tags":[],"content":"local"}"""

        assertNull(
            NIP55.signEventViaContentResolver(
                context,
                FakeNip55ContentProvider.signerPackage,
                source,
                "aabb",
            )
        )
    }

    @Test
    fun signEventViaContentResolverReturnsNullWhenCursorIsNull() = runBlocking {
        FakeNip55ContentProvider.signEventResponse = FakeNip55ContentProvider.Response(
            FakeNip55ContentProvider.CursorKind.Null,
        )
        val source = """{"id":"local-id","kind":1,"created_at":1,"tags":[],"content":"local"}"""

        assertNull(
            NIP55.signEventViaContentResolver(
                context,
                FakeNip55ContentProvider.signerPackage,
                source,
                "aabb",
            )
        )
    }

    @Test
    fun nip44DecryptViaContentResolverReturnsResultString() = runBlocking {
        FakeNip55ContentProvider.nip44DecryptResponse = FakeNip55ContentProvider.Response(
            FakeNip55ContentProvider.CursorKind.Result,
            "decrypted-text",
        )

        val result = NIP55.decryptNip44ViaContentResolver(
            context,
            FakeNip55ContentProvider.signerPackage,
            "ciphertext",
            "other",
            "local",
        )

        assertEquals("decrypted-text", result)
    }

    @Test
    fun nip44DecryptViaContentResolverFallsBackToSelectionArgsWhenProjectionUnsupported() = runBlocking {
        FakeNip55ContentProvider.throwOnProjection = true
        FakeNip55ContentProvider.nip44DecryptResponse = FakeNip55ContentProvider.Response(
            FakeNip55ContentProvider.CursorKind.Result,
            "decrypted-text",
        )

        val result = NIP55.decryptNip44ViaContentResolver(
            context,
            FakeNip55ContentProvider.signerPackage,
            "ciphertext",
            "other",
            "local",
        )

        assertEquals("decrypted-text", result)
        assertEquals(2, FakeNip55ContentProvider.queryCalls)
    }

    @Test
    fun nip44DecryptViaContentResolverReturnsNullWhenResultColumnMissing() = runBlocking {
        FakeNip55ContentProvider.nip44DecryptResponse = FakeNip55ContentProvider.Response(
            FakeNip55ContentProvider.CursorKind.Event,
            "wrong-column",
        )

        val result = NIP55.decryptNip44ViaContentResolver(
            context,
            FakeNip55ContentProvider.signerPackage,
            "ciphertext",
            "other",
            "local",
        )

        assertNull(result)
    }

    @Test
    fun nip44DecryptViaContentResolverReturnsNullWhenResultColumnIsBlank() = runBlocking {
        FakeNip55ContentProvider.nip44DecryptResponse = FakeNip55ContentProvider.Response(
            FakeNip55ContentProvider.CursorKind.Result,
            "   ",
        )

        val result = NIP55.decryptNip44ViaContentResolver(
            context,
            FakeNip55ContentProvider.signerPackage,
            "ciphertext",
            "other",
            "local",
        )

        assertNull(result)
    }

    @Test
    fun nip44DecryptViaContentResolverRejectsWhenProviderReturnsRejectedColumn() {
        FakeNip55ContentProvider.nip44DecryptResponse = FakeNip55ContentProvider.Response(
            FakeNip55ContentProvider.CursorKind.Rejected,
            "rejected",
        )

        assertThrows(Nip55Exception::class.java) {
            runBlocking {
                NIP55.decryptNip44ViaContentResolver(
                    context,
                    FakeNip55ContentProvider.signerPackage,
                    "ciphertext",
                    "other",
                    "local",
                )
            }
        }
    }

    @Test
    fun nip44EncryptViaContentResolverFallbacksAfterProjectionFailure() = runBlocking {
        FakeNip55ContentProvider.throwOnProjection = true
        FakeNip55ContentProvider.nip44EncryptResponse = FakeNip55ContentProvider.Response(
            FakeNip55ContentProvider.CursorKind.Result,
            "encrypted-text",
        )

        val result = NIP55.encryptNip44ViaContentResolver(
            context,
            FakeNip55ContentProvider.signerPackage,
            "plaintext",
            "other",
            "local",
        )

        assertEquals("encrypted-text", result)
        assertEquals(2, FakeNip55ContentProvider.queryCalls)
    }

    @Test
    fun nip44EncryptViaContentResolverReturnsNullWhenResultColumnMissing() = runBlocking {
        FakeNip55ContentProvider.nip44EncryptResponse = FakeNip55ContentProvider.Response(
            FakeNip55ContentProvider.CursorKind.Event,
            "wrong-column",
        )

        val result = NIP55.encryptNip44ViaContentResolver(
            context,
            FakeNip55ContentProvider.signerPackage,
            "plaintext",
            "other",
            "local",
        )

        assertNull(result)
    }

    @Test
    fun nip44EncryptViaContentResolverReturnsNullWhenResultColumnIsBlank() = runBlocking {
        FakeNip55ContentProvider.nip44EncryptResponse = FakeNip55ContentProvider.Response(
            FakeNip55ContentProvider.CursorKind.Result,
            "",
        )

        val result = NIP55.encryptNip44ViaContentResolver(
            context,
            FakeNip55ContentProvider.signerPackage,
            "plaintext",
            "other",
            "local",
        )

        assertNull(result)
    }
}
