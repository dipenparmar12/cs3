package android.os;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;

/**
 * Runs what a provider defers, instead of refusing to.
 *
 * This is a shim that <em>works</em> rather than one that throws, and the
 * reason is what the corpus uses it for. A `Handler` in an extension is almost
 * never about the UI thread — it is `postDelayed` for a retry backoff, a
 * debounce around a search box, or a timeout guard around an extractor. Those
 * are ordinary scheduling and the JVM does them perfectly well, so refusing
 * would break working scraper code to make a point about a platform difference
 * that does not exist here.
 *
 * <p>Ultima was lost at `load()` to nothing more than the type being absent.
 *
 * <h2>What is deliberately not reproduced</h2>
 * Android guarantees that everything posted to one `Handler` runs in order on
 * one thread. A pool would break that, and code written against a Looper is
 * entitled to assume it — so every handler gets a single-threaded executor and
 * the guarantee holds. The threads are daemons: a plugin that schedules a
 * repeating task and never cancels it must not keep the sidecar alive.
 *
 * <p>Message-based dispatch ({@code sendMessage}, {@code handleMessage}) is
 * accepted and delivered, but a `Message` carries no target-driven behaviour
 * beyond its callback and `what`, which is all the corpus reads.
 */
public class Handler {

    private final ScheduledExecutorService executor;
    private final Callback callback;

    /**
     * Tracks scheduled work so {@code removeCallbacks} can cancel it. Keyed by
     * the Runnable identity, exactly as Android keys by the message target.
     */
    private final Map<Runnable, ScheduledFuture<?>> scheduled = new ConcurrentHashMap<>();

    public interface Callback {
        boolean handleMessage(Message msg);
    }

    public Handler() {
        this(null, null);
    }

    public Handler(Looper looper) {
        this(looper, null);
    }

    public Handler(Callback callback) {
        this(null, callback);
    }

    public Handler(Looper looper, Callback callback) {
        this.callback = callback;
        this.executor = Executors.newSingleThreadScheduledExecutor(r -> {
            Thread t = new Thread(r, "cs3-plugin-handler");
            t.setDaemon(true);
            return t;
        });
    }

    public static Handler createAsync(Looper looper) {
        return new Handler(looper);
    }

    public final Looper getLooper() {
        return Looper.getMainLooper();
    }

    public final boolean post(Runnable r) {
        return postDelayed(r, 0L);
    }

    public final boolean postAtFrontOfQueue(Runnable r) {
        return postDelayed(r, 0L);
    }

    /**
     * Android's `postAtTime` takes an uptime, not a delay. Converting through
     * {@code SystemClock.uptimeMillis} would need a clock shim for no gain, so
     * the difference against wall time is used and clamped at zero — a task
     * scheduled for a moment that has passed runs now, which is what Android
     * does too.
     */
    public final boolean postAtTime(Runnable r, long uptimeMillis) {
        return postDelayed(r, uptimeMillis - System.currentTimeMillis());
    }

    public final boolean postDelayed(Runnable r, long delayMillis) {
        if (r == null) return false;
        try {
            ScheduledFuture<?> future = executor.schedule(() -> {
                scheduled.remove(r);
                try {
                    r.run();
                } catch (Throwable t) {
                    // A plugin's deferred work throwing must not kill the
                    // executor thread and silently stop every later post.
                    System.err.println("[cs3-shim] Handler task threw: " + t);
                }
            }, Math.max(0L, delayMillis), TimeUnit.MILLISECONDS);
            scheduled.put(r, future);
            return true;
        } catch (RuntimeException e) {
            // Executor already shut down.
            return false;
        }
    }

    public final void removeCallbacks(Runnable r) {
        if (r == null) return;
        ScheduledFuture<?> future = scheduled.remove(r);
        if (future != null) future.cancel(false);
    }

    public final void removeCallbacksAndMessages(Object token) {
        for (Map.Entry<Runnable, ScheduledFuture<?>> entry : scheduled.entrySet()) {
            entry.getValue().cancel(false);
        }
        scheduled.clear();
    }

    public final boolean hasCallbacks(Runnable r) {
        return r != null && scheduled.containsKey(r);
    }

    // --- message-shaped API --------------------------------------------------

    public final Message obtainMessage() {
        return new Message();
    }

    public final Message obtainMessage(int what) {
        Message m = new Message();
        m.what = what;
        return m;
    }

    public final Message obtainMessage(int what, Object obj) {
        Message m = obtainMessage(what);
        m.obj = obj;
        return m;
    }

    public final boolean sendMessage(Message msg) {
        return sendMessageDelayed(msg, 0L);
    }

    public final boolean sendEmptyMessage(int what) {
        return sendMessage(obtainMessage(what));
    }

    public final boolean sendEmptyMessageDelayed(int what, long delayMillis) {
        return sendMessageDelayed(obtainMessage(what), delayMillis);
    }

    public final boolean sendMessageDelayed(Message msg, long delayMillis) {
        if (msg == null) return false;
        return postDelayed(() -> dispatchMessage(msg), delayMillis);
    }

    public void dispatchMessage(Message msg) {
        if (msg.callback != null) {
            msg.callback.run();
            return;
        }
        if (callback != null && callback.handleMessage(msg)) return;
        handleMessage(msg);
    }

    /** Overridden by plugin subclasses; the base does nothing, as on Android. */
    public void handleMessage(Message msg) { }

    public final void removeMessages(int what) {
        removeCallbacksAndMessages(null);
    }

    public final boolean hasMessages(int what) {
        return !scheduled.isEmpty();
    }
}
