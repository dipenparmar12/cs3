package android.content;

import android.net.Uri;

import java.io.InputStream;
import java.io.OutputStream;

/**
 * Stub for {@code android.content.ContentResolver}.
 *
 * <p>Exists to name a return type. {@code Context.getContentResolver} declared
 * {@code Object}, which is a different descriptor from Android's
 * {@code ()Landroid/content/ContentResolver;} and therefore a different method:
 * an extension calling it got {@code NoSuchMethodError} at the call site rather
 * than the shim's own message. See {@link android.content.res.AssetManager} for
 * the history of that near-miss.
 *
 * <p>Every operation throws, and that is the whole point rather than an
 * omission. A {@code ContentResolver} is the door to <em>other applications'</em>
 * data on the device — the media store, contacts, the download manager, any
 * exported provider. There is no desktop equivalent and DROP-12 says a plugin's
 * Context grants no ambient authority, so the honest answer is a refusal that
 * names itself. Returning an empty cursor would be a lie about the platform of
 * exactly the kind {@code getPackagesForUid} declines to tell.
 */
public class ContentResolver {

    private static UnsupportedAndroidApiException unsupported(String member) {
        return new UnsupportedAndroidApiException(
                "ContentResolver." + member,
                "Content providers address other Android apps' data, which has no "
                        + "desktop equivalent.");
    }

    public InputStream openInputStream(Uri uri) {
        throw unsupported("openInputStream");
    }

    public OutputStream openOutputStream(Uri uri) {
        throw unsupported("openOutputStream");
    }

    public String getType(Uri uri) {
        // Documented to return null when the type is unknown, which is true
        // here and lets a caller that checks take its own branch.
        return null;
    }

    public Uri insert(Uri url, Object values) {
        throw unsupported("insert");
    }

    public int delete(Uri url, String where, String[] selectionArgs) {
        throw unsupported("delete");
    }

    public int update(Uri uri, Object values, String where, String[] selectionArgs) {
        throw unsupported("update");
    }
}
