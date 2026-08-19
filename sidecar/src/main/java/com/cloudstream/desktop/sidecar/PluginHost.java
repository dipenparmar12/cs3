package com.cloudstream.desktop.sidecar;

import java.io.IOException;
import java.io.InputStream;
import java.lang.reflect.Constructor;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.net.URL;
import java.net.URLClassLoader;
import java.nio.charset.StandardCharsets;
import java.nio.file.DirectoryStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.*;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

/**
 * Loads translated CloudStream plugins, reproducing Android's load sequence.
 *
 * <p>Every step below is the desktop counterpart of a numbered step in
 * docs/PRD/31 §3.1, and the ordering is deliberate. In particular the manifest
 * is read <em>through the plugin's class loader</em> rather than straight out of
 * the archive (step 5), because a plugin that ships its own {@code manifest.json}
 * as a resource must resolve the same way it does on Android.
 *
 * <h2>Why reflection</h2>
 * The provider API ({@code MainAPI}, {@code BasePlugin}, {@code ExtractorApi})
 * is supplied at runtime from {@code library-jvm.jar}, not compiled into this
 * sidecar. That is the whole point of the drop-in design — the sidecar links the
 * ecosystem's real API rather than a reimplementation of it, so provider
 * behaviour is upstream's behaviour. The cost is that the sidecar itself can
 * only talk to that API reflectively.
 */
public final class PluginHost {

    public record Loaded(
            String pluginId,
            String entryClass,
            String name,
            Integer version,
            List<Map<String, Object>> providers,
            LinkageAnalyzer.Report linkage) { }

    private final DexTranslator translator;
    private final Path runtimeClasspathDir;
    private final Map<String, PluginClassLoader> loaders = new LinkedHashMap<>();
    private final Map<String, Object> instances = new LinkedHashMap<>();

    /**
     * Registered provider instances, keyed by the provider's own name.
     *
     * Providers are the addressable unit, not plugins: one `.cs3` commonly
     * registers several, and the user enables or disables them individually.
     */
    private final Map<String, Object> providersByName = new LinkedHashMap<>();
    /** Which plugin registered which providers, so unload can withdraw them. */
    private final Map<String, List<String>> providerNamesByPlugin = new LinkedHashMap<>();

    /**
     * Providers are queried concurrently: a search across a dozen of them is as
     * slow as the slowest one otherwise, and each is an independent network call.
     */
    private final ExecutorService providerPool = Executors.newCachedThreadPool(r -> {
        Thread t = new Thread(r, "cs3-provider-call");
        t.setDaemon(true);
        return t;
    });

    private ClassLoader shared;
    private String classpathProblem;
    private Class<?> bridgeClass;

    public PluginHost(DexTranslator translator, Path runtimeClasspathDir) {
        this.translator = translator;
        this.runtimeClasspathDir = runtimeClasspathDir;
    }

    /**
     * Builds the classpath every plugin is loaded against: the provider API, the
     * compatibility shims, and the third-party libraries the ecosystem uses.
     *
     * <p>Absence is reported, never faked. If {@code library-jvm.jar} is not
     * present the sidecar still translates and analyses plugins — which is
     * genuinely useful — but says plainly that it cannot execute them, rather
     * than returning empty results that look like "this provider found nothing".
     */
    public synchronized ClassLoader shared() {
        if (shared != null) return shared;

        List<URL> urls = new ArrayList<>();
        boolean hasApi = false;
        if (Files.isDirectory(runtimeClasspathDir)) {
            try (DirectoryStream<Path> ds = Files.newDirectoryStream(runtimeClasspathDir, "*.jar")) {
                for (Path p : ds) {
                    urls.add(p.toUri().toURL());
                    if (p.getFileName().toString().startsWith("library-jvm")) hasApi = true;
                }
            } catch (IOException e) {
                classpathProblem = "Runtime classpath unreadable: " + e;
            }
        }

        if (!hasApi) {
            classpathProblem = "library-jvm.jar is not present in " + runtimeClasspathDir
                    + ". The CloudStream provider API is published only through JitPack"
                    + " (com.github.recloudstream.cloudstream:library), so it is fetched at build time"
                    + " and shipped with the app. Without it, plugins can be installed, translated and"
                    + " analysed, but not executed.";
        }

        shared = new URLClassLoader("cs3-shared", urls.toArray(new URL[0]),
                PluginHost.class.getClassLoader());
        return shared;
    }

