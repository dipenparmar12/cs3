package android.app;

import android.content.Context;
import android.content.UnsupportedAndroidApiException;
import android.view.View;
import android.view.Window;

/**
 * {@code android.app.Activity} — the base of the chain that ends at
 * {@code androidx.appcompat.app.AppCompatActivity}, which 23 load failures in
 * the corpus named.
 *
 * <p>Extends {@link Context} exactly as Android's does (through
 * {@code ContextThemeWrapper}, collapsed here). That inheritance is the point:
 * extensions write {@code context as AppCompatActivity} inside {@code load()},
 * and a cast is only legal between types on one chain. Breaking the chain would
 * replace a {@code NoClassDefFoundError} with a {@code ClassCastException} —
 * still fatal, and harder to read.
 *
 * <p>The cast itself will fail at runtime, and that is correct. The Context the
 * host hands a plugin is a scoped storage token, not an Activity, because there
 * is no Activity. What this class buys is that the failure happens on the line
 * that reaches for the UI rather than at class load, so the provider half of the
 * archive — the half that scrapes — loads and runs.
 */
public class Activity extends Context {

    public static final int RESULT_OK = -1;
    public static final int RESULT_CANCELED = 0;

    /**
     * Carries the plugin's own scoped storage down the chain.
     *
     * The Context the host hands a plugin *is* an Activity — see
     * {@link android.content.PluginHostContext} for why — so this constructor is
     * on the live path and must pass the real scope through. An Activity that
     * quietly reset it would give the plugin a second, empty preferences store
     * that reads back nothing it wrote.
     */
    protected Activity(String pluginId, java.nio.file.Path scopedDir) {
        super(pluginId, scopedDir);
    }

    public boolean isFinishing() {
        throw new UnsupportedAndroidApiException("android.app.Activity.isFinishing");
    }

    public boolean isDestroyed() {
        throw new UnsupportedAndroidApiException("android.app.Activity.isDestroyed");
    }

    public void finish() {
        throw new UnsupportedAndroidApiException("android.app.Activity.finish");
    }

    public Window getWindow() {
        throw new UnsupportedAndroidApiException("android.app.Activity.getWindow");
    }

    public <T extends View> T findViewById(int id) {
        throw new UnsupportedAndroidApiException("android.app.Activity.findViewById");
    }

    public void setContentView(int layoutResID) {
        throw new UnsupportedAndroidApiException("android.app.Activity.setContentView");
    }

    public void setContentView(View view) {
        throw new UnsupportedAndroidApiException("android.app.Activity.setContentView");
    }

    public void runOnUiThread(Runnable action) {
        throw new UnsupportedAndroidApiException("android.app.Activity.runOnUiThread");
    }

    public Activity getParent() {
        return null;
    }

    public String getLocalClassName() {
        return getClass().getName();
    }
}
