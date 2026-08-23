package app.bookstr.nostr

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.assertThrows
import org.junit.Test
import java.util.Base64

class BlossomAuthTest {
    @Test
    fun createsShortLivedHashAndServerScopedGetAuthorization() {
        val hash = "ab".repeat(32)
        val event = BlossomAuth.unsignedGetEvent(hash, "blossom.bfr.ee", 1_800_000_000)
        assertEquals(BlossomAuth.KIND, event.getInt("kind"))
        assertEquals(1_800_000_000, event.getLong("created_at"))
        assertEquals("Download a LibVault book", event.getString("content"))
        val tags = event.getJSONArray("tags")
        assertTrue((0 until tags.length()).any { tags.getJSONArray(it).toString() == "[\"t\",\"get\"]" })
        assertTrue((0 until tags.length()).any { tags.getJSONArray(it).toString() == "[\"expiration\",\"1800000120\"]" })
        assertTrue((0 until tags.length()).any { tags.getJSONArray(it).toString() == "[\"server\",\"blossom.bfr.ee\"]" })
        assertTrue((0 until tags.length()).any { tags.getJSONArray(it).toString() == "[\"x\",\"$hash\"]" })
    }

    @Test
    fun encodesSignedEventForAuthorizationHeader() = kotlinx.coroutines.runBlocking {
        val signer = object : NostrSigner {
            override fun isConfigured() = true
            override suspend fun getPublicKey() = "11".repeat(32)
            override suspend fun signEvent(unsigned: JSONObject): JSONObject =
                unsigned.put("pubkey", "11".repeat(32)).put("id", "22".repeat(32)).put("sig", "33".repeat(64))
        }
        val header = BlossomAuth.authorization(signer, "aa".repeat(32), "blossom.bfr.ee", 1_800_000_000)
        assertTrue(header.startsWith("Nostr "))
        val decoded = JSONObject(String(Base64.getDecoder().decode(header.removePrefix("Nostr "))))
        assertEquals(BlossomAuth.KIND, decoded.getInt("kind"))
        assertEquals("33".repeat(64), decoded.getString("sig"))
    }

    @Test
    fun normalizesUppercaseHashInAuthorizationEvent() {
        val event = BlossomAuth.unsignedGetEvent("AB".repeat(32), "blossom.bfr.ee", 10)
        val tags = event.getJSONArray("tags")
        val hashTag = (0 until tags.length())
            .map { tags.getJSONArray(it) }
            .single { it.getString(0) == "x" }

        assertEquals("ab".repeat(32), hashTag.getString(1))
    }

    @Test
    fun rejectsInvalidHashAndUnscopedServerNames() {
        assertThrows(IllegalArgumentException::class.java) {
            BlossomAuth.unsignedGetEvent("short", "blossom.bfr.ee", 10)
        }
        assertThrows(IllegalArgumentException::class.java) {
            BlossomAuth.unsignedGetEvent("aa".repeat(32), "", 10)
        }
        assertThrows(IllegalArgumentException::class.java) {
            BlossomAuth.unsignedGetEvent("aa".repeat(32), "blossom.bfr.ee/path", 10)
        }
    }

    @Test
    fun authorizationHeaderUsesUnpaddedBase64() = kotlinx.coroutines.runBlocking {
        val signer = object : NostrSigner {
            override fun isConfigured() = true
            override suspend fun getPublicKey() = "11".repeat(32)
            override suspend fun signEvent(unsigned: JSONObject) = unsigned.put("sig", "x")
        }

        val header = BlossomAuth.authorization(signer, "aa".repeat(32), "blossom.bfr.ee", 1)

        assertTrue(!header.contains('='))
        assertTrue(String(Base64.getDecoder().decode(header.removePrefix("Nostr "))).contains("\"sig\":\"x\""))
    }
}
