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

    private ClassLoader shared;
    private String classpathProblem;

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

        // Step 4 — the plugin's own loader over the translated archive.
        PluginClassLoader loader = new PluginClassLoader(
                pluginId, new URL[]{t.translatedJar().toUri().toURL()}, shared());

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

        List<Map<String, Object>> providers = diffProviders(loader, before);

        loaders.put(pluginId, loader);
        instances.put(pluginId, instance);

        LinkageAnalyzer.Report report =
                new LinkageAnalyzer(shared()).analyze(t.translatedJar(), entry);

        return new Loaded(pluginId, entry, name, version, providers, report);
    }

    /** Calls {@code beforeUnload()} then drops the loader (DROP-14). */
    public boolean unload(String pluginId) {
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

    private List<Map<String, Object>> diffProviders(ClassLoader loader, Object before) {
        List<?> all = apiHolderProviders(loader);
        if (all == null) return List.of();
        int start = before instanceof List<?> l ? l.size() : 0;
        List<Map<String, Object>> out = new ArrayList<>();
        for (int i = start; i < all.size(); i++) {
            out.add(describeProvider(all.get(i)));
        }
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

    private static Object call(Object o, String getter) {
        try {
            Method m = o.getClass().getMethod(getter);
            m.setAccessible(true);
            return m.invoke(o);
        } catch (ReflectiveOperationException e) {
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
