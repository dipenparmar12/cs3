package com.cloudstream.desktop.sidecar;

import java.util.Set;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.ThreadFactory;

/**
 * Which workers run an RPC, so a source lookup never queues behind background
 * work.
 *
 * <p>Every call used to share one bounded pool, in arrival order. A search
 * fan-out (eight providers at a time, each a scrape of up to a minute), a home
 * screen's catalogue rows or an extension update's translation could hold every
 * worker, and the {@code loadLinks} a Play press or an open detail page was
 * waiting on queued behind them. Its deadline runs from submission, here and in
 * the supervisor, so it could time out without ever starting, and the wait was
 * charged to the provider as latency.
 *
 * <p>Two lanes, each as large as the old pool: one for what a person is waiting
 * on to watch something, and for the cheap control calls (a health check must
 * not wait behind a scrape); one for everything else. Each call reports how long
 * it queued, so the host can see contention instead of inferring it.
 */
final class RpcLanes {

    enum Lane { SOURCES, BACKGROUND }

    /**
     * {@code load} is here because it is how a provider is activated, and a
     * detail page reopened from the library after a restart activates its
     * provider before it can ask for anything. Installs reach it too, but the
     * host runs those one at a time, and a search's activations are capped at
     * its eight in flight, so the lane keeps workers for {@code loadLinks}.
     */
    private static final Set<String> SOURCE_METHODS = Set.of(
            "providerLoad", "providerLoadLinks", "load",
            "ping", "status", "hostCapabilities", "providers");

    static Lane laneFor(String method) {
        return SOURCE_METHODS.contains(method) ? Lane.SOURCES : Lane.BACKGROUND;
    }

    /** A call handed to a lane, and how long it waited for a worker. */
    static final class Submitted<T> {
        final Future<T> future;
        private final long submittedAt = System.nanoTime();
        private volatile long startedAt = -1;

        private Submitted(ExecutorService pool, Callable<T> work) {
            this.future = pool.submit(() -> {
                startedAt = System.nanoTime();
                return work.call();
            });
        }

        /** Until it starts, the whole time so far: a call that timed out queued. */
        long queuedMs() {
            long started = startedAt;
            long end = started < 0 ? System.nanoTime() : started;
            return (end - submittedAt) / 1_000_000;
        }
    }

    private final ExecutorService sources;
    private final ExecutorService background;

    RpcLanes(int threadsPerLane, ThreadFactory sourcesThreads, ThreadFactory backgroundThreads) {
        this.sources = Executors.newFixedThreadPool(threadsPerLane, sourcesThreads);
        this.background = Executors.newFixedThreadPool(threadsPerLane, backgroundThreads);
    }

    <T> Submitted<T> submit(String method, Callable<T> work) {
        return new Submitted<>(laneFor(method) == Lane.SOURCES ? sources : background, work);
    }

    void shutdownNow() {
        sources.shutdownNow();
        background.shutdownNow();
    }
}
