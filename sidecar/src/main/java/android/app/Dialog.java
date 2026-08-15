package android.app;

import android.content.Context;
import android.content.DialogInterface;
import android.content.UnsupportedAndroidApiException;
import android.os.Bundle;
import android.view.View;
import android.view.Window;

/**
 * {@code android.app.Dialog} — the return type of
 * {@code DialogFragment.onCreateDialog}, so an extension that overrides it needs
 * this type to define its own class.
 *
 * <p>Implements {@link DialogInterface} because Android's does and because
 * extensions pass a Dialog where a DialogInterface is expected. Every operation
 * throws; there is no window server here.
 */
public class Dialog implements DialogInterface {

    public Dialog() {
    }

    public Dialog(Context context) {
    }

    public Dialog(Context context, int themeResId) {
    }

    protected void onCreate(Bundle savedInstanceState) {
    }

    public void setContentView(View view) {
        throw new UnsupportedAndroidApiException("android.app.Dialog.setContentView");
    }

    public void setContentView(int layoutResID) {
        throw new UnsupportedAndroidApiException("android.app.Dialog.setContentView");
    }

    public <T extends View> T findViewById(int id) {
        throw new UnsupportedAndroidApiException("android.app.Dialog.findViewById");
    }

    public Window getWindow() {
        throw new UnsupportedAndroidApiException("android.app.Dialog.getWindow");
    }

    public Context getContext() {
        throw new UnsupportedAndroidApiException("android.app.Dialog.getContext");
    }

    public void setTitle(CharSequence title) {
        throw new UnsupportedAndroidApiException("android.app.Dialog.setTitle");
    }

    public void setCancelable(boolean flag) {
        throw new UnsupportedAndroidApiException("android.app.Dialog.setCancelable");
    }

    public void setCanceledOnTouchOutside(boolean cancel) {
        throw new UnsupportedAndroidApiException("android.app.Dialog.setCanceledOnTouchOutside");
    }

    public void setOnDismissListener(OnDismissListener listener) {
        throw new UnsupportedAndroidApiException("android.app.Dialog.setOnDismissListener");
    }

    public void setOnCancelListener(OnCancelListener listener) {
        throw new UnsupportedAndroidApiException("android.app.Dialog.setOnCancelListener");
    }

    public void setOnShowListener(OnShowListener listener) {
        throw new UnsupportedAndroidApiException("android.app.Dialog.setOnShowListener");
    }

    public void show() {
        throw new UnsupportedAndroidApiException("android.app.Dialog.show");
    }

    public void hide() {
        throw new UnsupportedAndroidApiException("android.app.Dialog.hide");
    }

    public boolean isShowing() {
        return false;
    }

    @Override
    public void cancel() {
        throw new UnsupportedAndroidApiException("android.app.Dialog.cancel");
    }

    @Override
    public void dismiss() {
        throw new UnsupportedAndroidApiException("android.app.Dialog.dismiss");
    }
}
