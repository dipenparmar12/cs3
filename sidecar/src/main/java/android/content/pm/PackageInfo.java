package android.content.pm;

/**
 * Android's per-package metadata record.
 *
 * Public fields, not accessors, because that is what Android declares and what
 * extensions compile against — `info.versionName` becomes a `getfield`, and an
 * accessor would not satisfy it.
 *
 * Extensions read this to branch on the host app's version. Left at defaults
 * rather than filled with the desktop app's own version: an extension comparing
 * against a CloudStream Android release would draw a conclusion about a build
 * that does not exist here, and a null version name is the honest answer to
 * "which Android app am I running inside".
 */
public class PackageInfo {

    public String packageName;

    public String versionName;

    /** Deprecated on Android in favour of `getLongVersionCode`, still widely read. */
    public int versionCode;

    public long firstInstallTime;

    public long lastUpdateTime;
}
