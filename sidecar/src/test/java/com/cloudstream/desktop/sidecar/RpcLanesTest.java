package com.cloudstream.desktop.sidecar;

import org.junit.jupiter.api.Test;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.*;

/**
 * A source lookup does not wait behind background work.
 *
 * <p>The failure this pins was silent: with one pool, a search fan-out or a
 * home screen's catalogue rows held every worker and a Play press's
 * {@code loadLinks} queued behind them, spending its own deadline in the queue.
 * Nothing failed loudly; playback was just slow, and the wait was charged to
 * the provider.
 */
class RpcLanesTest {

    private static RpcLanes lanes() {
        return new RpcLanes(1, r -> daemon(r, "sources"), r -> daemon(r, "background"));
    }

    private static Thread daemon(Runnable r, String name) {
        Thread t = new Thread(r, name);
        t.setDaemon(true);
        return t;
    }

    @Test
    void whatAPersonWaitsOnToWatchIsTheSourcesLane() {
        assertEquals(RpcLanes.Lane.SOURCES, RpcLanes.laneFor("providerLoadLinks"));
        assertEquals(RpcLanes.Lane.SOURCES, RpcLanes.laneFor("providerLoad"));
        assertEquals(RpcLanes.Lane.SOURCES, RpcLanes.laneFor("ping"), "a health check must not wait behind a scrape");
        assertEquals(RpcLanes.Lane.BACKGROUND, RpcLanes.laneFor("providerSearch"));
        assertEquals(RpcLanes.Lane.BACKGROUND, RpcLanes.laneFor("providerMainPage"));
        assertEquals(RpcLanes.Lane.SOURCES, RpcLanes.laneFor("load"), "activating a provider comes before its links");
        assertEquals(RpcLanes.Lane.BACKGROUND, RpcLanes.laneFor("inspect"));
        assertEquals(RpcLanes.Lane.BACKGROUND, RpcLanes.laneFor("providerMainPageSections"));
        assertEquals(RpcLanes.Lane.BACKGROUND, RpcLanes.laneFor(""), "an unknown method is not given priority");
    }

    @Test
    void aSaturatedBackgroundLaneDoesNotDelayASourceLookup() throws Exception {
        RpcLanes lanes = lanes();
        CountDownLatch release = new CountDownLatch(1);
        try {
            // Every background worker held by a scrape that has not answered.
            lanes.submit("providerSearch", () -> release.await(10, TimeUnit.SECONDS));
            RpcLanes.Submitted<Boolean> queuedSearch = lanes.submit("providerMainPage", () -> true);

            RpcLanes.Submitted<String> links = lanes.submit("providerLoadLinks", () -> "links");
            assertEquals("links", links.future.get(2, TimeUnit.SECONDS));
            assertTrue(links.queuedMs() < 1_000, "queued " + links.queuedMs() + " ms behind background work");

            // The background call behind the scrape did wait, and says so.
            Thread.sleep(150);
            assertFalse(queuedSearch.future.isDone());
            assertTrue(queuedSearch.queuedMs() >= 100, "an unstarted call reports the wait so far");
            release.countDown();
            assertTrue(queuedSearch.future.get(2, TimeUnit.SECONDS));
        } finally {
            release.countDown();
            lanes.shutdownNow();
        }
    }

    @Test
    void aCallThatStartsAtOnceReportsNoQueueing() throws Exception {
        RpcLanes lanes = lanes();
        try {
            RpcLanes.Submitted<Integer> call = lanes.submit("providerLoad", () -> 1);
            assertEquals(1, call.future.get(2, TimeUnit.SECONDS));
            assertTrue(call.queuedMs() < 500);
        } finally {
            lanes.shutdownNow();
        }
    }
}
