package app.bookstr.nostr

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class Nip55Test {
    @Test
    fun normalizeHexPubkey() {
        val hex = "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d"
        assertEquals(hex, Nip55.normalizePubkey(hex.uppercase()))
    }

    @Test
    fun normalizeNpubPubkey() {
        val npub = "npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6"
        val hex = Nip55.normalizePubkey(npub)
        assertEquals("3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d", hex)
    }

    @Test
    fun progressPermissionsIncludeKind30078() {
        assertTrue(Nip55.PROGRESS_PERMISSIONS.contains("30078"))
        assertTrue(Nip55.PROGRESS_PERMISSIONS.contains("sign_event"))
    }

    @Test
    fun prepareUnsignedEventSetsIdAndPubkey() {
        val pubkey = "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d"
        val event = JSONObject()
            .put("kind", 30078)
            .put("created_at", 1_700_000_000L)
            .put("tags", JSONArray().put(JSONArray().put("d").put("app.bookstr.progress.test")))
            .put("content", """{"v":1}""")
        val prepared = NostrCrypto.prepareUnsignedEvent(pubkey, event)
        assertEquals(pubkey, prepared.getString("pubkey"))
        assertEquals(64, prepared.getString("id").length)
        assertTrue(!prepared.has("sig") || prepared.optString("sig").isEmpty())
    }
}
