package com.cloudstream.desktop.sidecar;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.BiFunction;

import static org.junit.jupiter.api.Assertions.*;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

/**
 * The seam between the sidecar, the bridge and the desktop app's browser.
 *
 * <p>Three things here are load-bearing and none of them fails loudly:
 *
 * <ul>
 *   <li><b>Which {@code WebViewResolver} loads.</b> Unlike every other type the
 *       bridge supplies, this one also exists in {@code library-jvm} — as a stub
 *       whose {@code resolveUsingWebView} is {@code TODO("Not yet implemented")}.
 *       A {@code URLClassLoader} searches its URLs in order, and
 *       {@code Files.newDirectoryStream} specifies none, so before the sort in
 *       {@link PluginHost#shared()} which implementation won was a property of
 *       the filesystem: correct on the machine it was built on, throwing
 *       {@code NotImplementedError} on a user's.</li>
 *   <li><b>That the host handler is installed at all.</b> It is set reflectively
 *       across a class-loader boundary, so a rename on either side compiles
 *       cleanly and simply never connects.</li>
 *   <li><b>That the JSON contract round-trips.</b> Jackson binds the answer by
 *       constructor parameter <em>name</em>; a renamed field does not throw, it
 *       binds to null and the provider reports no results.</li>
 * </ul>
 *
 * <p>Skipped rather than failed when {@code sidecar/runtime/} has not been
 * built — a fresh clone has no jars, and this is not the test that should be
 * telling anyone that.
 */
class WebViewBridgeTest {

    private static Path runtimeDir() {
        // The tests run with the module directory as the working directory.
        Path dir = Paths.get("runtime").toAbsolutePath();
        return Files.isDirectory(dir) ? dir : Paths.get("sidecar", "runtime").toAbsolutePath();
    }

    private static boolean runtimeIsBuilt(Path dir) {
        if (!Files.isDirectory(dir)) return false;
        try (var jars = Files.list(dir)) {
            var names = jars.map(p -> p.getFileName().toString()).toList();
            return names.stream().anyMatch(n -> n.startsWith("library-jvm"))
                    && names.stream().anyMatch(n -> n.startsWith("cs3-provider-bridge"));
        } catch (Exception e) {
            return false;
        }
    }

    private static PluginHost hostFor(Path runtime, Path temp) throws java.io.IOException {
        return new PluginHost(new DexTranslator(temp.resolve("cache"), runtime), runtime);
    }

    @Test
    void theBridgesWebViewResolverWinsOverTheLibraryStub(@TempDir Path temp) throws Exception {
        Path runtime = runtimeDir();
        assumeTrue(runtimeIsBuilt(runtime), "sidecar/runtime is not built");

        ClassLoader shared = hostFor(runtime, temp).shared();
        Class<?> resolver = Class.forName(
                "com.lagradost.cloudstream3.network.WebViewResolver", false, shared);

        String source = resolver.getProtectionDomain().getCodeSource().getLocation().toString();
        assertTrue(source.contains("cs3-provider-bridge"),
                "WebViewResolver was loaded from " + source + " rather than the bridge jar,"
                        + " which means providers get the library's TODO() stub");
    }

    @Test
    void withoutTheBridgeTheLibraryStubIsWhatLoads(@TempDir Path temp) throws Exception {
        // Guards the premise from both sides. It shows the shadowing is doing
        // real work — remove the bridge jar and the stub is what a provider
        // gets — and it is where a future `library-jvm` that ships a working
        // JVM WebViewResolver would announce itself, at which point shadowing
        // stops being the right thing to do.
        Path runtime = runtimeDir();
        assumeTrue(runtimeIsBuilt(runtime), "sidecar/runtime is not built");

        java.net.URL[] withoutBridge;
        try (var jars = Files.list(runtime)) {
            withoutBridge = jars
                    .filter(p -> p.getFileName().toString().endsWith(".jar"))
                    .filter(p -> !p.getFileName().toString().startsWith("cs3-provider-bridge"))
                    .map(p -> {
                        try {
                            return p.toUri().toURL();
                        } catch (java.net.MalformedURLException e) {
                            throw new IllegalStateException(e);
                        }
                    })
                    .toArray(java.net.URL[]::new);
        }

        try (var loader = new java.net.URLClassLoader(
                withoutBridge, PluginHost.class.getClassLoader())) {
            Class<?> stub = Class.forName(
                    "com.lagradost.cloudstream3.network.WebViewResolver", false, loader);
            String source = stub.getProtectionDomain().getCodeSource().getLocation().toString();
            assertTrue(source.contains("library-jvm"),
                    "expected the library's own copy, got " + source);
            // Present, public and resolvable — exactly why four rounds of
            // counting missing classes never found this gap.
            assertTrue(java.util.Arrays.stream(stub.getDeclaredMethods())
                            .anyMatch(m -> m.getName().equals("resolveUsingWebView")),
                    "library-jvm no longer ships a WebViewResolver to shadow");
        }
    }

