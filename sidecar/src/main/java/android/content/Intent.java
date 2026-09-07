package android.content;

import android.net.Uri;
import android.os.Bundle;

/**
 * {@code android.content.Intent} — six of eighteen load failures in the CNC
 * Verse repository, second only to {@link android.widget.CheckBox}.
 *
 * <p>Unlike the view closure, this class does <em>not</em> throw on
 * construction or on the builder-shaped methods, and that difference is
 * deliberate. An {@code Intent} on Android is an inert value object: building
 * one does nothing at all, and the platform is only involved when it is handed
 * to {@code startActivity}. Throwing from {@code putExtra} would be a lie about
 * where the boundary is, and would break code that assembles an Intent inside
 * an otherwise working scraper path.
 *
 * <p>So the value behaves, and {@link Context#startActivity} is where the
 * refusal lives. That keeps the failure on the line that actually needs a
 * platform — which is the same rule {@code getSystemService} follows, and the
 * reason a provider whose {@code load()} merely mentions an Intent now
 * registers instead of dying.
 *
 * <p>The dominant corpus use is opening a URL in a browser
 * ({@code ACTION_VIEW} with an {@code http} {@link Uri}). Wiring that to the
 * desktop's shell is tempting and is not done here: the shim has no channel to
 * the main process, and an extension silently opening browser windows from a
 * background scrape would be a worse behaviour than a named refusal.
 */
public class Intent {

    public static final String ACTION_VIEW = "android.intent.action.VIEW";
    public static final String ACTION_SEND = "android.intent.action.SEND";
    public static final String ACTION_MAIN = "android.intent.action.MAIN";
    public static final String ACTION_GET_CONTENT = "android.intent.action.GET_CONTENT";
    public static final String EXTRA_TEXT = "android.intent.extra.TEXT";
    public static final String EXTRA_SUBJECT = "android.intent.extra.SUBJECT";
    public static final String EXTRA_STREAM = "android.intent.extra.STREAM";

    public static final int FLAG_ACTIVITY_NEW_TASK = 0x10000000;
    public static final int FLAG_ACTIVITY_CLEAR_TOP = 0x04000000;
    public static final int FLAG_GRANT_READ_URI_PERMISSION = 0x00000001;

    private String action;
    private Uri data;
    private String type;
    private int flags;
    private final Bundle extras = new Bundle();

    public Intent() {
    }

    public Intent(String action) {
        this.action = action;
    }

    public Intent(String action, Uri uri) {
        this.action = action;
        this.data = uri;
    }

    public Intent(Context packageContext, Class<?> cls) {
    }

    public String getAction() {
        return action;
    }

    public Intent setAction(String action) {
        this.action = action;
        return this;
    }

    public Uri getData() {
        return data;
    }

    public Intent setData(Uri data) {
        this.data = data;
        return this;
    }

    public String getType() {
        return type;
    }

    public Intent setType(String type) {
        this.type = type;
        return this;
    }

    public Intent setDataAndType(Uri data, String type) {
        this.data = data;
        this.type = type;
        return this;
    }

    public int getFlags() {
        return flags;
    }

    public Intent setFlags(int flags) {
        this.flags = flags;
        return this;
    }

    public Intent addFlags(int flags) {
        this.flags |= flags;
        return this;
    }

    public Intent putExtra(String name, String value) {
        extras.putString(name, value);
        return this;
    }

    public Intent putExtra(String name, int value) {
        extras.putInt(name, value);
        return this;
    }

    public Intent putExtra(String name, boolean value) {
        extras.putBoolean(name, value);
        return this;
    }

    public String getStringExtra(String name) {
        return extras.getString(name);
    }

    public int getIntExtra(String name, int defaultValue) {
        return extras.getInt(name, defaultValue);
    }

    public boolean getBooleanExtra(String name, boolean defaultValue) {
        return extras.getBoolean(name, defaultValue);
    }

    public Bundle getExtras() {
        return extras;
    }

    /** Android's own helper; returns an Intent rather than doing anything. */
    public static Intent createChooser(Intent target, CharSequence title) {
        return target;
    }

    @Override
    public String toString() {
        return "Intent { action=" + action + " data=" + data + " }";
    }
}
