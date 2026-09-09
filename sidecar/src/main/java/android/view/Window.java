package android.view;

import android.content.UnsupportedAndroidApiException;

/**
 * {@code android.view.Window} — the return type of {@code Activity.getWindow}
 * and {@code Dialog.getWindow}, both of which extensions call when sizing their
 * settings dialog. Present so those call sites resolve.
 */
public abstract class Window {

    public static final int FEATURE_NO_TITLE = 1;

    protected Window() {
    }

    public View getDecorView() {
        throw new UnsupportedAndroidApiException("android.view.Window.getDecorView");
    }

    public void setLayout(int width, int height) {
        throw new UnsupportedAndroidApiException("android.view.Window.setLayout");
    }

    /**
     * Android's descriptor is {@code (Landroid/graphics/drawable/Drawable;)V}.
     *
     * <p>This took {@code Object} until {@link android.graphics.drawable.Drawable}
     * existed to name it — the same near-miss as {@code Context.startActivity}
     * before {@code Intent} landed, left behind when that type was added for a
     * different reason. A widened parameter renames the method, so the call site
     * fails with {@code NoSuchMethodError} rather than reaching this body.
     */
    public void setBackgroundDrawable(android.graphics.drawable.Drawable drawable) {
        throw new UnsupportedAndroidApiException("android.view.Window.setBackgroundDrawable");
    }

    public boolean requestFeature(int featureId) {
        throw new UnsupportedAndroidApiException("android.view.Window.requestFeature");
    }
}
