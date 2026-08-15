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

    public void setBackgroundDrawable(Object drawable) {
        throw new UnsupportedAndroidApiException("android.view.Window.setBackgroundDrawable");
    }

    public boolean requestFeature(int featureId) {
        throw new UnsupportedAndroidApiException("android.view.Window.requestFeature");
    }
}
