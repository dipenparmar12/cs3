package android.app;

import android.content.Context;
import android.content.DialogInterface;
import android.content.UnsupportedAndroidApiException;
import android.view.View;

/**
 * {@code android.app.AlertDialog} and its {@code Builder} — three of eighteen
 * load failures in the CNC Verse repository.
 *
 * <p>The builder is the whole reason this class needs care. Every configuration
 * method returns {@code Builder} so calls chain, and extensions write that chain
 * as one expression; a builder method that threw would abort halfway through an
 * expression whose only purpose is to describe a dialog. So configuration is
 * accepted and discarded, exactly as {@link android.content.Intent} accepts its
 * extras, and the refusal lands on {@link Builder#show} and {@link #show} —
 * the two calls that genuinely need a window server.
 *
 * <p>The listeners are held rather than dropped: an extension that keeps a
 * reference and compares it later gets a truthful answer, and holding them costs
 * nothing.
 */
public class AlertDialog extends Dialog {

    public AlertDialog() {
    }

    public AlertDialog(Context context) {
        super(context);
    }

    protected AlertDialog(Context context, int themeResId) {
        super(context, themeResId);
    }

    @Override
    public void show() {
        throw new UnsupportedAndroidApiException("android.app.AlertDialog.show");
    }

    public void setMessage(CharSequence message) {
    }

    public void setButton(int whichButton, CharSequence text, DialogInterface.OnClickListener listener) {
    }

    public static class Builder {

        private final Context context;
        private CharSequence title;
        private CharSequence message;
        private DialogInterface.OnClickListener positive;
        private DialogInterface.OnClickListener negative;
        private DialogInterface.OnClickListener neutral;
        private DialogInterface.OnClickListener items;
        private DialogInterface.OnCancelListener cancel;
        private DialogInterface.OnDismissListener dismiss;
        private View view;
        private boolean cancelable = true;

        public Builder(Context context) {
            this.context = context;
        }

        public Builder(Context context, int themeResId) {
            this.context = context;
        }

        public Context getContext() {
            return context;
        }

        public Builder setTitle(CharSequence title) {
            this.title = title;
            return this;
        }

        public Builder setTitle(int titleId) {
            return this;
        }

        public Builder setMessage(CharSequence message) {
            this.message = message;
            return this;
        }

        public Builder setMessage(int messageId) {
            return this;
        }

        public Builder setView(View view) {
            this.view = view;
            return this;
        }

        public Builder setView(int layoutResId) {
            return this;
        }

        public Builder setPositiveButton(CharSequence text, DialogInterface.OnClickListener listener) {
            this.positive = listener;
            return this;
        }

        public Builder setPositiveButton(int textId, DialogInterface.OnClickListener listener) {
            this.positive = listener;
            return this;
        }

        public Builder setNegativeButton(CharSequence text, DialogInterface.OnClickListener listener) {
            this.negative = listener;
            return this;
        }

        public Builder setNegativeButton(int textId, DialogInterface.OnClickListener listener) {
            this.negative = listener;
            return this;
        }

        public Builder setNeutralButton(CharSequence text, DialogInterface.OnClickListener listener) {
            this.neutral = listener;
            return this;
        }

        public Builder setNeutralButton(int textId, DialogInterface.OnClickListener listener) {
            this.neutral = listener;
            return this;
        }

        public Builder setItems(CharSequence[] items, DialogInterface.OnClickListener listener) {
            this.items = listener;
            return this;
        }

        public Builder setSingleChoiceItems(
                CharSequence[] items, int checkedItem, DialogInterface.OnClickListener listener) {
            this.items = listener;
            return this;
        }

        public Builder setMultiChoiceItems(
                CharSequence[] items,
                boolean[] checkedItems,
                DialogInterface.OnMultiChoiceClickListener listener) {
            return this;
        }

        public Builder setCancelable(boolean cancelable) {
            this.cancelable = cancelable;
            return this;
        }

        public Builder setOnCancelListener(DialogInterface.OnCancelListener listener) {
            this.cancel = listener;
            return this;
        }

        public Builder setOnDismissListener(DialogInterface.OnDismissListener listener) {
            this.dismiss = listener;
            return this;
        }

        /**
         * Returns a dialog rather than throwing, because {@code create()} on
         * Android does not touch the window server either — the caller usually
         * goes on to call {@code show()}, which is where this refuses.
         */
        public AlertDialog create() {
            return new AlertDialog(context);
        }

        public AlertDialog show() {
            throw new UnsupportedAndroidApiException("android.app.AlertDialog.Builder.show");
        }
    }
}
