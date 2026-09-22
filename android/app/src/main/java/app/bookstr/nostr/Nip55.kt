package app.bookstr.nostr

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.database.Cursor
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
    const val TYPE_NIP44_DECRYPT = "nip44_decrypt"
    const val TYPE_NIP44_ENCRYPT = "nip44_encrypt"

    const val EXTRA_TYPE = "type"
    const val EXTRA_PERMISSIONS = "permissions"
    const val EXTRA_CURRENT_USER = "current_user"
    const val EXTRA_PUBKEY = "pubkey"
    const val EXTRA_ID = "id"

    const val RESULT = "result"
    const val RESULT_SIGNATURE = "signature"
    const val RESULT_PACKAGE = "package"
    const val RESULT_EVENT = "event"
    const val RESULT_REJECTED = "rejected"

    /** Library decryption plus progress signing, matching the shared web behavior. */
    val LIBRARY_PERMISSIONS: String =
        JSONArray()
            .put(JSONObject().put("type", TYPE_SIGN_EVENT).put("kind", NostrClient.KIND_PROGRESS))
            .put(JSONObject().put("type", TYPE_SIGN_EVENT).put("kind", NostrClient.KIND_FAVORITES))
            .put(JSONObject().put("type", TYPE_SIGN_EVENT).put("kind", 13))
            .put(JSONObject().put("type", TYPE_NIP44_DECRYPT))
            .put(JSONObject().put("type", TYPE_NIP44_ENCRYPT))
            .toString()

    fun signerLabel(context: Context, packageName: String?): String = packageName?.let {
        runCatching { context.packageManager.getApplicationLabel(context.packageManager.getApplicationInfo(it, 0)).toString() }.getOrDefault(it)
    } ?: "External signer"

    fun isSignerAvailable(context: Context): Boolean =
        context.packageManager
            .queryIntentActivities(discoveryIntent(), PackageManager.MATCH_DEFAULT_ONLY)
            .isNotEmpty()

    fun discoveryIntent(): Intent =
        Intent(Intent.ACTION_VIEW, Uri.parse("$SCHEME:"))

    fun getPublicKeyIntent(permissionsJson: String = LIBRARY_PERMISSIONS): Intent =
        Intent(Intent.ACTION_VIEW, Uri.parse("$SCHEME:")).apply {
            putExtra(EXTRA_TYPE, TYPE_GET_PUBLIC_KEY)
            putExtra(EXTRA_PERMISSIONS, permissionsJson)
            addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        }

    fun nip44DecryptIntent(
        ciphertext: String,
        otherPubkeyHex: String,
        currentUserHex: String,
        signerPackage: String,
    ): Intent =
        Intent(Intent.ACTION_VIEW, Uri.parse("$SCHEME:$ciphertext")).apply {
            `package` = signerPackage
            putExtra(EXTRA_TYPE, TYPE_NIP44_DECRYPT)
            putExtra(EXTRA_PUBKEY, otherPubkeyHex)
            putExtra(EXTRA_CURRENT_USER, currentUserHex)
            addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        }

    fun nip44EncryptIntent(
        plaintext: String,
        otherPubkeyHex: String,
        currentUserHex: String,
        signerPackage: String,
    ): Intent =
        Intent(Intent.ACTION_VIEW, Uri.parse("$SCHEME:$plaintext")).apply {
            `package` = signerPackage
            putExtra(EXTRA_TYPE, TYPE_NIP44_ENCRYPT)
            putExtra(EXTRA_PUBKEY, otherPubkeyHex)
            putExtra(EXTRA_CURRENT_USER, currentUserHex)
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

    fun parseSignEventResult(resultCode: Int, data: Intent?, unsigned: String? = null): JSONObject {
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
        val signature = data?.getStringExtra(RESULT) ?: data?.getStringExtra(RESULT_SIGNATURE)
        if (unsigned != null && signature != null && Regex("[0-9a-fA-F]{128}").matches(signature)) {
            return JSONObject(unsigned).put("sig", signature)
        }
        throw Nip55Exception("No signed event in signer response")
    }

    fun parseNip44DecryptResult(resultCode: Int, data: Intent?): String {
        if (resultCode != Activity.RESULT_OK) {
            throw Nip55Exception("Signer failed to decrypt")
        }
        if (data?.getBooleanExtra(RESULT_REJECTED, false) == true) {
            throw Nip55Exception("Decryption was rejected")
        }
        return data?.getStringExtra(RESULT)?.takeIf { it.isNotBlank() }
            ?: throw Nip55Exception("No plaintext in signer response")
    }

    fun parseNip44EncryptResult(resultCode: Int, data: Intent?): String {
        if (resultCode != Activity.RESULT_OK) throw Nip55Exception("Signer failed to encrypt")
        if (data?.getBooleanExtra(RESULT_REJECTED, false) == true) {
            throw Nip55Exception("Encryption was rejected")
        }
        return data?.getStringExtra(RESULT)?.takeIf { it.isNotBlank() }
            ?: throw Nip55Exception("No ciphertext in signer response")
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
        val cursor = querySigner(context, uri, arrayOf(eventJson, "", currentUserHex)) ?: return null

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

    fun decryptNip44ViaContentResolver(
        context: Context,
        signerPackage: String,
        ciphertext: String,
        otherPubkeyHex: String,
        currentUserHex: String,
    ): String? {
        val uri = Uri.parse("content://$signerPackage.NIP44_DECRYPT")
        val cursor =
            querySigner(
                context,
                uri,
                arrayOf(ciphertext, otherPubkeyHex, currentUserHex),
            ) ?: return null

        cursor.use {
            if (it.getColumnIndex(RESULT_REJECTED) > -1) {
                throw Nip55Exception("Decryption was rejected")
            }
            if (!it.moveToFirst()) return null
            val resultCol = it.getColumnIndex(RESULT)
            if (resultCol < 0) return null
            return it.getString(resultCol)?.takeIf(String::isNotBlank)
        }
    }

    fun encryptNip44ViaContentResolver(
        context: Context,
        signerPackage: String,
        plaintext: String,
        otherPubkeyHex: String,
        currentUserHex: String,
    ): String? {
        val uri = Uri.parse("content://$signerPackage.NIP44_ENCRYPT")
        val cursor = querySigner(
            context,
            uri,
            arrayOf(plaintext, otherPubkeyHex, currentUserHex),
        ) ?: return null
        cursor.use {
            if (it.getColumnIndex(RESULT_REJECTED) > -1) {
                throw Nip55Exception("Encryption was rejected")
            }
            if (!it.moveToFirst()) return null
            val resultCol = it.getColumnIndex(RESULT)
            if (resultCol < 0) return null
            return it.getString(resultCol)?.takeIf(String::isNotBlank)
        }
    }

    private fun querySigner(context: Context, uri: Uri, args: Array<String>): Cursor? {
        return try {
            // NIP-55's Android example passes payload parameters as projection values.
            context.contentResolver.query(uri, args, null, null, null)
        } catch (_: IllegalArgumentException) {
            try { context.contentResolver.query(uri, null, null, args, null) }
            catch (_: IllegalArgumentException) { null }
            catch (_: SecurityException) { null }
        } catch (_: SecurityException) {
            null
        }
    }
}

class Nip55Exception(message: String) : Exception(message)
