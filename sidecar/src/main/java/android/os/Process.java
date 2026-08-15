package android.os;

import android.content.UnsupportedAndroidApiException;

/**
 * Android's process utilities.
 *
 * Another link in the chain that kept Kraptor123/cs-kraptor (65 plugins) from
 * loading at all. Referenced during `load`, so the class has to exist even
 * though almost nothing here does anything: verification resolves every type a
 * method body names.
 *
 * The split is deliberate. Reading identity is harmless and answering honestly
 * is better than throwing — a plugin that just wants a pid for a log line should
 * get one. Everything that *changes* process state is refused, and
 * {@link #killProcess} is the reason this file has a comment at all: a plugin
 * calling `Process.killProcess(Process.myPid())` on Android restarts CloudStream,
 * while here it would take down the sidecar and every other extension running in
 * it. The process boundary already means the app survives (DROP-26), but the
 * other plugins would not, so it is refused rather than honoured.
 */
public final class Process {

    /** Android's thread-priority constants, read by extensions that set them. */
    public static final int THREAD_PRIORITY_DEFAULT = 0;
    public static final int THREAD_PRIORITY_BACKGROUND = 10;
    public static final int THREAD_PRIORITY_FOREGROUND = -2;

    private Process() {
    }

    public static int myPid() {
        return (int) ProcessHandle.current().pid();
    }

    /** Android returns the app's UID. There is no such concept here. */
    public static int myUid() {
        return 0;
    }

    public static long getElapsedCpuTime() {
        return ProcessHandle.current()
                .info()
                .totalCpuDuration()
                .map(java.time.Duration::toMillis)
                .orElse(0L);
    }

    /**
     * Accepted and ignored.
     *
     * Thread priority is advisory even on Android, and a plugin that sets itself
     * to background priority is expressing a preference, not depending on an
     * outcome. Throwing here would fail a `load` over something that does not
     * matter.
     */
    public static void setThreadPriority(int priority) {
        // Intentionally empty; see above.
    }

    public static void killProcess(int pid) {
        throw new UnsupportedAndroidApiException(
                "android.os.Process.killProcess — an extension cannot terminate the runtime it shares with every other extension");
    }
}
