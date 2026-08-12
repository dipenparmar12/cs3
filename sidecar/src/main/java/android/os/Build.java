package android.os;

/**
 * {@code android.os.Build} shim. {@code Build.VERSION} is referenced by 71 of
 * 392 surveyed plugins, almost always to gate behaviour on {@code SDK_INT}.
 *
 * <h2>DROP-9: this does not impersonate a device</h2>
 * Reporting a fake Pixel would make providers take Android code paths that
 * cannot work here — and it would be a lie told to code we are also asking to
 * behave correctly. Instead the identity is coherent, stable and honest:
 * manufacturer and model say "desktop", and {@code SDK_INT} reports a recent API
 * level so that providers gating on "new enough Android" take their modern path,
 * which is the one least likely to depend on legacy device behaviour.
 */
public class Build {

    public static final String MANUFACTURER = "CloudStream";
    public static final String BRAND = "CloudStream";
    public static final String MODEL = "CloudStream Desktop";
    public static final String DEVICE = "desktop";
    public static final String PRODUCT = "cloudstream_desktop";
    public static final String HARDWARE = "desktop";
    public static final String ID = "CS3DESKTOP";
    public static final String DISPLAY = "CloudStream Desktop";
    public static final String FINGERPRINT =
            "CloudStream/cloudstream_desktop/desktop:14/CS3DESKTOP/desktop:user/release-keys";
    public static final String TYPE = "user";
    public static final String TAGS = "release-keys";
    public static final String HOST = "desktop";
    public static final String USER = "cloudstream";
    public static final String BOOTLOADER = "unknown";
    public static final String[] SUPPORTED_ABIS = { "x86_64" };

    public static String getRadioVersion() {
        return null;
    }

    public static class VERSION {
        /** API 34 (Android 14). Matches the FINGERPRINT above so the two agree. */
        public static final int SDK_INT = 34;
        public static final String SDK = "34";
        public static final String RELEASE = "14";
        public static final String CODENAME = "REL";
        public static final String INCREMENTAL = "1";
        public static final String SECURITY_PATCH = "2026-01-01";
        public static final int PREVIEW_SDK_INT = 0;
    }

    public static class VERSION_CODES {
        public static final int BASE = 1;
        public static final int KITKAT = 19;
        public static final int LOLLIPOP = 21;
        public static final int M = 23;
        public static final int N = 24;
        public static final int O = 26;
        public static final int P = 28;
        public static final int Q = 29;
        public static final int R = 30;
        public static final int S = 31;
        public static final int TIRAMISU = 33;
        public static final int UPSIDE_DOWN_CAKE = 34;
    }
}