    public String classpathProblem() {
        shared();
        return classpathProblem;
    }

    public boolean canExecute() {
        return classpathProblem() == null;
    }

    /**
     * Translates, analyses and — when the runtime classpath allows — loads a
     * {@code .cs3}.
     *
     * @param cs3 the archive, retained byte-for-byte (DROP-3)
     */
    public Map<String, Object> install(String pluginId, Path cs3) {
        DexTranslator.Outcome t = translator.translate(cs3);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("pluginId", pluginId);
        out.put("translated", t.ok());
        out.put("fromCache", t.fromCache());
        out.put("dexCount", t.dexCount());
        out.put("classCount", t.classCount());

        if (!t.ok()) {
            out.put("tier", "T4_BLOCKED");
            out.put("failureKind", t.failureKind());
            out.put("reason", t.failureDetail());
            return out;
        }

        out.put("entryClass", t.manifestClassName());
        out.put("name", t.manifestName());
        out.put("version", t.manifestVersion());
        out.put("requiresResources", t.requiresResources());
        out.put("translatedJar", t.translatedJar().toString());

        LinkageAnalyzer.Report report;
        try {
            report = new LinkageAnalyzer(shared()).analyze(t.translatedJar(), t.manifestClassName());
        } catch (IOException e) {
            out.put("tier", "T4_BLOCKED");
            out.put("failureKind", "ANALYSIS_FAILED");
            out.put("reason", e.toString());
            return out;
        }

        out.put("tier", report.tier());
        out.put("reason", report.tierReason());
        out.put("unresolvedCritical", report.unresolvedCritical());
        out.put("unresolvedAndroid", report.unresolvedAndroid());
        out.put("unresolvedOther", report.unresolvedIncidental());
        out.put("suspendMethods", report.suspendMethods());
        out.put("stateMachines", report.stateMachines());
        out.put("executable", canExecute());
        if (!canExecute()) out.put("notExecutableBecause", classpathProblem());
        return out;
    }

    /**
     * Performs the load sequence itself. Mirrors PluginManager.kt:611-670.
     */
    public Loaded load(String pluginId, Path cs3) throws Exception {
        if (!canExecute()) {
            throw new IllegalStateException(classpathProblem());
        }

        DexTranslator.Outcome t = translator.translate(cs3);
        if (!t.ok()) {
            throw new IllegalStateException(t.failureKind() + ": " + t.failureDetail());
        }

        // Step 3 — Android marks the archive read-only before loading.
        try {
            cs3.toFile().setReadOnly();
        } catch (SecurityException ignored) {
            // Advisory on Android too; a failure here does not block the load.
        }

        // Step 4 — the plugin's own loader.
        //
        // Two entries, and both are needed. dex2jar converts `classes.dex` and
        // nothing else, so the translated jar holds the code but none of the
        // archive's other members — including `manifest.json`, which step 5 has
        // to read through this very loader. On Android the `.cs3` *is* the
        // classpath entry and its resources resolve naturally; adding the
        // original archive alongside the translated classes reproduces that,
        // and leaves the archive itself untouched (DROP-3).
        PluginClassLoader loader = new PluginClassLoader(
                pluginId,
                new URL[]{ t.translatedJar().toUri().toURL(), cs3.toUri().toURL() },
                shared());

        // Step 5 — read manifest.json *through* the loader, not from the zip.
        String manifestJson;
        try (InputStream in = loader.getResourceAsStream("manifest.json")) {
            if (in == null) throw new IllegalStateException("No manifest.json visible to the class loader.");
            manifestJson = new String(in.readAllBytes(), StandardCharsets.UTF_8);
        }
        String entry = Json.string(manifestJson, "pluginClassName");
        String name = Json.string(manifestJson, "name");
        Integer version = Json.integer(manifestJson, "version");
        if (entry == null) throw new IllegalStateException("manifest.json has no pluginClassName.");

        // Steps 6 and 7 — load the entry class and construct it reflectively.
        Class<?> pluginClass = loader.loadClass(entry);
        Constructor<?> ctor = pluginClass.getDeclaredConstructor();
        ctor.setAccessible(true);
        Object instance = ctor.newInstance();

        // BasePlugin.filename is what registerMainAPI stamps onto each provider.
        trySetField(instance, "filename", cs3.toAbsolutePath().toString());

        // Step 9 — load(context) when the plugin extends the Android-shaped
        // Plugin, else the cross-platform load().
        Object before = snapshotProviders(loader);
        invokeLoad(instance, loader);

        List<Map<String, Object>> providers = diffProviders(loader, before, pluginId);

        loaders.put(pluginId, loader);
        instances.put(pluginId, instance);

        LinkageAnalyzer.Report report =
                new LinkageAnalyzer(shared()).analyze(t.translatedJar(), entry);

        return new Loaded(pluginId, entry, name, version, providers, report);
    }

