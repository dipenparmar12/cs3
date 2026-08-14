package android.view;

import android.content.UnsupportedAndroidApiException;

/**
 * {@code android.view.MotionEvent} — the parameter of
 * {@link View.OnTouchListener#onTouch}, so any extension that sets a touch
 * listener needs it to link.
 *
 * <p>The action constants are real values rather than stubs. They are compiled
 * into the extension as literals anyway, and an extension that switches on
 * {@code ACTION_DOWN} should compare against Android's number if it ever reads
 * an event from somewhere.
 */
public class MotionEvent {

    public static final int ACTION_DOWN = 0;
    public static final int ACTION_UP = 1;
    public static final int ACTION_MOVE = 2;
    public static final int ACTION_CANCEL = 3;

    protected MotionEvent() {
    }

    public int getAction() {
        throw new UnsupportedAndroidApiException("android.view.MotionEvent.getAction");
    }

    public float getX() {
        throw new UnsupportedAndroidApiException("android.view.MotionEvent.getX");
    }

    public float getY() {
        throw new UnsupportedAndroidApiException("android.view.MotionEvent.getY");
    }
}
