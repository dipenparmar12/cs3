package android.util;

/**
 * {@code android.util.DisplayMetrics}.
 *
 * <p>Named by {@code NoSuchMethodError: 'android.util.DisplayMetrics
 * android.content.res.Resources.getDisplayMetrics()'} in a session log — the
 * <b>sixth</b> time this repository has hit the same descriptor near-miss. The
 * method did not exist at all here, which is the cheaper half; the expensive
 * half is when it exists with a widened type, because then it is a *different
 * method* to the JVM and no extension can ever call it. See {@code
 * Context.getResources} returning {@code Object}, {@code
 * AccountManager.aniListApi} typed as the wrapper, {@code setKey}, {@code
 * simklApi} and {@code Context.startActivity}.
 *
 * <p><b>Fields, not accessors, and that is Android's shape.</b> Every corpus
 * call site reads {@code metrics.density} or {@code metrics.widthPixels}
 * directly. Getters would compile here and link against nothing there.
 *
 * <p><b>Why these carry values rather than throwing.</b> The rule this shim
 * follows is that a platform difference is refused loudly and a platform
 * *absence* is answered honestly — the same call {@code
 * Context.getSystemService} makes when it returns {@code null} rather than
 * throwing. Every use of this class in the corpus is arithmetic: converting dp
 * to pixels, sizing a thumbnail request, choosing a poster width. Throwing from
 * a field read is not possible anyway, and throwing from {@code
 * getDisplayMetrics()} would abort a {@code load()} over a number used to pick
 * an image size.
 *
 * <p><b>These are stated defaults, not measurements, and the distinction
 * matters.</b> The sidecar is a headless JVM with no window and no display
 * connection; it genuinely does not know the screen. Reaching for AWT to find
 * out would add {@code java.desktop} to a jlink module list that is curated
 * precisely to stay small. So: {@code density} is 1.0 because this app does no
 * scaling — that one is true rather than assumed — and the pixel dimensions are
 * an ordinary desktop window. An extension sizing a poster request from these
 * gets a sensible number; nothing here reports a device that does not exist.
 */
public class DisplayMetrics {

    /** Matches Android's {@code DENSITY_DEFAULT}: 160 dpi is density 1.0. */
    public static final int DENSITY_DEFAULT = 160;

    public int widthPixels = 1920;
    public int heightPixels = 1080;

    /**
     * 1.0, and this one is a fact rather than a default: the desktop app
     * applies no density scaling, so a dp is a pixel here.
     */
    public float density = 1.0f;
    public float scaledDensity = 1.0f;
    public int densityDpi = DENSITY_DEFAULT;
    public float xdpi = DENSITY_DEFAULT;
    public float ydpi = DENSITY_DEFAULT;

    public void setTo(DisplayMetrics other) {
        if (other == null) return;
        widthPixels = other.widthPixels;
        heightPixels = other.heightPixels;
        density = other.density;
        scaledDensity = other.scaledDensity;
        densityDpi = other.densityDpi;
        xdpi = other.xdpi;
        ydpi = other.ydpi;
    }

    @Override
    public String toString() {
        return "DisplayMetrics{density=" + density
                + ", width=" + widthPixels
                + ", height=" + heightPixels
                + ", densityDpi=" + densityDpi + "}";
    }
}
