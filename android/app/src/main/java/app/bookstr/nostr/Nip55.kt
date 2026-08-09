package app.bookstr.nostr

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import app.bookstr.util.Bech32
import org.json.JSONArray
import org.json.JSONObject

/**
 * NIP-55 helpers for talking to on-device signers such as Amber.
 * Amber also implements NIP-46; on Android the native bridge is NIP-55 intents / content provider.
 */
object Nip55 {
    const val SCHEME = "nostrsigner"
    const val TYPE_GET_PUBLIC_KEY = "get_public_key"
    const val TYPE_SIGN_EVENT = "sign_event"

    const val EXTRA_TYPE = "type"
    const val EXTRA_PERMISSIONS = "permissions"
    const val EXTRA_CURRENT_USER = "current_user"
    const val EXTRA_ID = "id"

    const val RESULT = "result"
    const val RESULT_SIGNATURE = "signature"
    const val RESULT_PACKAGE = "package"
    const val RESULT_EVENT = "event"
    const val RESULT_REJECTED = "rejected"

    /** Progress events only — keep Amber prompts minimal. */
    val PROGRESS_PERMISSIONS: String =
        JSONArray()
            .put(JSONObject().put("type", TYPE_SIGN_EVENT).put("kind", NostrClient.KIND_PROGRESS))
            .toString()

    fun isSignerAvailable(context: Context): Boolean =
        context.packageManager
            .queryIntentActivities(discoveryIntent(), PackageManager.MATCH_DEFAULT_ONLY)
            .isNotEmpty()

    fun discoveryIntent(): Intent =
        Intent(Intent.ACTION_VIEW, Uri.parse("$SCHEME:"))

    fun getPublicKeyIntent(permissionsJson: String = PROGRESS_PERMISSIONS): Intent =
        Intent(Intent.ACTION_VIEW, Uri.parse("$SCHEME:")).apply {
            putExtra(EXTRA_TYPE, TYPE_GET_PUBLIC_KEY)
            putExtra(EXTRA_PERMISSIONS, permissionsJson)
            addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        }

    fun signEventIntent(
        eventJson: String,
        currentUserHex: String,
        signerPackage: String,
        id: String? = null,
    ): Intent =
        Intent(Intent.ACTION_VIEW, Uri.parse("$SCHEME:$eventJson")).apply {
            `package` = signerPackage
            putExtra(EXTRA_TYPE, TYPE_SIGN_EVENT)
            putExtra(EXTRA_CURRENT_USER, currentUserHex)
            if (id != null) putExtra(EXTRA_ID, id)
            addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        }

    fun normalizePubkey(raw: String): String {
        val trimmed = raw.trim()
        if (trimmed.startsWith("npub1", ignoreCase = true)) {
            val decoded = Bech32.decode("npub", trimmed)
            require(decoded.size == 32) { "Invalid npub length" }
            return decoded.joinToString("") { "%02x".format(it) }
        }
        require(trimmed.length == 64 && trimmed.all { it in "0123456789abcdefABCDEF" }) {
            "Pubkey must be npub1… or 64-char hex"
        }
        return trimmed.lowercase()
    }

    fun parseGetPublicKeyResult(resultCode: Int, data: Intent?): Pair<String, String> {
        if (resultCode != Activity.RESULT_OK) {
            throw Nip55Exception("Signer failed to return a public key")
        }
        if (data?.getBooleanExtra(RESULT_REJECTED, false) == true) {
            throw Nip55Exception("Signing request was rejected")
        }
        val raw =
            data?.getStringExtra(RESULT)
                ?: throw Nip55Exception("No public key in signer response")
        val pkg =
            data.getStringExtra(RESULT_PACKAGE)
                ?: throw Nip55Exception("No signer package in response")
        return normalizePubkey(raw) to pkg
    }

    fun parseSignEventResult(resultCode: Int, data: Intent?): JSONObject {
        if (resultCode != Activity.RESULT_OK) {
            throw Nip55Exception("Signer failed to sign event")
        }
        if (data?.getBooleanExtra(RESULT_REJECTED, false) == true) {
            throw Nip55Exception("Signing request was rejected")
        }
        val eventJson = data?.getStringExtra(RESULT_EVENT)
        if (!eventJson.isNullOrBlank()) {
            return JSONObject(eventJson)
        }
        throw Nip55Exception("No signed event in signer response")
    }

    /**
     * Background signing via content provider when Amber has remembered permission for kind 30078.
     * Returns null when the provider cannot answer (no remembered permission).
     */
    fun signEventViaContentResolver(
        context: Context,
        signerPackage: String,
        eventJson: String,
        currentUserHex: String,
    ): JSONObject? {
        val uri = Uri.parse("content://$signerPackage.SIGN_EVENT")
        // Amber/NIP-55: projection carries [payload, pubkey, current_user]
        val cursor =
            context.contentResolver.query(
                uri,
                arrayOf(eventJson, "", currentUserHex),
                null,
                null,
                null,
            ) ?: return null

        cursor.use {
            if (it.getColumnIndex(RESULT_REJECTED) > -1) {
                throw Nip55Exception("Signing request was rejected")
            }
            if (!it.moveToFirst()) return null
            val eventCol = it.getColumnIndex(RESULT_EVENT)
            if (eventCol >= 0) {
                val event = it.getString(eventCol)
                if (!event.isNullOrBlank()) return JSONObject(event)
            }
            val resultCol = it.getColumnIndex(RESULT)
            val signatureCol = it.getColumnIndex(RESULT_SIGNATURE)
            val sig =
                when {
                    resultCol >= 0 -> it.getString(resultCol)
                    signatureCol >= 0 -> it.getString(signatureCol)
                    else -> null
                }
            if (sig.isNullOrBlank()) return null
            val unsigned = JSONObject(eventJson)
            // Content provider sometimes returns signature only; rebuild signed event if needed.
            if (!unsigned.has("id") || unsigned.optString("id").isEmpty()) {
                return null
            }
            unsigned.put("sig", sig)
            return unsigned
        }
    }
}

class Nip55Exception(message: String) : Exception(message)
