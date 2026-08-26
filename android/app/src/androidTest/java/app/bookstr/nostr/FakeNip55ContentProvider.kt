package app.bookstr.nostr

import android.content.ContentProvider
import android.content.ContentValues
import android.database.Cursor
import android.database.MatrixCursor
import android.net.Uri

class FakeNip55ContentProvider : ContentProvider() {
    enum class CursorKind {
        Event,
        Result,
        Signature,
        Rejected,
        NoRows,
        Null,
    }

    data class Response(val kind: CursorKind, val value: String? = null)

    companion object {
        const val signerPackage = "test.nostr.signer"

        @Volatile var throwOnProjection = false
        @Volatile var queryCalls = 0
        @Volatile var signEventResponse: Response = Response(
            CursorKind.Event,
            """{"id":"provider","kind":1,"created_at":0,"tags":[],"content":"ok"}""",
        )
        @Volatile var nip44DecryptResponse: Response = Response(CursorKind.Result, "plaintext")
        @Volatile var nip44EncryptResponse: Response = Response(CursorKind.Result, "ciphertext")

        fun reset() {
            throwOnProjection = false
            queryCalls = 0
            signEventResponse = Response(
                CursorKind.Event,
                """{"id":"provider","kind":1,"created_at":0,"tags":[],"content":"ok"}""",
            )
            nip44DecryptResponse = Response(CursorKind.Result, "plaintext")
            nip44EncryptResponse = Response(CursorKind.Result, "ciphertext")
        }
    }

    override fun onCreate(): Boolean = true

    override fun query(
        uri: Uri,
        projection: Array<out String>?,
        selection: String?,
        selectionArgs: Array<out String>?,
        sortOrder: String?,
    ): Cursor? {
        queryCalls += 1
        if (throwOnProjection && projection != null) {
            throw IllegalArgumentException("projection args unsupported")
        }

        val response = when (uri.authority) {
            "$signerPackage.SIGN_EVENT" -> signEventResponse
            "$signerPackage.NIP44_DECRYPT" -> nip44DecryptResponse
            "$signerPackage.NIP44_ENCRYPT" -> nip44EncryptResponse
            else -> null
        }

        return response?.let(::cursorFor)
    }

    private fun cursorFor(response: Response): Cursor? {
        return when (response.kind) {
            CursorKind.Event -> MatrixCursor(arrayOf(Nip55.RESULT_EVENT)).apply {
                addRow(arrayOf(response.value))
            }
            CursorKind.Result -> MatrixCursor(arrayOf(Nip55.RESULT)).apply {
                addRow(arrayOf(response.value))
            }
            CursorKind.Signature -> MatrixCursor(arrayOf(Nip55.RESULT_SIGNATURE)).apply {
                addRow(arrayOf(response.value))
            }
            CursorKind.Rejected -> MatrixCursor(arrayOf(Nip55.RESULT_REJECTED, Nip55.RESULT)).apply {
                addRow(arrayOf(true, response.value))
            }
            CursorKind.NoRows -> MatrixCursor(arrayOf(Nip55.RESULT))
            CursorKind.Null -> null
        }
    }

    override fun getType(uri: Uri): String? = null

    override fun insert(uri: Uri, values: ContentValues?): android.net.Uri? = null

    override fun delete(
        uri: Uri,
        selection: String?,
        selectionArgs: Array<out String>?,
    ): Int = 0

    override fun update(
        uri: Uri,
        values: ContentValues?,
        selection: String?,
        selectionArgs: Array<out String>?,
    ): Int = 0
}
