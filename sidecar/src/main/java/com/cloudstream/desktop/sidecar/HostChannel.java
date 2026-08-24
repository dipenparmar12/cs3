package com.cloudstream.desktop.sidecar;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.Consumer;

/**
 * The stdio protocol, run backwards: the sidecar asks and the main process answers.
 *
 * <p>Every other call in this process goes main → sidecar. This is the one that
 * does not, and it exists for a single reason: {@code WebViewResolver} needs a
 * browser. Android borrows the system WebView; here the browser is Chromium, and
 * Chromium is in the Electron process, not this one. The JVM had no way to ask
 * for it — {@code Main} dispatches methods the host calls and has never had a
 * channel back — so a provider that needs a browser could only throw.
 *
 * <h2>Framing</h2>
 * Two new frame shapes, both distinguished by a key rather than a version field,
 * so a host and a sidecar of different vintages still understand each other's
 * old frames:
 *
 * <pre>
 *   sidecar → host   {"hostCall":"webview.resolve","hostId":"h1","params":{…}}
 *   host → sidecar   {"hostReply":"h1","ok":true,"json":"…"}
 * </pre>
 *
 * The reply carries its payload as a JSON <em>string</em> under {@code json}
 * rather than as a nested object. That is the same choice {@code providerLoad}
 * makes in the other direction and for the same reason: the payload is already a
 * document shaped for its consumer, and re-parsing it through this minimal
 * writer would only add a place to lose fields.
 *
 * <h2>Replies complete on the reader thread, and that is not an optimisation</h2>
 * {@code Main} runs plugin calls on a <em>bounded</em> pool. A provider that
 * calls out to the browser occupies one of those threads for as long as the
 * challenge takes. If completing a host reply also needed a pool thread, then
 * enough concurrent resolves would fill the pool with threads each waiting for a
 * reply that no remaining thread was free to deliver — a deadlock that appears
 * only under load, which is to say only in front of a user. So
 * {@link #complete} is called inline from the stdin reader loop and does nothing
 * but hand a value to a future.
 */
public final class HostChannel {

    /**
     * How long a host call may take before the sidecar stops waiting.
     *
     * Generous because the thing on the other end is a real browser solving a
     * real interstitial, and upstream's own WebView timeout is 60s. The caller
     * passes its own deadline; this is only the ceiling.
     */
    public static final long MAX_WAIT_MS = 180_000;

    private final Consumer<String> emitter;
    private final Map<String, CompletableFuture<Reply>> pending = new ConcurrentHashMap<>();
    private final AtomicLong nextId = new AtomicLong(1);

    /**
     * Set once the host has told us it can service reverse calls. Until then
     * every call fails immediately with a reason rather than spending its
     * timeout waiting for a process that was never listening — an older host, or
     * one whose window has gone.
     */
    private volatile boolean available;

    public HostChannel(Consumer<String> emitter) {
        this.emitter = emitter;
    }

    /** One answer from the host: either a JSON document or a reason there is none. */
    public record Reply(boolean ok, String json, String error) {
        public static Reply failed(String message) {
            return new Reply(false, null, message);
        }
    }

    public void setAvailable(boolean available) {
        this.available = available;
    }

    public boolean isAvailable() {
        return available;
    }

    /**
     * Asks the host to do something, and waits.
     *
     * <p>Never throws for a host-side failure: an unreachable host, a timeout and
     * a browser that found nothing are all outcomes the caller has to render.
     * The one thing it does propagate is interruption, because that is this
     * call being cancelled rather than the host failing — {@code withTimeout}
     * in the bridge cancels by interrupting, and swallowing it would leave a
     * cancelled coroutine running.
     */
    public Reply call(String method, String paramsJson, long timeoutMs) throws InterruptedException {
        if (!available) {
            return Reply.failed(
                    "The desktop app is not offering a browser to this runtime, so " + method
                            + " cannot be served. Extensions that need one will report no results.");
        }

        String id = "h" + nextId.getAndIncrement();
        CompletableFuture<Reply> future = new CompletableFuture<>();
        pending.put(id, future);

        // Built by hand rather than through Json.write because `params` is
        // already JSON: handing it to the writer would escape it into a string
        // and the host would receive a quoted document instead of an object.
        StringBuilder frame = new StringBuilder(paramsJson.length() + 64);
        frame.append("{\"hostCall\":");
        Json.writeTo(frame, method);
        frame.append(",\"hostId\":");
        Json.writeTo(frame, id);
        frame.append(",\"params\":")
             .append(paramsJson == null || paramsJson.isBlank() ? "{}" : paramsJson)
             .append('}');

        try {
            emitter.accept(frame.toString());
        } catch (RuntimeException e) {
            pending.remove(id);
            return Reply.failed("Could not reach the desktop app: " + e);
        }

        long wait = Math.min(Math.max(1_000, timeoutMs), MAX_WAIT_MS);
        try {
            return future.get(wait, TimeUnit.MILLISECONDS);
        } catch (TimeoutException e) {
            return Reply.failed(method + " got no answer from the desktop app within " + wait + " ms.");
        } catch (java.util.concurrent.ExecutionException e) {
            return Reply.failed(Main.describe(e.getCause() == null ? e : e.getCause()));
        } finally {
            pending.remove(id);
        }
    }

    /**
     * Delivers one {@code hostReply} frame. Called on the stdin reader thread —
     * see the class comment for why it must never need a worker.
     *
     * @return whether the frame was a host reply at all, so the caller knows
     *         whether to go on and treat the line as an ordinary request.
     */
    public boolean complete(Map<String, Object> frame) {
        Object marker = frame.get("hostReply");
        if (marker == null) return false;

        CompletableFuture<Reply> future = pending.remove(String.valueOf(marker));
        // A reply with nobody waiting is the normal shape of a call that has
        // already timed out. Dropping it is correct; the caller has moved on.
        if (future == null) return true;

        boolean ok = Boolean.TRUE.equals(frame.get("ok"));
        String json = frame.get("json") == null ? null : String.valueOf(frame.get("json"));
        String error = frame.get("error") == null ? null : String.valueOf(frame.get("error"));
        future.complete(new Reply(ok, json, ok ? null : error));
        return true;
    }

    /** Fails everything outstanding, for when stdin closes with calls in flight. */
    public void shutdown(String reason) {
        for (Map.Entry<String, CompletableFuture<Reply>> e : pending.entrySet()) {
            e.getValue().complete(Reply.failed(reason));
        }
        pending.clear();
    }

    /** Debug aid for {@code status}; not part of the protocol. */
    public Map<String, Object> describe() {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("available", available);
        m.put("inFlight", pending.size());
        return m;
    }
}
