package android.view;

import android.content.Context;
import android.content.UnsupportedAndroidApiException;

/**
 * {@code android.view.View} — a type that exists so other types can link.
 *
 * <p>This is the root of the shim's UI closure and the reason that closure is
 * needed at all. An extension's settings screen overrides
 * {@code onCreateView(LayoutInflater, ViewGroup, Bundle): View}, and a class
 * cannot be defined while any type in a method it declares is unresolvable. So
 * {@code View}, {@link ViewGroup} and {@link LayoutInflater} have to be present
 * for the *provider* half of that same archive to load — the scraping code and
 * the settings dialog ship in one jar.
 *
 * <p>Every member throws. There is no view system on desktop and there is no
 * useful approximation of one: a stub that silently accepted layout calls would
 * let an extension believe it had drawn a settings screen the user will never
 * see. {@link UnsupportedAndroidApiException} is classified as
 * {@code UNSUPPORTED_ANDROID_API}, which demotes the plugin's tier rather than
 * reporting a crash — the accurate description of an extension whose scraping
 * works and whose settings UI does not.
 *
 * <p>The host never calls into any of this. Nothing invokes an extension's
 * {@code openSettings}, so these methods are reached only if an extension builds
 * views during {@code load()}, which is itself a bug on any platform.
 */
public class View {

    public static final int VISIBLE = 0;
    public static final int INVISIBLE = 4;
    public static final int GONE = 8;

    /** Android's "let the framework pick an id" sentinel; extensions compare to it. */
    public static final int NO_ID = -1;

    /**
     * Android declares these as nested interfaces and extensions implement them
     * inline. They have to be nested here, with these exact names, or the
     * extension's own listener classes fail to link.
     */
    public interface OnClickListener {
        void onClick(View v);
    }

    public interface OnLongClickListener {
        boolean onLongClick(View v);
    }

    public interface OnFocusChangeListener {
        void onFocusChange(View v, boolean hasFocus);
    }

    public interface OnTouchListener {
        boolean onTouch(View v, MotionEvent event);
    }

    public interface OnKeyListener {
        boolean onKey(View v, int keyCode, KeyEvent event);
    }

    public View() {
    }

    public View(Context context) {
    }

    public Context getContext() {
        throw new UnsupportedAndroidApiException("android.view.View.getContext");
    }

    public <T extends View> T findViewById(int id) {
        throw new UnsupportedAndroidApiException("android.view.View.findViewById");
    }

    public void setVisibility(int visibility) {
        throw new UnsupportedAndroidApiException("android.view.View.setVisibility");
    }

    public int getVisibility() {
        throw new UnsupportedAndroidApiException("android.view.View.getVisibility");
    }

    public void setOnClickListener(OnClickListener listener) {
        throw new UnsupportedAndroidApiException("android.view.View.setOnClickListener");
    }

    public void setOnLongClickListener(OnLongClickListener listener) {
        throw new UnsupportedAndroidApiException("android.view.View.setOnLongClickListener");
    }

    public void setOnFocusChangeListener(OnFocusChangeListener listener) {
        throw new UnsupportedAndroidApiException("android.view.View.setOnFocusChangeListener");
    }

    public void setOnTouchListener(OnTouchListener listener) {
        throw new UnsupportedAndroidApiException("android.view.View.setOnTouchListener");
    }

    public void setEnabled(boolean enabled) {
        throw new UnsupportedAndroidApiException("android.view.View.setEnabled");
    }

    public boolean isEnabled() {
        throw new UnsupportedAndroidApiException("android.view.View.isEnabled");
    }

    public void setId(int id) {
        throw new UnsupportedAndroidApiException("android.view.View.setId");
    }

    public int getId() {
        throw new UnsupportedAndroidApiException("android.view.View.getId");
    }

    public void setTag(Object tag) {
        throw new UnsupportedAndroidApiException("android.view.View.setTag");
    }

    public Object getTag() {
        throw new UnsupportedAndroidApiException("android.view.View.getTag");
    }

    public void setBackgroundColor(int color) {
        throw new UnsupportedAndroidApiException("android.view.View.setBackgroundColor");
    }

    public void requestFocus() {
        throw new UnsupportedAndroidApiException("android.view.View.requestFocus");
    }

    public void invalidate() {
        throw new UnsupportedAndroidApiException("android.view.View.invalidate");
    }

    public boolean post(Runnable action) {
        throw new UnsupportedAndroidApiException("android.view.View.post");
    }
}