    // --- calling providers ---------------------------------------------------

    /**
     * Resolves the Kotlin bridge, which lives on the shared runtime classpath.
     *
     * It cannot be a direct dependency of this class. Provider instances are
     * created by the plugin loader, whose ancestry runs through {@link #shared()}
     * — the loader that owns {@code library-jvm.jar}. Only code loaded by that
     * same loader resolves the identical {@code MainAPI} class, so the bridge
     * ships in {@code runtime/} and is reached from here reflectively.
     */
    private synchronized Class<?> bridge() {
        if (bridgeClass != null) return bridgeClass;
        try {
            bridgeClass = Class.forName(
                    "com.cloudstream.desktop.bridge.ProviderBridge", true, shared());
        } catch (ClassNotFoundException e) {
            throw new IllegalStateException(
                    "cs3-provider-bridge.jar is missing from " + runtimeClasspathDir
                            + ". Build it with \"mvn -f sidecar/bridge/pom.xml package\"."
                            + " Without it, providers can be loaded but not called.", e);
        }
        return bridgeClass;
    }

    /** One reflective hop, carrying only primitives and a JSON string back. */
    private String callBridge(String method, Object provider, Object arg, long timeoutMs)
            throws Exception {
        Class<?> argType = arg instanceof Integer ? int.class : String.class;
        Method m = bridge().getMethod(method, Object.class, argType, long.class);
        return String.valueOf(m.invoke(null, provider, arg, timeoutMs));
    }

    public Set<String> providerNames() {
        return new LinkedHashSet<>(providersByName.keySet());
    }

    private Object requireProvider(String name) {
        Object provider = providersByName.get(name);
        if (provider == null) {
            throw new IllegalArgumentException(
                    "No loaded provider is named \"" + name + "\". Loaded: " + providersByName.keySet());
        }
        return provider;
    }

    /**
     * Searches several providers at once.
     *
     * One entry per provider, each carrying that provider's raw JSON reply, so a
     * provider that fails or times out is reported as itself rather than
     * collapsing the whole search. That distinction is what lets the UI say
     * "3 of 5 providers answered" instead of showing an empty result set.
     */
    public Map<String, String> searchProviders(
            Collection<String> names, String query, long timeoutMs) {
        Collection<String> targets =
                (names == null || names.isEmpty()) ? providersByName.keySet() : names;

        Map<String, Future<String>> futures = new LinkedHashMap<>();
        for (String name : new ArrayList<>(targets)) {
            Object provider = providersByName.get(name);
            if (provider == null) continue;
            futures.put(name, providerPool.submit(
                    () -> callBridge("search", provider, query, timeoutMs)));
        }

        Map<String, String> out = new LinkedHashMap<>();
        for (Map.Entry<String, Future<String>> e : futures.entrySet()) {
            try {
                // The bridge enforces its own deadline; a little slack here
                // covers the reflective hop without masking a hung provider.
                out.put(e.getKey(), e.getValue().get(timeoutMs + 5_000, TimeUnit.MILLISECONDS));
            } catch (Exception ex) {
                e.getValue().cancel(true);
                Throwable cause = ex.getCause() == null ? ex : ex.getCause();
                out.put(e.getKey(), Json.write(Map.of(
                        "ok", false,
                        "error", cause.getClass().getSimpleName() + ": "
                                + String.valueOf(cause.getMessage()))));
            }
        }
        return out;
    }

