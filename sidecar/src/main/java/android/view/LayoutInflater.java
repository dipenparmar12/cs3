package android.view;

import android.content.Context;
import android.content.UnsupportedAndroidApiException;

/**
 * {@code android.view.LayoutInflater} — the first parameter of
 * {@code onCreateView}, and present so that method's descriptor resolves.
 *
 * <p>Inflation itself is genuinely impossible here, not merely unimplemented: it
 * reads a compiled binary XML layout out of the archive's resource table, and
 * {@code android.content.res.Resources} is a stub for the same reason —
 * {@code aapt2} output has no desktop reader. An extension built with
 * {@code requiresResources} has no settings UI on this platform, which is
 * exactly what {@code T3_DEGRADED} records.
 */
public abstract class LayoutInflater {

    protected LayoutInflater() {
    }

    public static LayoutInflater from(Context context) {
        throw new UnsupportedAndroidApiException("android.view.LayoutInflater.from");
    }

    public View inflate(int resource, ViewGroup root) {
        throw new UnsupportedAndroidApiException("android.view.LayoutInflater.inflate");
    }

    public View inflate(int resource, ViewGroup root, boolean attachToRoot) {
        throw new UnsupportedAndroidApiException("android.view.LayoutInflater.inflate");
    }

    public Context getContext() {
        throw new UnsupportedAndroidApiException("android.view.LayoutInflater.getContext");
    }
}
