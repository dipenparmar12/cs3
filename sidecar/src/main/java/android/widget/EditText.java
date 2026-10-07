package android.widget;

import android.content.Context;
import android.content.UnsupportedAndroidApiException;
import android.text.Editable;

/**
 * {@code android.widget.EditText} — part of the UI closure, like every view in
 * the shim: it exists so the archive that contains a settings screen can load,
 * and its operations refuse.
 *
 * {@link #getText()} narrows to {@link Editable} as Android's does. The
 * narrower return is a different method to the JVM, and an extension compiled
 * against Android calls {@code getText()Landroid/text/Editable;} — inheriting
 * {@code TextView}'s {@code CharSequence} version would link against nothing.
 */
public class EditText extends TextView {

    public EditText(Context context) {
        super(context);
    }

    @Override
    public Editable getText() {
        throw new UnsupportedAndroidApiException("android.widget.EditText.getText");
    }
}
