package android.view;

import android.content.UnsupportedAndroidApiException;

/**
 * {@code android.view.KeyEvent} — the parameter of
 * {@link View.OnKeyListener#onKey}, present so that listener links.
 */
public class KeyEvent {

    public static final int ACTION_DOWN = 0;
    public static final int ACTION_UP = 1;
    public static final int KEYCODE_BACK = 4;
    public static final int KEYCODE_ENTER = 66;
    public static final int KEYCODE_DPAD_CENTER = 23;

    protected KeyEvent() {
    }

    public int getAction() {
        throw new UnsupportedAndroidApiException("android.view.KeyEvent.getAction");
    }

    public int getKeyCode() {
        throw new UnsupportedAndroidApiException("android.view.KeyEvent.getKeyCode");
    }
}
