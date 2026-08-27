package com.cloudstream.desktop.sidecar;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

import static org.junit.jupiter.api.Assertions.*;

class SidecarTest {

    // --- provider lookup ----------------------------------------------------

    /**
     * A provider name that is not registered, and what the caller is told.
     *
     * Reported from a real install: opening a saved page whose extension had
     * gone produced `IllegalArgumentException: No loaded provider is named
     * "EinschaltenIn". Loaded: [Aniworld, Serienstream, ... 100 more]` on
     * screen. The list is everything that *did* work, which is diagnostics and
     * not an answer, and the host — which knows whether the extension is
     * disabled, uninstalled or blocked — could not recognise the case to say
     * anything better because it only had a sentence to match on.
     */
    @Test
    void anUnknownProviderIsItsOwnConditionAndDoesNotListTheLoadedSet(@TempDir Path dir)
            throws Exception {
        Path runtime = dir.resolve("runtime");
        PluginHost host = new PluginHost(new DexTranslator(dir.resolve("cache"), runtime), runtime);

        PluginHost.ProviderNotLoadedException thrown = assertThrows(
                PluginHost.ProviderNotLoadedException.class,
                () -> host.loadFromProvider("EinschaltenIn", "some-url", 1000));

        assertEquals("EinschaltenIn", thrown.providerName());
        assertTrue(thrown.getMessage().contains("EinschaltenIn"));
        // The whole point: the message is about the one that failed.
        assertFalse(thrown.getMessage().contains("Loaded:"),
                "the loaded set is diagnostics and belongs on stderr: " + thrown.getMessage());
    }

    // --- translator ---------------------------------------------------------

    @Test
    void reportsMissingManifestAsAFailureNotAnException(@TempDir Path dir) throws Exception {
        Path cs3 = dir.resolve("no-manifest.cs3");
        try (ZipOutputStream z = new ZipOutputStream(Files.newOutputStream(cs3))) {
            z.putNextEntry(new ZipEntry("classes.dex"));
            z.write("dex\n035\0".getBytes(StandardCharsets.ISO_8859_1));
            z.closeEntry();
        }

        DexTranslator.Outcome o = new DexTranslator(dir.resolve("cache")).translate(cs3);

        assertFalse(o.ok());
        assertEquals("MANIFEST_INVALID", o.failureKind());
    }

    @Test
    void reportsAnArchiveWithNoDexDistinctly(@TempDir Path dir) throws Exception {
        Path cs3 = dir.resolve("no-dex.cs3");
        try (ZipOutputStream z = new ZipOutputStream(Files.newOutputStream(cs3))) {
            z.putNextEntry(new ZipEntry("manifest.json"));
            z.write("{\"pluginClassName\":\"a.B\",\"name\":\"x\",\"version\":1}"
                    .getBytes(StandardCharsets.UTF_8));
            z.closeEntry();
        }

        DexTranslator.Outcome o = new DexTranslator(dir.resolve("cache")).translate(cs3);

        assertFalse(o.ok());
        assertEquals("NO_DEX", o.failureKind());
    }

    @Test
    void malformedDexFailsAsDataRatherThanCrashingTheSidecar(@TempDir Path dir) throws Exception {
        Path cs3 = dir.resolve("bad.cs3");
        try (ZipOutputStream z = new ZipOutputStream(Files.newOutputStream(cs3))) {
            z.putNextEntry(new ZipEntry("manifest.json"));
            z.write("{\"pluginClassName\":\"a.B\"}".getBytes(StandardCharsets.UTF_8));
            z.closeEntry();
            z.putNextEntry(new ZipEntry("classes.dex"));
            z.write(new byte[]{'d', 'e', 'x', '\n', 0, 0, 0, 0, 1, 2, 3});
            z.closeEntry();
        }

        DexTranslator.Outcome o = new DexTranslator(dir.resolve("cache")).translate(cs3);

        // DROP-4: a translation failure is a reportable outcome, never a throw.
        assertFalse(o.ok());
        assertTrue(o.failureKind().startsWith("TRANSLATION"), o.failureKind());
        assertNotNull(o.failureDetail());
    }

    @Test
    void missingArchiveIsReportedNotThrown(@TempDir Path dir) throws Exception {
        DexTranslator.Outcome o = new DexTranslator(dir.resolve("cache"))
                .translate(dir.resolve("absent.cs3"));

        assertFalse(o.ok());
        assertEquals("ARCHIVE_MISSING", o.failureKind());
    }

    // --- Base64 Android semantics -------------------------------------------

