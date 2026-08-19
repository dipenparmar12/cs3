package android.content.pm;

import android.content.UnsupportedAndroidApiException;

/**
 * Android's package query service.
 *
 * Present so extensions that merely *mention* the type can be loaded. That is
 * the failure this fixes: `Kraptor123/cs-kraptor` calls
 * `context.getPackageManager()` inside `load`, and the class was missing, so all
 * 65 of its plugins died with
 *
 *     NoClassDefFoundError: android/content/pm/PackageManager
 *
 * before a line of their code ran. Verification resolves every type a method
 * body names, so an unreferenced-at-runtime branch is enough to kill the load —
 * the class has to exist even when nothing ever calls into it.
 *
 * The methods themselves throw. There is no package manager on a desktop, and
 * inventing answers about installed Android applications would send an
 * extension down a branch built for a device that is not here. Throwing surfaces
 * as {@code UNSUPPORTED_ANDROID_API}, which the analyzer already treats as a
 * compatibility finding that demotes the plugin's tier rather than as a crash.
 */
public class PackageManager {

    /** Signature flag constants extensions pass; values match Android's. */
    public static final int GET_META_DATA = 0x00000080;
    public static final int GET_SIGNATURES = 0x00000040;
    public static final int GET_ACTIVITIES = 0x00000001;

    /**
     * Android declares this as throwing a checked exception, so extensions
     * catch it by name. The type has to exist for that catch block to link.
     */
    public static class NameNotFoundException extends Exception {
        public NameNotFoundException() {
            super();
        }

        public NameNotFoundException(String name) {
            super(name);
        }
    }

    public PackageInfo getPackageInfo(String packageName, int flags) throws NameNotFoundException {
        throw new UnsupportedAndroidApiException(
                "android.content.pm.PackageManager.getPackageInfo(" + packageName + ")");
    }

    public ApplicationInfo getApplicationInfo(String packageName, int flags)
            throws NameNotFoundException {
        throw new UnsupportedAndroidApiException(
                "android.content.pm.PackageManager.getApplicationInfo(" + packageName + ")");
    }

    public CharSequence getApplicationLabel(ApplicationInfo info) {
        throw new UnsupportedAndroidApiException(
                "android.content.pm.PackageManager.getApplicationLabel");
    }

    /**
     * Returns null, which is Android's own answer for a uid it knows nothing
     * about — and truthful here, because there are no Android packages.
     *
     * Null rather than a throw because of where it is called from: extensions
     * use this during `load` to work out which app they are hosted in, and an
     * exception would abort a load that has no other problem. Null sends them
     * down their "unknown host" branch, which is the accurate one.
     *
     * Deliberately not answering with a forged `com.lagradost.cloudstream3`.
     * An extension asking this is entitled to a true answer; manufacturing one
     * to make it behave as though it were on Android would be lying to plugin
     * code about the platform it is running on, and any bug that followed would
     * be undiagnosable.
     */
    public String[] getPackagesForUid(int uid) {
        return null;
    }

    public String getNameForUid(int uid) {
        return null;
    }
}
