package android.content.pm;

/**
 * Android's per-application record.
 *
 * Referenced by {@link PackageManager#getApplicationInfo}, so it has to exist
 * for that method's descriptor to resolve even though the method throws. Public
 * fields for the same reason as {@link PackageInfo}: extensions read them
 * directly.
 */
public class ApplicationInfo {

    public String packageName;

    public String sourceDir;

    public String dataDir;

    public String nativeLibraryDir;

    public int flags;
}
