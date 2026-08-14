package androidx.fragment.app;

import android.app.Dialog;
import android.content.DialogInterface;
import android.content.UnsupportedAndroidApiException;
import android.os.Bundle;

/**
 * {@code androidx.fragment.app.DialogFragment} — named by 6 load failures, all
 * of the same shape: an extension's settings class extends it, and
 * {@code defineClass1} rejected that class because its superclass was
 * unresolvable. The extension's providers never got a chance to register.
 *
 * <p>Implements the two {@link DialogInterface} listeners Android's does.
 * Extensions override {@code onCancel}/{@code onDismiss} and call
 * {@code super}, which only links if the inherited methods are really here with
 * these descriptors.
 *
 * <p>{@link #show} throws rather than no-oping. Silently swallowing it would
 * leave the user waiting for a settings dialog that is never coming, with
 * nothing in the log; throwing surfaces as {@code UNSUPPORTED_ANDROID_API} and
 * demotes the plugin to {@code T3_DEGRADED}, which states the truth — this
 * extension scrapes correctly and cannot show its settings screen.
 */
public class DialogFragment extends Fragment
        implements DialogInterface.OnCancelListener, DialogInterface.OnDismissListener {

    public static final int STYLE_NORMAL = 0;
    public static final int STYLE_NO_TITLE = 1;
    public static final int STYLE_NO_FRAME = 2;
    public static final int STYLE_NO_INPUT = 3;

    public DialogFragment() {
        super();
    }

    public DialogFragment(int contentLayoutId) {
        super(contentLayoutId);
    }

    public void show(FragmentManager manager, String tag) {
        throw new UnsupportedAndroidApiException(
                "androidx.fragment.app.DialogFragment.show — desktop has no fragment host;"
                        + " this extension's settings screen is unavailable, its providers are not");
    }

    public int show(FragmentTransaction transaction, String tag) {
        throw new UnsupportedAndroidApiException(
                "androidx.fragment.app.DialogFragment.show");
    }

    public void showNow(FragmentManager manager, String tag) {
        throw new UnsupportedAndroidApiException(
                "androidx.fragment.app.DialogFragment.showNow");
    }

    public Dialog onCreateDialog(Bundle savedInstanceState) {
        return null;
    }

    public Dialog getDialog() {
        return null;
    }

    public Dialog requireDialog() {
        throw new UnsupportedAndroidApiException(
                "androidx.fragment.app.DialogFragment.requireDialog");
    }

    public void setStyle(int style, int theme) {
    }

    public void setCancelable(boolean cancelable) {
    }

    public boolean isCancelable() {
        return true;
    }

    public void dismiss() {
    }

    public void dismissAllowingStateLoss() {
    }

    @Override
    public void onCancel(DialogInterface dialog) {
    }

    @Override
    public void onDismiss(DialogInterface dialog) {
    }
}
