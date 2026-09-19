package app.bookstr.nostr

import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class PrivateCatalogTest {
    private fun signer(value: Int) = EphemeralSigner(ByteArray(32).also { it[31] = value.toByte() })
    @Test fun exchangesAuthenticatedCatalogEnvelopesAndRejectsWrongCorrelation() = runBlocking {
        val user = signer(1); val server = signer(2)
        val service = CatalogService(server.getPublicKey())
        val destination = CatalogService(user.getPublicKey())
        val response = JSONObject().put("type", "libcat.search.result").put("request_id", "request").put("books", JSONArray())
        val wrapped = PrivateCatalogWire.wrap(response, destination, server, 1000, signer(3))
        assertEquals("libcat.search.result", PrivateCatalogWire.unwrap(wrapped, service, user, "request", "libcat.search")?.getString("type"))
        assertNull(PrivateCatalogWire.unwrap(wrapped, service, user, "different", "libcat.search"))
        assertNull(PrivateCatalogWire.unwrap(wrapped, service, user, "request", "libcat.resolve"))
        assertNull(PrivateCatalogWire.unwrap(wrapped, CatalogService(signer(4).getPublicKey()), user, "request", "libcat.search"))
        assertNull(PrivateCatalogWire.unwrap(wrapped, service, signer(4), "request", "libcat.search"))
        assertNull(PrivateCatalogWire.unwrap(JSONObject(wrapped.toString()).put("kind", 14), service, user, "request", "libcat.search"))
        assertNull(PrivateCatalogWire.unwrap(JSONObject(wrapped.toString()).put("content", "tampered"), service, user, "request", "libcat.search"))
        assertTrue(user.isConfigured())
    }
    @Test fun rejectsTamperedInnerSealsAndRumors() = runBlocking {
        val user = signer(1); val server = signer(2); val outer = signer(3)
        val service = CatalogService(server.getPublicKey())
        fun event(kind: Int, content: String, pubkey: String) = JSONObject().put("pubkey", pubkey).put("created_at", 1000).put("kind", kind)
            .put("content", content).put("tags", JSONArray().put(JSONArray().put("p").put(runBlocking { user.getPublicKey() })))
        val rumor = event(14, JSONObject().put("type", "libcat.search.result").put("request_id", "r").toString(), server.getPublicKey())
        rumor.put("id", NostrCrypto.eventId(rumor))
        suspend fun envelope(r: JSONObject, mutateSeal: Boolean = false): JSONObject {
            val seal = server.signEvent(event(13, server.nip44Encrypt(r.toString(), user.getPublicKey()), server.getPublicKey()))
            if (mutateSeal) seal.put("sig", "0".repeat(128))
            return outer.signEvent(event(1059, outer.nip44Encrypt(seal.toString(), user.getPublicKey()), outer.getPublicKey()))
        }
        assertNull(PrivateCatalogWire.unwrap(envelope(rumor, true), service, user, "r", "libcat.search"))
        for (bad in listOf(JSONObject(rumor.toString()).put("id", "bad"), JSONObject(rumor.toString()).put("sig", "bad"),
            JSONObject(rumor.toString()).put("kind", 1), JSONObject(rumor.toString()).put("pubkey", user.getPublicKey()),
            JSONObject(rumor.toString()).put("tags", JSONArray()))) {
            assertNull(PrivateCatalogWire.unwrap(envelope(bad), service, user, "r", "libcat.search"))
        }
    }
}