    @Test
    void base64DefaultWrapsAndNoWrapDoesNot() {
        byte[] input = new byte[120];
        for (int i = 0; i < input.length; i++) input[i] = (byte) i;

        String wrapped = android.util.Base64.encodeToString(input, android.util.Base64.DEFAULT);
        String flat = android.util.Base64.encodeToString(input, android.util.Base64.NO_WRAP);

        // Providers that build URLs depend on NO_WRAP suppressing the newlines
        // Android's DEFAULT inserts every 76 characters.
        assertTrue(wrapped.contains("\n"));
        assertFalse(flat.contains("\n"));
        assertEquals(flat, wrapped.replace("\n", ""));
    }

    @Test
    void base64RoundTripsAcrossFlagCombinations() {
        byte[] input = "CloudStream Desktop ✓ 1234".getBytes(StandardCharsets.UTF_8);
        int[] flags = {
                android.util.Base64.DEFAULT,
                android.util.Base64.NO_WRAP,
                android.util.Base64.URL_SAFE | android.util.Base64.NO_WRAP,
                android.util.Base64.NO_PADDING | android.util.Base64.NO_WRAP,
                android.util.Base64.URL_SAFE | android.util.Base64.NO_PADDING | android.util.Base64.NO_WRAP,
        };
        for (int f : flags) {
            String enc = android.util.Base64.encodeToString(input, f);
            assertArrayEquals(input, android.util.Base64.decode(enc, f), "flags=" + f);
        }
    }

    @Test
    void base64DecodesUnpaddedAndUrlSafeInputLikeAndroid() {
        // java.util.Base64's strict decoder rejects both of these; Android accepts
        // them, and providers in the wild rely on that tolerance.
        assertArrayEquals("hi".getBytes(StandardCharsets.UTF_8),
                android.util.Base64.decode("aGk", android.util.Base64.DEFAULT));
        assertArrayEquals(new byte[]{(byte) 0xfb, (byte) 0xff},
                android.util.Base64.decode("-_8=", android.util.Base64.DEFAULT));
        assertArrayEquals("hi".getBytes(StandardCharsets.UTF_8),
                android.util.Base64.decode("a G\nk=", android.util.Base64.DEFAULT));
    }

    @Test
    void urlSafeEncodingAvoidsPlusAndSlash() {
        byte[] input = {(byte) 0xfb, (byte) 0xff, (byte) 0xfe};
        String std = android.util.Base64.encodeToString(input, android.util.Base64.NO_WRAP);
        String url = android.util.Base64.encodeToString(input,
                android.util.Base64.URL_SAFE | android.util.Base64.NO_WRAP);

        assertTrue(std.contains("+") || std.contains("/"));
        assertFalse(url.contains("+"));
        assertFalse(url.contains("/"));
    }

    // --- scoped context and preferences -------------------------------------

    @Test
    void contextGrantsOnlyScopedStorage(@TempDir Path dir) {
        android.content.Context a =
                android.content.Context.cs3CreateScoped("plugin.a", dir.toString());
        android.content.Context b =
                android.content.Context.cs3CreateScoped("plugin.b", dir.toString());

        assertNotEquals(a.getFilesDir().toPath(), b.getFilesDir().toPath());
        assertTrue(a.getFilesDir().toPath().startsWith(dir));

        /*
         * DROP-12: no ambient authority beyond the plugin's own directory —
         * and `null` is how Android itself says so.
         *
         * This used to throw for every service name, which looks stricter and
         * is worse. The call site in the corpus is the first statement of a
         * provider's `load()`, unguarded, asking how much memory the device has
         * so it can size a buffer; throwing there aborted the load and cost the
         * extension every provider it was about to register. StreamPlay lost
         * all of its providers to exactly that, and the reported cause named
         * `getSystemService` rather than anything anyone could act on.
         *
         * `null` is the documented contract for a name the platform does not
         * recognise, so a caller that checks gets Android's behaviour and one
         * that does not fails on the line that *uses* the service rather than
         * the line that asked for it.
         */
        assertNull(a.getSystemService("window"));
        assertNull(a.getSystemService("audio"));
        assertNull(a.getSystemService(null));

        /*
         * `getPackageManager` hands back a manager rather than throwing, and
         * every operation on it throws instead.
         *
         * The guarantee is unchanged — a plugin still learns nothing about the
         * host — but the throw had to move. An extension merely *mentioning*
         * `PackageManager` failed to load at all, because verification resolves
         * every type a method body names; Kraptor123/cs-kraptor lost all 65 of
         * its plugins that way. Returning `Object` was equally fatal one step
         * later: Android declares
         * `getPackageManager()Landroid/content/pm/PackageManager;`, and a
         * different return type is a different method to the JVM.
         */
        android.content.pm.PackageManager packages = a.getPackageManager();
        assertNotNull(packages);
        assertThrows(android.content.UnsupportedAndroidApiException.class,
                () -> packages.getPackageInfo("com.example", 0));
        assertThrows(android.content.UnsupportedAndroidApiException.class,
                () -> packages.getApplicationInfo("com.example", 0));
    }

