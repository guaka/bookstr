package app.bookstr.nostr;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;

public final class FakeNip55ContentProvider extends ContentProvider {
    public enum CursorKind {
        Event,
        Result,
        Signature,
        Rejected,
        NoRows,
        Null,
    }

    public static final class Response {
        final CursorKind kind;
        final String value;

        public Response(CursorKind kind) {
            this(kind, null);
        }

        public Response(CursorKind kind, String value) {
            this.kind = kind;
            this.value = value;
        }
    }

    public static final String signerPackage = "test.nostr.signer";

    public static volatile boolean throwOnProjection = false;
    public static volatile int queryCalls = 0;
    public static volatile Response signEventResponse = new Response(
        CursorKind.Event,
        "{\"id\":\"provider\",\"kind\":1,\"created_at\":0,\"tags\":[],\"content\":\"ok\"}"
    );
    public static volatile Response nip44DecryptResponse =
        new Response(CursorKind.Result, "plaintext");
    public static volatile Response nip44EncryptResponse =
        new Response(CursorKind.Result, "ciphertext");

    public static void reset() {
        throwOnProjection = false;
        queryCalls = 0;
        signEventResponse = new Response(
            CursorKind.Event,
            "{\"id\":\"provider\",\"kind\":1,\"created_at\":0,\"tags\":[],\"content\":\"ok\"}"
        );
        nip44DecryptResponse = new Response(CursorKind.Result, "plaintext");
        nip44EncryptResponse = new Response(CursorKind.Result, "ciphertext");
    }

    @Override
    public boolean onCreate() {
        return true;
    }

    @Override
    public Cursor query(
        Uri uri,
        String[] projection,
        String selection,
        String[] selectionArgs,
        String sortOrder
    ) {
        queryCalls += 1;
        if (throwOnProjection && projection != null) {
            throw new IllegalArgumentException("projection args unsupported");
        }

        Response response;
        String authority = uri.getAuthority();
        if ((signerPackage + ".SIGN_EVENT").equals(authority)) {
            response = signEventResponse;
        } else if ((signerPackage + ".NIP44_DECRYPT").equals(authority)) {
            response = nip44DecryptResponse;
        } else if ((signerPackage + ".NIP44_ENCRYPT").equals(authority)) {
            response = nip44EncryptResponse;
        } else {
            response = null;
        }

        return response == null ? null : cursorFor(response);
    }

    private Cursor cursorFor(Response response) {
        MatrixCursor cursor;
        switch (response.kind) {
            case Event:
                cursor = new MatrixCursor(new String[] {"event"});
                cursor.addRow(new Object[] {response.value});
                return cursor;
            case Result:
                cursor = new MatrixCursor(new String[] {"result"});
                cursor.addRow(new Object[] {response.value});
                return cursor;
            case Signature:
                cursor = new MatrixCursor(new String[] {"signature"});
                cursor.addRow(new Object[] {response.value});
                return cursor;
            case Rejected:
                cursor = new MatrixCursor(new String[] {"rejected", "result"});
                cursor.addRow(new Object[] {true, response.value});
                return cursor;
            case NoRows:
                return new MatrixCursor(new String[] {"result"});
            case Null:
                return null;
            default:
                throw new AssertionError(response.kind);
        }
    }

    @Override
    public String getType(Uri uri) {
        return null;
    }

    @Override
    public Uri insert(Uri uri, ContentValues values) {
        return null;
    }

    @Override
    public int delete(Uri uri, String selection, String[] selectionArgs) {
        return 0;
    }

    @Override
    public int update(Uri uri, ContentValues values, String selection, String[] selectionArgs) {
        return 0;
    }
}
