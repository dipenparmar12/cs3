package com.cloudstream.desktop.sidecar;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.*;
import java.util.concurrent.*;

/**
 * The JVM sidecar's entry point: a line-delimited JSON-RPC server over stdio.
 *
 * <p>Framing is one JSON object per line on stdout. Everything else the process
 * writes — plugin logs, JVM warnings, stack traces — goes to stderr, because a
 * single stray {@code println} from plugin code would otherwise desynchronise
 * the channel.
 *
 * <p>Every call runs on a bounded worker pool with a hard timeout (PLG-S-5). A
 * plugin that hangs fails its own call and leaves the rest of the sidecar
 * usable; a plugin that kills the JVM takes down only this process, and the
 * supervisor in the Electron main process restarts it (DROP-26, AC-D4).
 */
public final class Main {

    private static final long DEFAULT_TIMEOUT_MS = 60_000;

    private final PluginHost host;

    /** Runs plugin code. Bounded, because plugin calls are the expensive ones. */
    private final ExecutorService pool = Executors.newFixedThreadPool(
            Math.max(2, Runtime.getRuntime().availableProcessors()),
            daemonFactory("cs3-rpc-worker"));

    /**
     * Waits on results and enforces per-call timeouts.
     *
     * Deliberately a separate, unbounded pool. If waiters shared the bounded
     * worker pool, enough concurrent calls would fill it with threads blocked on
     * futures whose own work could never be scheduled — a deadlock that would
     * only appear under load.
     */
    private final ExecutorService waiters =
            Executors.newCachedThreadPool(daemonFactory("cs3-rpc-waiter"));

    private static ThreadFactory daemonFactory(String name) {
        return r -> {
            Thread t = new Thread(r, name);
            t.setDaemon(true);
            return t;
        };
    }

    /** stdout is the control channel and nothing else may write to it. */
    private final PrintStream out;

    private Main(PluginHost host, PrintStream out) {
        this.host = host;
        this.out = out;
    }

    public static void main(String[] args) throws Exception {
        Map<String, String> opts = parseArgs(args);
        Path dataDir = Paths.get(opts.getOrDefault("data-dir",
                System.getProperty("java.io.tmpdir") + "/cs3-sidecar"));
        Path classpathDir = Paths.get(opts.getOrDefault("runtime-classpath",
                dataDir.resolve("runtime").toString()));

        PrintStream stdout = new PrintStream(new java.io.FileOutputStream(java.io.FileDescriptor.out),
                true, StandardCharsets.UTF_8);
        // Redirect anything that reaches System.out — including from plugin code
        // — to stderr, so only framed RPC replies can reach the real stdout.
        System.setOut(new PrintStream(new java.io.FileOutputStream(java.io.FileDescriptor.err),
                true, StandardCharsets.UTF_8));

        DexTranslator translator = new DexTranslator(dataDir.resolve("translated"));
        PluginHost host = new PluginHost(translator, classpathDir);
        new Main(host, stdout).run();
    }