    public String loadFromProvider(String providerName, String url, long timeoutMs) throws Exception {
        return callBridge("load", requireProvider(providerName), url, timeoutMs);
    }

    public String loadLinksFromProvider(String providerName, String data, long timeoutMs)
            throws Exception {
        return callBridge("loadLinks", requireProvider(providerName), data, timeoutMs);
    }

    public String describeProviderJson(String providerName) throws Exception {
        Method m = bridge().getMethod("describe", Object.class);
        return String.valueOf(m.invoke(null, requireProvider(providerName)));
    }

    /** Calls {@code beforeUnload()} then drops the loader (DROP-14). */
    public boolean unload(String pluginId) {
        // Withdraw its providers first: leaving them addressable after the
        // loader closes turns the next search into a NoClassDefFoundError.
        List<String> registered = providerNamesByPlugin.remove(pluginId);
        if (registered != null) registered.forEach(providersByName::remove);

        Object instance = instances.remove(pluginId);
        if (instance != null) {
            try {
                Method m = instance.getClass().getMethod("beforeUnload");
                m.invoke(instance);
            } catch (ReflectiveOperationException ignored) {
                // A plugin that does not override beforeUnload is the normal case.
            }
        }
        PluginClassLoader loader = loaders.remove(pluginId);
        if (loader == null) return false;
        try {
            loader.close();
        } catch (IOException ignored) {
            // Closing frees the jar handle; failure leaks a handle, nothing worse.
        }
        return true;
    }

    // --- reflective glue -----------------------------------------------------

    private void invokeLoad(Object instance, ClassLoader loader) throws Exception {
        // Plugin.load(Context) exists only on the Android-shaped base class.
        try {
            Class<?> ctx = Class.forName("android.content.Context", false, loader);
            Method load = instance.getClass().getMethod("load", ctx);
            load.invoke(instance, newShimContext(loader));
            return;
        } catch (ClassNotFoundException | NoSuchMethodException e) {
            // Falls through to the cross-platform entry point.
        }
        instance.getClass().getMethod("load").invoke(instance);
    }

    /**
     * Builds the inert capability token passed to {@code load(context)}.
     *
     * Constructed through the plugin's own loader so the instance is of the very
     * {@code android.content.Context} class the plugin links against; a Context
     * built by a different loader would fail the invoke with an
     * IllegalArgumentException even though the class names match.
     */
    private Object newShimContext(ClassLoader loader) throws Exception {
        Class<?> ctx = Class.forName("android.content.Context", false, loader);
        Method factory = ctx.getMethod("cs3CreateScoped", String.class, String.class);
        Path scoped = runtimeClasspathDir.resolveSibling("plugin-data");
        return factory.invoke(null, "plugin", scoped.toAbsolutePath().toString());
    }

    /**
     * Providers self-register into {@code APIHolder.allProviders} rather than
     * being returned, so registration is observed by diffing that list around
     * the {@code load()} call (step 10).
     */
    private Object snapshotProviders(ClassLoader loader) {
        List<?> all = apiHolderProviders(loader);
        return all == null ? null : new ArrayList<>(all);
    }