    @Test
    void preferencesPersistAcrossReloadAndStayPerPlugin(@TempDir Path dir) {
        android.content.Context a =
                android.content.Context.cs3CreateScoped("plugin.a", dir.toString());
        a.getSharedPreferences("s", 0).edit().putString("token", "abc").putInt("n", 7).apply();

        // A fresh Context reads the same backing file, as it would after a restart.
        android.content.Context reopened =
                android.content.Context.cs3CreateScoped("plugin.a", dir.toString());
        assertEquals("abc", reopened.getSharedPreferences("s", 0).getString("token", null));
        assertEquals(7, reopened.getSharedPreferences("s", 0).getInt("n", 0));

        android.content.Context other =
                android.content.Context.cs3CreateScoped("plugin.b", dir.toString());
        assertNull(other.getSharedPreferences("s", 0).getString("token", null));
    }

    @Test
    void unsupportedAndroidApiNamesTheApiItRefused() {
        var e = assertThrows(android.content.UnsupportedAndroidApiException.class,
                () -> android.content.Context.cs3CreateScoped("p", "/tmp").getAssets());

        // AC-D5: the message must identify the API, not just fail.
        assertTrue(e.getMessage().contains("android.content.Context.getAssets"));
        assertEquals("android.content.Context.getAssets", e.api());
    }

    /**
     * The one system service the corpus asks for answers with real numbers.
     *
     * Real ones, about this JVM. DROP-9 forbids telling plugin code something
     * false about its platform, and an extension sizing a buffer against a
     * fabricated device memory figure would size it wrongly — which is the
     * failure mode a made-up answer was supposed to avoid.
     */
    @Test
    void activityManagerReportsRealMemory(@TempDir Path dir) {
        android.content.Context context =
                android.content.Context.cs3CreateScoped("plugin.a", dir.toString());

        Object service = context.getSystemService(android.content.Context.ACTIVITY_SERVICE);
        assertNotNull(service);
        assertInstanceOf(android.app.ActivityManager.class, service);

        android.app.ActivityManager manager = (android.app.ActivityManager) service;
        android.app.ActivityManager.MemoryInfo info = new android.app.ActivityManager.MemoryInfo();
        manager.getMemoryInfo(info);

        assertTrue(info.totalMem > 0, "total memory must be a real figure");
        assertTrue(info.availMem >= 0);
        assertTrue(info.availMem <= info.totalMem);
        assertTrue(manager.getMemoryClass() > 0);

        // Enumerating the host's processes is not the plugin's business, and an
        // empty list is what an unprivileged Android app has received since API 24.
        assertTrue(manager.getRunningAppProcesses().isEmpty());
    }

    /**
     * `Handler` runs what it is given rather than refusing it.
     *
     * Almost every use in the corpus is a retry backoff or a timeout guard, not
     * a UI hop — ordinary scheduling that the JVM does perfectly well. Refusing
     * would break working scraper code to make a point about a platform
     * difference that does not exist here.
     */
    @Test
    void handlerRunsPostedWorkInOrder() throws Exception {
        android.os.Handler handler = new android.os.Handler(android.os.Looper.getMainLooper());
        java.util.List<Integer> seen = java.util.Collections.synchronizedList(new java.util.ArrayList<>());
        java.util.concurrent.CountDownLatch done = new java.util.concurrent.CountDownLatch(3);

        for (int i = 1; i <= 3; i++) {
            final int value = i;
            handler.post(() -> {
                seen.add(value);
                done.countDown();
            });
        }

        assertTrue(done.await(5, java.util.concurrent.TimeUnit.SECONDS));
        // Android guarantees ordering on one Handler; a pool would not.
        assertEquals(java.util.List.of(1, 2, 3), seen);

        // A cancelled task must not run.
        Runnable never = () -> seen.add(99);
        handler.postDelayed(never, 2_000);
        handler.removeCallbacks(never);
        Thread.sleep(200);
        assertFalse(seen.contains(99));
    }

    /**
     * {@code getResources} returns the declared type and refuses on use.
     *
     * It used to throw immediately, and this test asserted that — but the
     * signature was {@code ()Ljava/lang/Object;}, which is a *different method*
     * to the JVM than the {@code ()Landroid/content/res/Resources;} extensions
     * are compiled against. The refusal was never reached: the call site failed
     * with {@code NoSuchMethodError} first, naming nothing. Returning the real
     * type is what makes the call link; the refusal moves to the accessor, where
     * it can finally be seen.
     */
    @Test
    void getResourcesLinksAndRefusesOnUse() {
        android.content.res.Resources resources =
                android.content.Context.cs3CreateScoped("p", "/tmp").getResources();
        assertNotNull(resources);

        var e = assertThrows(android.content.UnsupportedAndroidApiException.class,
                () -> resources.getString(1));
        assertTrue(e.getMessage().contains("Resources.getString"));

        // Android's documented answer for "no such resource", and truthful here.
        assertEquals(0, resources.getIdentifier("x", "id", "pkg"));
    }

