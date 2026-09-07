package android.app;

import android.content.Context;
import java.nio.file.Paths;

/**
 * The process-wide Context, present so that extensions which register lifecycle
 * callbacks can link.
 *
 * Ultima reaches this during {@code load()} — not to do anything with the
 * application, but to register an
 * {@link Application.ActivityLifecycleCallbacks} so its settings screen can
 * follow the host's activity stack. On desktop there are no activities to
 * follow, so the registration is accepted and the callbacks are never invoked.
 *
 * <p>Accepting is the right answer rather than throwing: this is a fire-and-
 * forget registration made before the provider is registered, and refusing it
 * costs the extension every provider it was about to add. A callback that never
 * fires is indistinguishable from an app whose activities never change, which
 * is exactly what is true here.
 */
public class Application extends Context {

    /**
     * Nested upstream and referenced as
     * {@code android/app/Application$ActivityLifecycleCallbacks}, so it stays
     * nested and stays an interface — extensions implement it, and an abstract
     * class here would fail to link against their {@code implements} clause.
     */
    public interface ActivityLifecycleCallbacks {
        default void onActivityCreated(Activity activity, android.os.Bundle savedInstanceState) { }
        default void onActivityStarted(Activity activity) { }
        default void onActivityResumed(Activity activity) { }
        default void onActivityPaused(Activity activity) { }
        default void onActivityStopped(Activity activity) { }
        default void onActivitySaveInstanceState(Activity activity, android.os.Bundle outState) { }
        default void onActivityDestroyed(Activity activity) { }
    }

    /** Registered upstream for low-memory and configuration signals. */
    public interface ActivityLifecycleCallbacksCompat extends ActivityLifecycleCallbacks { }

    public Application() {
        super("application", Paths.get(System.getProperty("java.io.tmpdir"), "cs3-plugin-app"));
    }

    protected Application(String pluginId, java.nio.file.Path scopedDir) {
        super(pluginId, scopedDir);
    }

    /** Accepted and dropped; there are no activities to report on. */
    public void registerActivityLifecycleCallbacks(ActivityLifecycleCallbacks callback) { }

    public void unregisterActivityLifecycleCallbacks(ActivityLifecycleCallbacks callback) { }

    public void onCreate() { }

    public void onTerminate() { }

    public void onLowMemory() { }

    public void onTrimMemory(int level) { }
}
