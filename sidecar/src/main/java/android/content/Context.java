package android.content;

import java.io.File;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.concurrent.ConcurrentHashMap;

/**
 * {@code android.content.Context} shim — the single most referenced Android type
 * in the ecosystem, appearing in the translated bytecode of 299 of 392 surveyed
 * plugins.
 *
 * <p>That number is far above what docs/PRD/31 §2.3 predicted from Kotlin
 * imports (4 files), because a shipped {@code .cs3} also contains CloudStream
 * library code that R8 inlined into it. Most plugins never dereference the
 * Context they are handed — but it has to exist, and the methods that are
 * reached have to behave.
 *
 * <h2>An inert capability token</h2>
 * This Context grants no ambient authority (DROP-12). It carries the plugin's
 * identity and its scoped storage directory and nothing else: there is no path
 * from it to the user's filesystem, to another plugin's data, or to the host
 * process. Methods outside the implemented set throw
 * {@link UnsupportedAndroidApiException} naming themselves, so an unsupported
 * call produces an actionable message instead of a null dereference three frames
 * later (DROP-7, AC-D5).
 */
public class Context {

    public static final String MODE_PRIVATE_NAME = "MODE_PRIVATE";
    public static final int MODE_PRIVATE = 0;
    public static final int MODE_APPEND = 32768;

    private final String pluginId;
    private final Path scopedDir;
    private final ConcurrentHashMap<String, SharedPreferences> prefs = new ConcurrentHashMap<>();

    protected Context(String pluginId, Path scopedDir) {
        this.pluginId = pluginId;
        this.scopedDir = scopedDir;
    }

    /**
     * Factory used by the sidecar's loader.
     *
     * The sidecar cannot call {@code new Context(...)} directly: it does not
     * compile against the shim, and the instance must be created by the same
     * class loader the plugin links against or the reflective
     * {@code load(Context)} invoke fails on an argument type mismatch.
     */
    public static Context cs3CreateScoped(String pluginId, String scopedDir) {
        return new Context(pluginId, Paths.get(scopedDir, sanitize(pluginId)));
    }

    private static String sanitize(String id) {
        return id == null ? "unknown" : id.replaceAll("[^A-Za-z0-9._-]", "_");
    }

    // --- implemented surface -------------------------------------------------

    public SharedPreferences getSharedPreferences(String name, int mode) {
        String key = sanitize(name);
        return prefs.computeIfAbsent(key,
                k -> new JsonSharedPreferences(scopedDir.resolve("prefs").resolve(k + ".json")));
    }

    public File getFilesDir() {
        File f = scopedDir.resolve("files").toFile();
        f.mkdirs();
        return f;
    }

    public File getCacheDir() {
        File f = scopedDir.resolve("cache").toFile();
        f.mkdirs();
        return f;
    }

    public File getExternalFilesDir(String type) {
        return getFilesDir();
    }

    public File getDir(String name, int mode) {
        File f = scopedDir.resolve(sanitize(name)).toFile();
        f.mkdirs();
        return f;
    }

    public String getPackageName() {
        // Providers use this for logging and for building user-agent strings.
        // Reporting the desktop identity honestly is required by DROP-9.
        return "com.lagradost.cloudstream3.desktop";
    }

    public Context getApplicationContext() {
        return this;
    }

    public ClassLoader getClassLoader() {
        return getClass().getClassLoader();
    }

    /** The plugin this token was minted for. */
    public String cs3PluginId() {
        return pluginId;
    }

    // --- deliberately unimplemented -----------------------------------------

    public Object getSystemService(String name) {
        throw new UnsupportedAndroidApiException("android.content.Context.getSystemService(" + name + ")");
    }

    public Object getResources() {
        throw new UnsupportedAndroidApiException("android.content.Context.getResources");
    }

    public Object getAssets() {
        throw new UnsupportedAndroidApiException("android.content.Context.getAssets");
    }

    public Object getContentResolver() {
        throw new UnsupportedAndroidApiException("android.content.Context.getContentResolver");
    }

    /**
     * Returns the real shim type, not `Object`.
     *
     * The descriptor is the whole point. An extension compiled against Android
     * calls `getPackageManager()Landroid/content/pm/PackageManager;`, and a
     * method returning `Object` is a *different* method as far as the JVM is
     * concerned — it links against nothing and fails with `NoSuchMethodError` at
     * the call site. Returning the declared type is what makes the call resolve;
     * the object it hands back still throws on every operation.
     */
    public android.content.pm.PackageManager getPackageManager() {
        return new android.content.pm.PackageManager();
    }

    public void startActivity(Object intent) {
        throw new UnsupportedAndroidApiException("android.content.Context.startActivity");
    }

    public String getString(int resId) {
        throw new UnsupportedAndroidApiException(
                "android.content.Context.getString(int) — desktop has no compiled resource table");
    }
}
