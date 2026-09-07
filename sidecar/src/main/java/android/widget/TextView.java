package android.widget;

import android.content.Context;
import android.content.UnsupportedAndroidApiException;
import android.view.View;

/**
 * {@code android.widget.TextView} — present so {@link CheckBox} has a
 * supertype chain that resolves.
 *
 * <p>Nothing in this repository's corpus references {@code TextView} directly.
 * It exists because verification resolves a class's *whole* ancestry before it
 * can be defined, so a shimmed {@code CheckBox} whose parents are missing fails
 * exactly as loudly as no {@code CheckBox} at all — and names the wrong class
 * while doing it.
 *
 * <p>Every member throws, for the reason given on {@link View}.
 */
public class TextView extends View {

    public TextView() {
    }

    public TextView(Context context) {
        super(context);
    }

    public CharSequence getText() {
        throw new UnsupportedAndroidApiException("android.widget.TextView.getText");
    }

    public void setText(CharSequence text) {
        throw new UnsupportedAndroidApiException("android.widget.TextView.setText");
    }

    public void setText(int resId) {
        throw new UnsupportedAndroidApiException("android.widget.TextView.setText");
    }

    public void setHint(CharSequence hint) {
        throw new UnsupportedAndroidApiException("android.widget.TextView.setHint");
    }

    public void setTextColor(int color) {
        throw new UnsupportedAndroidApiException("android.widget.TextView.setTextColor");
    }
}
