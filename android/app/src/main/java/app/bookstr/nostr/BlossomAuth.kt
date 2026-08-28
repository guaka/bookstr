package app.bookstr.nostr

import app.bookstr.shared.generated.NostrConstantsV1
import org.json.JSONArray
import org.json.JSONObject
import java.util.Base64

object BlossomAuth {
    const val KIND = NostrConstantsV1.BLOSSOM_AUTHORIZATION_KIND

    fun unsignedGetEvent(
        hash: String,
        server: String,
        nowSeconds: Long,
        content: String = "Download a LibVault book",
    ): JSONObject {
        require(hash.matches(Regex("^[a-fA-F0-9]{64}$"))) { "Invalid Blossom SHA-256" }
        require(server.isNotBlank() && !server.contains("/")) { "Invalid Blossom server name" }
        return JSONObject()
            .put("kind", KIND)
            .put("created_at", nowSeconds)
            .put(
                "tags",
                JSONArray()
                    .put(JSONArray().put("t").put("get"))
                    .put(JSONArray().put("expiration").put((nowSeconds + 120).toString()))
                    .put(JSONArray().put("server").put(server))
                    .put(JSONArray().put("x").put(hash.lowercase())),
            )
            .put("content", content)
    }

    suspend fun authorization(
        signer: NostrSigner,
        hash: String,
        server: String,
        nowSeconds: Long = System.currentTimeMillis() / 1000,
    ): String {
        val event = signer.signEvent(unsignedGetEvent(hash, server, nowSeconds))
        val encoded = Base64.getEncoder().withoutPadding()
            .encodeToString(event.toString().toByteArray(Charsets.UTF_8))
        return "Nostr $encoded"
    }
}