    private void run() throws IOException {
        try (BufferedReader in = new BufferedReader(
                new InputStreamReader(System.in, StandardCharsets.UTF_8))) {
            String line;
            while ((line = in.readLine()) != null) {
                if (line.isBlank()) continue;
                handle(line);
            }
        }

        // stdin has closed, but replies for already-accepted calls may still be
        // in flight. Shutting the pool down immediately would drop them, so the
        // queue is drained first and only then abandoned.
        waiters.shutdown();
        try {
            if (!waiters.awaitTermination(DEFAULT_TIMEOUT_MS, TimeUnit.MILLISECONDS)) {
                waiters.shutdownNow();
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            waiters.shutdownNow();
        }
        pool.shutdownNow();
    }

    private void handle(String line) {
        Map<String, Object> req;
        try {
            req = Json.parseObject(line);
        } catch (RuntimeException e) {
            emit(Map.of("id", "", "ok", false, "error", "Malformed request: " + e.getMessage()));
            return;
        }

        Object id = req.getOrDefault("id", "");
        String method = String.valueOf(req.getOrDefault("method", ""));
        @SuppressWarnings("unchecked")
        Map<String, Object> params = req.get("params") instanceof Map<?, ?> m
                ? (Map<String, Object>) m : Map.of();

        long timeout = params.get("timeoutMs") instanceof Number n
                ? n.longValue() : DEFAULT_TIMEOUT_MS;

        Future<Map<String, Object>> future = pool.submit(() -> dispatch(method, params));
        waiters.execute(() -> {
            Map<String, Object> reply = new LinkedHashMap<>();
            reply.put("id", id);
            try {
                reply.put("ok", true);
                reply.put("result", future.get(timeout, TimeUnit.MILLISECONDS));
            } catch (TimeoutException e) {
                future.cancel(true);
                reply.put("ok", false);
                reply.put("errorKind", "TIMEOUT");
                reply.put("error", method + " exceeded " + timeout + " ms and was abandoned.");
            } catch (ExecutionException e) {
                Throwable cause = e.getCause() == null ? e : e.getCause();
                reply.put("ok", false);
                reply.put("errorKind", errorKind(cause));
                reply.put("error", cause.getClass().getSimpleName() + ": " + cause.getMessage());
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                reply.put("ok", false);
                reply.put("errorKind", "INTERRUPTED");
                reply.put("error", "Call interrupted.");
            }
            emit(reply);
        });
    }

    /**
     * Classifies a failure so the host can act on it rather than just display it.
     * An unimplemented Android API in particular is a compatibility finding that
     * demotes the plugin's tier (DROP-7, DROP-28), not a generic error.
     */
    private static String errorKind(Throwable t) {
        for (Throwable c = t; c != null; c = c.getCause()) {
            String n = c.getClass().getName();
            if (n.equals("android.content.UnsupportedAndroidApiException")) return "UNSUPPORTED_ANDROID_API";
            if (c instanceof NoClassDefFoundError || c instanceof ClassNotFoundException) return "LINKAGE_FAILED";
            if (c instanceof OutOfMemoryError) return "OUT_OF_MEMORY";
            if (c instanceof StackOverflowError) return "STACK_OVERFLOW";
        }
        return "PLUGIN_ERROR";
    }

    private Map<String, Object> dispatch(String method, Map<String, Object> params) throws Exception {
        return switch (method) {
            case "ping" -> Map.of(
                    "pong", true,
                    "javaVersion", System.getProperty("java.version"),
                    "pid", ProcessHandle.current().pid());

            case "status" -> {
                Map<String, Object> m = new LinkedHashMap<>();
                m.put("canExecute", host.canExecute());
                m.put("reason", host.classpathProblem());
                m.put("loadedPlugins", host.loadedPluginIds());
                m.put("sandboxGaps", new ArrayList<>(PluginClassLoader.SANDBOX_GAPS));
                yield m;
            }

            // Translate and analyse without executing. Safe to run on install for
            // every plugin, and it is what produces the compatibility tier.
            case "inspect" -> host.install(
                    str(params, "pluginId"),
                    Paths.get(str(params, "path")));

            case "load" -> {
                PluginHost.Loaded l = host.load(str(params, "pluginId"), Paths.get(str(params, "path")));
                Map<String, Object> m = new LinkedHashMap<>();
                m.put("pluginId", l.pluginId());
                m.put("entryClass", l.entryClass());
                m.put("name", l.name());
                m.put("version", l.version());
                m.put("providers", l.providers());
                m.put("tier", l.linkage().tier());
                m.put("tierReason", l.linkage().tierReason());
                yield m;
            }

            case "unload" -> Map.of("unloaded", host.unload(str(params, "pluginId")));

            case "clearTranslationCache" -> Map.of("removed", host.clearTranslationCache());

            default -> throw new UnsupportedOperationException("Unknown method: " + method);
        };
    }

    private static String str(Map<String, Object> params, String key) {
        Object v = params.get(key);
        if (v == null) throw new IllegalArgumentException("Missing required parameter: " + key);
        return String.valueOf(v);
    }

    private synchronized void emit(Map<String, Object> reply) {
        out.println(Json.write(reply));
    }

    private static Map<String, String> parseArgs(String[] args) {
        Map<String, String> m = new LinkedHashMap<>();
        for (String a : args) {
            if (!a.startsWith("--")) continue;
            int eq = a.indexOf('=');
            if (eq < 0) m.put(a.substring(2), "true");
            else m.put(a.substring(2, eq), a.substring(eq + 1));
        }
        return m;
    }
}