    @Test
    void theHostHandlerIsInstalledIntoTheBridge(@TempDir Path temp) throws Exception {
        Path runtime = runtimeDir();
        assumeTrue(runtimeIsBuilt(runtime), "sidecar/runtime is not built");

        PluginHost host = hostFor(runtime, temp);
        host.setHostChannel(new HostChannel(frame -> { }));
        ClassLoader shared = host.shared();

        Class<?> hostBridge = Class.forName(
                "com.cloudstream.desktop.bridge.HostBridge", true, shared);
        assertTrue((Boolean) hostBridge.getMethod("isAvailable").invoke(null),
                "the sidecar did not install its handler, so every browser call would fail");
    }

    @Test
    void aResolveReachesTheHostAndItsAnswerComesBack(@TempDir Path temp) throws Exception {
        Path runtime = runtimeDir();
        assumeTrue(runtimeIsBuilt(runtime), "sidecar/runtime is not built");

        PluginHost host = hostFor(runtime, temp);
        ClassLoader shared = host.shared();
        Class<?> hostBridge = Class.forName(
                "com.cloudstream.desktop.bridge.HostBridge", true, shared);

        AtomicReference<String> seenMethod = new AtomicReference<>();
        AtomicReference<String> seenParams = new AtomicReference<>();
        BiFunction<String, String, String> handler = (method, params) -> {
            seenMethod.set(method);
            seenParams.set(params);
            return "{\"ok\":true,"
                    + "\"request\":{\"url\":\"https://cdn.test/master.m3u8\",\"method\":\"GET\","
                    + "\"headers\":{\"Referer\":\"https://site.test/\"}},"
                    + "\"extra\":[{\"url\":\"https://cdn.test/audio.m3u8\",\"method\":\"GET\",\"headers\":{}}],"
                    + "\"userAgent\":\"TestBrowser/1.0\",\"cookies\":{},\"scriptResults\":[]}";
        };
        hostBridge.getMethod("setHandler", BiFunction.class).invoke(null, handler);

        Object pair = callResolve(shared, "https://site.test/watch", "\\.m3u8");

        assertEquals("webview.resolve", seenMethod.get());
        assertTrue(seenParams.get().contains("\"interceptUrl\":\"\\\\.m3u8\""),
                "the pattern was not carried across verbatim: " + seenParams.get());
        assertTrue(seenParams.get().contains("\"url\":\"https://site.test/watch\""), seenParams.get());

        // Jackson binds the answer by constructor parameter name; a rename on
        // either side of the wire binds to null instead of failing.
        Object matched = pair.getClass().getMethod("getFirst").invoke(pair);
        assertNotNull(matched, "the matched request did not survive the round trip");
        assertEquals("https://cdn.test/master.m3u8",
                matched.getClass().getMethod("url").invoke(matched).toString());

        Object extra = pair.getClass().getMethod("getSecond").invoke(pair);
        assertEquals(1, ((java.util.List<?>) extra).size());

        Class<?> resolver = Class.forName(
                "com.lagradost.cloudstream3.network.WebViewResolver", true, shared);
        Object companion = resolver.getField("Companion").get(null);
        assertEquals("TestBrowser/1.0",
                companion.getClass().getMethod("getWebViewUserAgent").invoke(companion));
    }

    @Test
    void aHostWithNoBrowserYieldsNoLinksRatherThanThrowing(@TempDir Path temp) throws Exception {
        Path runtime = runtimeDir();
        assumeTrue(runtimeIsBuilt(runtime), "sidecar/runtime is not built");

        PluginHost host = hostFor(runtime, temp);
        ClassLoader shared = host.shared();
        Class.forName("com.cloudstream.desktop.bridge.HostBridge", true, shared)
                .getMethod("setHandler", BiFunction.class).invoke(null, (Object) null);

        // The behaviour that shipped before any of this existed: an extension
        // needing a browser finds nothing, and says so, rather than throwing
        // from inside a scrape and being blamed for it.
        Object pair = callResolve(shared, "https://site.test/watch", "\\.m3u8");
        assertNull(pair.getClass().getMethod("getFirst").invoke(pair));
        assertTrue(((java.util.List<?>) pair.getClass().getMethod("getSecond").invoke(pair)).isEmpty());
    }

    /** Drives the suspend function from Java, via the bridge's own coroutine helper. */
    private static Object callResolve(ClassLoader shared, String url, String pattern) throws Exception {
        Class<?> resolver = Class.forName(
                "com.lagradost.cloudstream3.network.WebViewResolver", true, shared);
        Class<?> regex = Class.forName("kotlin.text.Regex", true, shared);
        Object interceptUrl = regex.getConstructor(String.class).newInstance(pattern);

        Object instance = resolver
                .getConstructor(regex, java.util.List.class, String.class, boolean.class,
                        String.class, Class.forName("kotlin.jvm.functions.Function1", true, shared),
                        long.class)
                .newInstance(interceptUrl, java.util.List.of(), null, true, null, null, 5_000L);

        return BridgeTestSupport.awaitResolve(shared, instance, url);
    }
}
