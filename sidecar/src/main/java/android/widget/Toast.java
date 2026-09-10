package android.widget;

import android.content.Context;
import android.view.View;

/**
 * {@code android.widget.Toast} — the transient on-screen notice.
 *
 * <p>Counted before it was written: 11 {@code NoClassDefFoundError:
 * android/widget/Toast} in one user's sessions. The cost is out of all
 * proportion to what the class does, for the reason round 3 established —
 * {@code Class.getMethod} resolves every public method's parameter and return
 * types, so an extension that merely *declares* a method mentioning
 * {@code Toast} fails while being described, after it has already registered,
 * and the whole load is abandoned naming a class nobody was calling.
 *
 * <h2>Why this one does not throw</h2>
 *
 * <p>Every other widget shim here refuses on use, and that is right for them:
 * an {@code AlertDialog} or a {@code DialogFragment} is load-bearing — the flow
 * stops and waits for an answer — so pretending it appeared would let a
 * provider carry on as though a choice had been made.
 *
 * <p>A toast is the opposite shape. Android's {@code show()} returns
 * immediately, tells the caller nothing, and cannot fail; a provider that
 * posts one has no branch depending on it and goes straight on to scrape.
 * Throwing here would convert a call with no consequences into an aborted
 * scrape, in the one case where the extension author could not have written
 * the code any other way. So the refusal is not silent, it is just not fatal:
 * the text is written to stderr in the same shape as the {@link
 * android.util.Log} shim, where {@code sidecarStderr} picks it up and the
 * extension issue ledger can count it. Nothing is hidden and nothing is
 * invented — the notice is delivered to the only place a desktop app has to
 * put it.
 *
 * <p>stderr, never stdout: stdout carries RPC frames and a stray line there
 * desynchronises the channel.
 */
public class Toast {

    public static final int LENGTH_SHORT = 0;
    public static final int LENGTH_LONG = 1;

    private CharSequence text;
    private int duration;

    public Toast(Context context) {
        this.duration = LENGTH_SHORT;
    }

    private Toast(CharSequence text, int duration) {
        this.text = text;
        this.duration = duration;
    }

    public static Toast makeText(Context context, CharSequence text, int duration) {
        return new Toast(text, duration);
    }

    /**
     * The string-resource overload.
     *
     * <p>There are no resources here, so the id is reported as an id. Inventing
     * a plausible string would be the forged-platform-value mistake DROP-9
     * names — an unresolvable id is a fact, and a made-up message is a lie that
     * outlives the session in a log.
     */
    public static Toast makeText(Context context, int resId, int duration) {
        return new Toast("<string resource " + resId + ">", duration);
    }

    public void show() {
        System.err.println("[plugin I/Toast] " + (text == null ? "" : text));
    }

    public void cancel() {
    }

    public void setText(CharSequence text) {
        this.text = text;
    }

    public void setText(int resId) {
        this.text = "<string resource " + resId + ">";
    }

    public void setDuration(int duration) {
        this.duration = duration;
    }

    public int getDuration() {
        return duration;
    }

    public void setGravity(int gravity, int xOffset, int yOffset) {
    }

    public void setMargin(float horizontalMargin, float verticalMargin) {
    }

    /**
     * Returns {@code null}, which is Android's own answer for a toast built by
     * {@code makeText} on API 30 and above.
     */
    public View getView() {
        return null;
    }

    public void setView(View view) {
    }
}