    /**
     * The Context handed to a plugin is an {@code AppCompatActivity}.
     *
     * 25 archives in the corpus open {@code load()} with
     * {@code context as AppCompatActivity} and lost every provider when that
     * cast failed. It must keep succeeding — and the storage scope must survive
     * the longer constructor chain, which is the part a careless change breaks
     * silently.
     */
    @Test
    void pluginContextSatisfiesTheAppCompatActivityCast(@TempDir Path dir) {
        android.content.Context context =
                android.content.Context.cs3CreateScoped("plugin.cast", dir.toString());

        assertInstanceOf(androidx.appcompat.app.AppCompatActivity.class, context);

        context.getSharedPreferences("s", 0).edit().putString("k", "v").apply();
        android.content.Context reopened =
                android.content.Context.cs3CreateScoped("plugin.cast", dir.toString());
        assertEquals("v", reopened.getSharedPreferences("s", 0).getString("k", null));

        // The activity surface itself still refuses — nothing is faked to make
        // the cast work beyond the type identity.
        assertThrows(android.content.UnsupportedAndroidApiException.class,
                () -> ((androidx.appcompat.app.AppCompatActivity) context).getSupportFragmentManager());
    }

    /**
     * {@code android.net.Uri} parses leniently and never throws.
     *
     * The inputs below are the ones {@code java.net.URI} rejects — a space, a
     * pipe, a stray percent — and providers produce them routinely. Delegating
     * to the validating parser would turn "untidy URL", which Android tolerates,
     * into a hard failure mid-scrape.
     */
    @Test
    void uriParsesLenientlyAndReadsQueryParameters() {
        var uri = android.net.Uri.parse("https://host.example:8443/a/b%20c?id=42&q=one+two#frag");
        assertEquals("https", uri.getScheme());
        assertEquals("host.example", uri.getHost());
        assertEquals(8443, uri.getPort());
        assertEquals("42", uri.getQueryParameter("id"));
        // getQueryParameter converts '+' to a space; Uri.decode deliberately does not.
        assertEquals("one two", uri.getQueryParameter("q"));
        assertEquals("frag", uri.getFragment());
        assertEquals("b c", uri.getLastPathSegment());

        for (String hostile : new String[] { "not a url", "http://h/p|q", "%%%", "" }) {
            assertNotNull(android.net.Uri.parse(hostile).toString(), hostile);
        }

        assertEquals(
                "https://h/p?a=1&b=2",
                android.net.Uri.parse("https://h/p?a=1").buildUpon()
                        .appendQueryParameter("b", "2").build().toString());
    }

    // --- class loader isolation ---------------------------------------------

    @Test
    void pluginLoaderRefusesToResolveSidecarInternals() throws Exception {
        try (PluginClassLoader loader = new PluginClassLoader(
                "test", new java.net.URL[0], getClass().getClassLoader())) {

            ClassNotFoundException e = assertThrows(ClassNotFoundException.class,
                    () -> loader.loadClass("com.cloudstream.desktop.sidecar.PluginHost"));
            assertTrue(e.getMessage().contains("sidecar internal"));

            // Ordinary classes still resolve through the parent.
            assertNotNull(loader.loadClass("java.util.ArrayList"));
        }
    }

    // --- protocol -----------------------------------------------------------

    @Test
    void jsonRoundTripsNestedStructuresAndEscapes() {
        Map<String, Object> value = Map.of(
                "s", "quote\" back\\slash\nnewline\ttab",
                "n", 42L,
                "b", true,
                "list", List.of("a", "b"));

        Map<String, Object> back = Json.parseObject(Json.write(value));

        assertEquals(value.get("s"), back.get("s"));
        assertEquals(42L, back.get("n"));
        assertEquals(true, back.get("b"));
        assertEquals(List.of("a", "b"), back.get("list"));
    }

    @Test
    void jsonEscapesControlCharactersSoFramingSurvives() {
        String encoded = Json.write(Map.of("k", "ab"));

        assertTrue(encoded.contains("\\u0001"));
        assertEquals("ab", Json.parseObject(encoded).get("k"));
    }

    @Test
    void manifestFieldsAreReadWithoutAFullParse() {
        String manifest = "{\"requiresResources\":false,\"version\":2,"
                + "\"pluginClassName\":\"com.mega.MegaPlugin\",\"name\":\"MegaProvider\"}";

        assertEquals("com.mega.MegaPlugin", Json.string(manifest, "pluginClassName"));
        assertEquals(2, Json.integer(manifest, "version"));
        assertEquals(Boolean.FALSE, Json.bool(manifest, "requiresResources"));
        assertNull(Json.string(manifest, "absent"));
    }
}
