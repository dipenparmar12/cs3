package android.view;

import android.content.UnsupportedAndroidApiException;

/**
 * {@code android.view.ViewTreeObserver} — the type {@link View#getViewTreeObserver}
 * returns, present so the descriptor links. There is no view tree to observe.
 */
public final class ViewTreeObserver {

    public interface OnGlobalLayoutListener {
        void onGlobalLayout();
    }

    ViewTreeObserver() { }

    public void addOnGlobalLayoutListener(OnGlobalLayoutListener listener) {
        throw new UnsupportedAndroidApiException("android.view.ViewTreeObserver.addOnGlobalLayoutListener");
    }

    public void removeOnGlobalLayoutListener(OnGlobalLayoutListener listener) { }
}
