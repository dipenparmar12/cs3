package android.widget;

import android.content.Context;
import android.content.UnsupportedAndroidApiException;

/**
 * {@code android.widget.CompoundButton} — {@link CheckBox}'s direct supertype,
 * and the owner of the checked-state API extensions actually call.
 *
 * <p>{@code OnCheckedChangeListener} is nested here rather than on
 * {@code CheckBox} because that is where Android declares it: an extension
 * writing {@code CompoundButton.OnCheckedChangeListener { … }} compiles against
 * that exact binary name, and a listener declared one class lower would not
 * link.
 */
public class CompoundButton extends Button {

    public interface OnCheckedChangeListener {
        void onCheckedChanged(CompoundButton buttonView, boolean isChecked);
    }

    public CompoundButton() {
    }

    public CompoundButton(Context context) {
        super(context);
    }

    public boolean isChecked() {
        throw new UnsupportedAndroidApiException("android.widget.CompoundButton.isChecked");
    }

    public void setChecked(boolean checked) {
        throw new UnsupportedAndroidApiException("android.widget.CompoundButton.setChecked");
    }

    public void toggle() {
        throw new UnsupportedAndroidApiException("android.widget.CompoundButton.toggle");
    }

    public void setOnCheckedChangeListener(OnCheckedChangeListener listener) {
        throw new UnsupportedAndroidApiException(
                "android.widget.CompoundButton.setOnCheckedChangeListener");
    }
}