    private List<Map<String, Object>> diffProviders(ClassLoader loader, Object before, String pluginId) {
        List<?> all = apiHolderProviders(loader);
        if (all == null) return List.of();
        int start = before instanceof List<?> l ? l.size() : 0;
        List<Map<String, Object>> out = new ArrayList<>();
        List<String> registered = new ArrayList<>();

        for (int i = start; i < all.size(); i++) {
            Object provider = all.get(i);

            // One provider that cannot be described must not cost the others.
            // They are siblings registered by the same extension, and an
            // archive commonly registers a dozen ExtractorApis beside its
            // MainAPI; letting one failure escape here discarded every provider
            // the plugin had already registered.
            Map<String, Object> described;
            try {
                described = describeProvider(provider);
            } catch (RuntimeException | LinkageError e) {
                described = new LinkedHashMap<>();
                described.put("className", provider.getClass().getName());
                described.put("unavailableReason", Main.describe(e));
                out.add(described);
                continue;
            }
            out.add(described);

            // Retaining the instance is what makes the provider callable later.
            // Describing it and dropping it — which is all this did before —
            // produced a UI that listed providers nothing could ever query.
            Object name = described.get("name");
            if (name != null) {
                String key = String.valueOf(name);
                providersByName.put(key, provider);
                registered.add(key);
            }
        }

        if (!registered.isEmpty()) providerNamesByPlugin.put(pluginId, registered);
        return out;
    }

    private static List<?> apiHolderProviders(ClassLoader loader) {
        try {
            Class<?> holder = Class.forName("com.lagradost.cloudstream3.APIHolder", true, loader);
            Object inst = holder.getField("INSTANCE").get(null);
            Method m = holder.getMethod("getAllProviders");
            return (List<?>) m.invoke(inst);
        } catch (ReflectiveOperationException | ClassCastException e) {
            return null;
        }
    }

    private static Map<String, Object> describeProvider(Object provider) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("className", provider.getClass().getName());
        m.put("name", readString(provider, "getName"));
        m.put("mainUrl", readString(provider, "getMainUrl"));
        m.put("lang", readString(provider, "getLang"));
        m.put("hasMainPage", readBool(provider, "getHasMainPage"));
        m.put("hasQuickSearch", readBool(provider, "getHasQuickSearch"));
        Object types = call(provider, "getSupportedTypes");
        if (types instanceof Iterable<?> it) {
            List<String> ts = new ArrayList<>();
            for (Object o : it) ts.add(String.valueOf(o));
            m.put("supportedTypes", ts);
        }
        return m;
    }

    private static String readString(Object o, String getter) {
        Object v = call(o, getter);
        return v == null ? null : String.valueOf(v);
    }

    private static Boolean readBool(Object o, String getter) {
        Object v = call(o, getter);
        return v instanceof Boolean b ? b : null;
    }

    /**
     * Reads one no-argument getter, tolerating a provider whose class references
     * types this runtime does not have.
     *
     * {@code getMethod} does not merely look up one method — it resolves the
     * parameter and return types of <em>every</em> public method on the class, so
     * a single unresolvable type anywhere on the provider throws
     * {@link NoClassDefFoundError} here even when the getter being asked for is a
     * plain {@code String}. That is a {@link LinkageError}, not a
     * {@link ReflectiveOperationException}, so catching only the latter let it
     * escape {@code describeProvider} and abort the whole plugin load.
     *
     * <p>The measured case was {@code CloudflareKiller}: providers that merely
     * declare an interceptor field failed to load entirely, having already
     * registered successfully, and the reported cause named a class they never
     * called. Degrading to a null field keeps the provider usable on every path
     * that does not touch the missing type — which is what {@code T3_DEGRADED}
     * exists to describe.
     */
    private static Object call(Object o, String getter) {
        try {
            Method m = o.getClass().getMethod(getter);
            m.setAccessible(true);
            return m.invoke(o);
        } catch (ReflectiveOperationException | LinkageError e) {
            return null;
        }
    }

    private static void trySetField(Object target, String field, Object value) {
        Class<?> c = target.getClass();
        while (c != null) {
            try {
                Field f = c.getDeclaredField(field);
                f.setAccessible(true);
                f.set(target, value);
                return;
            } catch (NoSuchFieldException e) {
                c = c.getSuperclass();
            } catch (IllegalAccessException e) {
                return;
            }
        }
    }

    public Set<String> loadedPluginIds() {
        return new LinkedHashSet<>(loaders.keySet());
    }

    /**
     * Drops every cached translation. Needed when the translator is upgraded,
     * since cache keys are archive hashes and would otherwise keep serving
     * output produced by the previous translator version.
     */
    public int clearTranslationCache() throws IOException {
        return translator.clearCache();
    }
}
