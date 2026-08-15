package android.app;

import java.util.Collections;
import java.util.List;

/**
 * The one system service the corpus actually asks for, and it asks about memory.
 *
 * Extensions use this to size buffers and to decide whether to run a heavier
 * extraction path — StreamPlay reads {@code MemoryInfo} in {@code load()}
 * before it registers anything. That makes this a load-path type: it has to
 * exist, and {@code getMemoryInfo} has to give a usable answer, or the
 * extension is lost before it starts.
 *
 * <p>The numbers are real. They describe this JVM and this machine rather than
 * a phone, which is the honest thing to report and also the useful one — an
 * extension sizing a buffer against a fabricated 2 GB would size it wrongly.
 * DROP-9: never tell plugin code something false about its platform.
 *
 * <p>Everything that would act on the device rather than describe it stays
 * unimplemented.
 */
public class ActivityManager {

    /**
     * Mirrors {@code android.app.ActivityManager.MemoryInfo}, whose fields are
     * public and read directly rather than through accessors — so they have to
     * be fields here too, with the same names and types.
     */
    public static class MemoryInfo {
        public long availMem;
        public long totalMem;
        public long threshold;
        public boolean lowMemory;
    }

    /**
     * Fills in the caller's {@code MemoryInfo}, Android-style — the argument is
     * mutated and nothing is returned.
     */
    public void getMemoryInfo(MemoryInfo outInfo) {
        if (outInfo == null) return;
        Runtime runtime = Runtime.getRuntime();
        long max = runtime.maxMemory();
        long used = runtime.totalMemory() - runtime.freeMemory();
        outInfo.totalMem = max;
        outInfo.availMem = Math.max(0L, max - used);
        // Android's threshold is the point at which it starts killing
        // background processes. An eighth of the heap is the same shape of
        // signal for a JVM and keeps `lowMemory` meaningful.
        outInfo.threshold = max / 8;
        outInfo.lowMemory = outInfo.availMem < outInfo.threshold;
    }

    public int getMemoryClass() {
        return (int) Math.max(1, Runtime.getRuntime().maxMemory() / (1024 * 1024));
    }

    public int getLargeMemoryClass() {
        return getMemoryClass();
    }

    public static boolean isUserAMonkey() {
        return false;
    }

    public boolean isLowRamDevice() {
        return false;
    }

    /**
     * Empty rather than unimplemented.
     *
     * A plugin enumerating running processes on the host is asking about the
     * user's machine, not about itself, and the sidecar does not hand that
     * over. An empty list is what an unprivileged Android app has received
     * since API 24, so the shape is the platform's own and the loops that read
     * it simply iterate nothing.
     */
    public List<Object> getRunningAppProcesses() {
        return Collections.emptyList();
    }

    public List<Object> getRunningServices(int maxNum) {
        return Collections.emptyList();
    }
}
