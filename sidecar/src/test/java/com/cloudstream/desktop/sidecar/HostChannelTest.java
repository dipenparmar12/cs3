package com.cloudstream.desktop.sidecar;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.*;

/**
 * The reverse channel, which carries the browser requests {@code WebViewResolver}
 * needs.
 *
 * <p>What is worth pinning here is not the happy path — that fails loudly — but
 * the three ways this can go wrong silently: a frame that is not valid JSON once
 * a scraped URL with a quote in it is spliced into it, a reply that arrives for a
 * call which has already given up, and an unavailable host that spends a full
 * browser timeout before admitting it was never listening.
 */
class HostChannelTest {

    /** Collects emitted frames and lets a test answer them. */
    private static final class Wire {
        /**
         * Synchronised because it is written by the calling thread and read by
         * the test's. An ArrayList here passes and then fails once a year on a
         * loaded machine, which is the worst possible test.
         */
        final List<String> frames = java.util.Collections.synchronizedList(new ArrayList<>());
        HostChannel channel;

        Wire() {
            channel = new HostChannel(frames::add);
            channel.setAvailable(true);
        }

        /** Answers the most recent frame the way the host would. */
        void answer(boolean ok, String json, String error) {
            Map<String, Object> frame = Json.parseObject(frames.get(frames.size() - 1));
            Map<String, Object> reply = new java.util.LinkedHashMap<>();
            reply.put("hostReply", frame.get("hostId"));
            reply.put("ok", ok);
            if (json != null) reply.put("json", json);
            if (error != null) reply.put("error", error);
            channel.complete(reply);
        }
    }

    @Test
    void emitsAWellFormedFrameEvenWhenTheParamsCarryQuotesAndNewlines() throws Exception {
        Wire wire = new Wire();
        // A real interceptUrl regex, which is exactly the kind of string that
        // breaks hand-assembled JSON: quotes, backslashes and braces.
        String params = "{\"url\":\"https://x.test/a?b=\\\"q\\\"\",\"regex\":\"\\\\.m3u8|/hls/\",\"timeoutMs\":1000}";

        Thread caller = new Thread(() -> {
            try {
                wire.channel.call("webview.resolve", params, 5_000);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        });
        caller.start();
        waitForFrame(wire);

        Map<String, Object> frame = Json.parseObject(wire.frames.get(0));
        assertEquals("webview.resolve", frame.get("hostCall"));
        assertNotNull(frame.get("hostId"));
        // The params must arrive as an object, not as a string containing one.
        assertInstanceOf(Map.class, frame.get("params"));
        @SuppressWarnings("unchecked")
        Map<String, Object> got = (Map<String, Object>) frame.get("params");
        assertEquals("https://x.test/a?b=\"q\"", got.get("url"));
        assertEquals("\\.m3u8|/hls/", got.get("regex"));

        wire.answer(true, "{\"ok\":true}", null);
        caller.join(5_000);
    }

    @Test
    void returnsTheHostsDocumentVerbatim() throws Exception {
        Wire wire = new Wire();
        String[] result = new String[1];
        Thread caller = new Thread(() -> {
            try {
                result[0] = wire.channel.call("webview.resolve", "{\"timeoutMs\":1000}", 5_000).json();
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        });
        caller.start();
        waitForFrame(wire);

        // Re-serialising this through the minimal writer is exactly the place a
        // field would go missing, so it must come back untouched.
        String document = "{\"ok\":true,\"request\":{\"url\":\"https://cdn.test/v.m3u8\"},\"extra\":[]}";
        wire.answer(true, document, null);
        caller.join(5_000);
        assertEquals(document, result[0]);
    }

    @Test
    void aReplyForACallThatAlreadyGaveUpIsDroppedRatherThanMisdelivered() throws Exception {
        Wire wire = new Wire();
        HostChannel.Reply timedOut = wire.channel.call("webview.resolve", "{}", 1_000);
        assertFalse(timedOut.ok());
        assertTrue(timedOut.error().contains("no answer"), timedOut.error());

        // The host answers late. Nothing is waiting, and completing a stale id
        // must not leak into the *next* call's future.
        assertTrue(wire.channel.complete(Map.of("hostReply", "h1", "ok", true, "json", "{}")));

        String[] second = new String[1];
        Thread caller = new Thread(() -> {
            try {
                second[0] = wire.channel.call("webview.resolve", "{}", 5_000).json();
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        });
        caller.start();
        waitForFrame(wire, 2);
        wire.answer(true, "{\"ok\":true,\"second\":true}", null);
        caller.join(5_000);
        assertEquals("{\"ok\":true,\"second\":true}", second[0]);
    }

    @Test
    void anUnavailableHostFailsAtOnceRatherThanAfterABrowserTimeout() throws Exception {
        HostChannel channel = new HostChannel(frame -> fail("nothing should be emitted: " + frame));
        long started = System.nanoTime();
        HostChannel.Reply reply = channel.call("webview.resolve", "{\"timeoutMs\":60000}", 60_000);
        long tookMs = (System.nanoTime() - started) / 1_000_000;

        assertFalse(reply.ok());
        assertTrue(tookMs < 1_000, "took " + tookMs + " ms");
        assertTrue(reply.error().contains("not offering a browser"), reply.error());
    }

    @Test
    void anOrdinaryRequestIsNotMistakenForAHostReply() {
        HostChannel channel = new HostChannel(frame -> { });
        assertFalse(channel.complete(Json.parseObject(
                "{\"id\":\"1\",\"method\":\"providerSearch\",\"params\":{}}")));
        // And a reply frame is claimed even when nobody is waiting for it, so the
        // reader loop does not go on to dispatch it as a method call.
        assertTrue(channel.complete(Json.parseObject("{\"hostReply\":\"h9\",\"ok\":true}")));
    }

    @Test
    void shutdownReleasesEveryCallStillWaiting() throws Exception {
        Wire wire = new Wire();
        CountDownLatch done = new CountDownLatch(1);
        HostChannel.Reply[] reply = new HostChannel.Reply[1];
        Thread caller = new Thread(() -> {
            try {
                reply[0] = wire.channel.call("webview.resolve", "{\"timeoutMs\":60000}", 60_000);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            } finally {
                done.countDown();
            }
        });
        caller.start();
        waitForFrame(wire);

        wire.channel.shutdown("stdin closed");
        assertTrue(done.await(5, TimeUnit.SECONDS), "the call outlived shutdown");
        assertFalse(reply[0].ok());
        assertEquals("stdin closed", reply[0].error());
    }

    private static void waitForFrame(Wire wire) throws InterruptedException {
        waitForFrame(wire, 1);
    }

    private static void waitForFrame(Wire wire, int count) throws InterruptedException {
        for (int i = 0; i < 200 && wire.frames.size() < count; i++) Thread.sleep(10);
        assertTrue(wire.frames.size() >= count, "no frame was emitted");
    }
}
