package android.content;

/**
 * {@code android.content.DialogInterface} — an interface, and it must be one.
 *
 * <p>Its nested listeners are implemented inline by extensions all over the
 * corpus ({@code setPositiveButton(R.string.ok) { dialog, _ -> … }} compiles to a
 * class implementing {@code DialogInterface.OnClickListener}), and
 * {@code androidx.fragment.app.DialogFragment} itself implements
 * {@code OnCancelListener} and {@code OnDismissListener}. Declaring this as a
 * class rather than an interface would reproduce the {@code SharedPreferences}
 * defect exactly: extensions emit {@code invokeinterface}, which against a class
 * throws {@code IncompatibleClassChangeError} — and it would throw at first
 * *use*, long after a load that appeared to succeed.
 */
public interface DialogInterface {

    int BUTTON_POSITIVE = -1;
    int BUTTON_NEGATIVE = -2;
    int BUTTON_NEUTRAL = -3;

    void cancel();

    void dismiss();

    interface OnClickListener {
        void onClick(DialogInterface dialog, int which);
    }

    interface OnCancelListener {
        void onCancel(DialogInterface dialog);
    }

    interface OnDismissListener {
        void onDismiss(DialogInterface dialog);
    }

    interface OnShowListener {
        void onShow(DialogInterface dialog);
    }

    interface OnMultiChoiceClickListener {
        void onClick(DialogInterface dialog, int which, boolean isChecked);
    }
}
