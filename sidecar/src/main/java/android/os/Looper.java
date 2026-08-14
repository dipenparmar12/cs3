package android.os;

/**
 * A token identifying which thread a {@link Handler} posts to.
 *
 * There is no message loop behind it. On desktop the sidecar has no UI thread
 * to be "main", and nothing a provider posts needs to run on any particular
 * one — the work is scraping, not drawing. What matters is that
 * {@code Looper.getMainLooper()} resolves and returns something non-null,
 * because {@code Handler(Looper.getMainLooper())} is how essentially every
 * Android class that defers work is constructed, and a null here turns into an
 * NPE inside the plugin rather than a named failure.
 */
public final class Looper {

    private static final Looper MAIN = new Looper("main");

    private final String name;

    private Looper(String name) {
        this.name = name;
    }

    public static Looper getMainLooper() {
        return MAIN;
    }

    /**
     * Android returns null off a looper thread. Returning the shared instance
     * instead keeps `Handler(Looper.myLooper()!!)` — which is idiomatic Kotlin
     * and would otherwise throw on the `!!` — working.
     */
    public static Looper myLooper() {
        return MAIN;
    }

    public Thread getThread() {
        return Thread.currentThread();
    }

    public boolean isCurrentThread() {
        return true;
    }

    /** Nothing to quit; the executor behind {@link Handler} is shared. */
    public void quit() { }

    public void quitSafely() { }

    @Override
    public String toString() {
        return "Looper(" + name + ")";
    }
}
