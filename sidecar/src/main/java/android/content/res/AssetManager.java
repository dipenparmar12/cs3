package android.content.res;

import android.content.UnsupportedAndroidApiException;

import java.io.InputStream;

/**
 * Stub for {@code android.content.res.AssetManager}.
 *
 * <p>Exists to name a return type, not to do anything. {@code Context.getAssets}
 * declared {@code Object} until this class existed — and a method returning
 * {@code Object} is a <em>different method</em> to the JVM than
 * {@code ()Landroid/content/res/AssetManager;}, which is what an extension
 * compiled against Android calls. The shim's own message ("getAssets is not
 * available") was therefore unreachable: the call failed with
 * {@code NoSuchMethodError} at the call site, naming nothing useful, before the
 * body could run.
 *
 * <p>That near-miss has been made repeatedly in this repository —
 * {@code getResources} and {@code getPackageManager} returning {@code Object},
 * {@code startActivity} taking {@code Object}, {@code AccountManager.aniListApi}
 * declared as the wrapper type, {@code setKey}, {@code simklApi}. The rule it
 * keeps breaking is that a parameter or return type widened to a supertype does
 * not merely lose type safety, it renames the method.
 * {@code ShimSignatureTest} now pins it.
 *
 * <p>Every accessor throws. A {@code .cs3} carries no Android asset directory —
 * measured, an archive contains exactly {@code manifest.json} and
 * {@code classes.dex} — so there is nothing here to open and no honest value to
 * return. Failing at the point of use names the real limitation.
 */
public class AssetManager {

    private static UnsupportedAndroidApiException unsupported(String member) {
        return new UnsupportedAndroidApiException(
                "AssetManager." + member,
                "A .cs3 archive carries no Android asset directory.");
    }

    public InputStream open(String fileName) {
        throw unsupported("open");
    }

    public InputStream open(String fileName, int accessMode) {
        throw unsupported("open");
    }

    public String[] list(String path) {
        throw unsupported("list");
    }

    public void close() {
        // Android's is idempotent and callers put it in a `finally`. Throwing
        // here would replace the real failure — whatever `open` refused — with
        // one raised while cleaning up after it.
    }
}
