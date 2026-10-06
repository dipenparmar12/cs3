package com.cloudstream.desktop.sidecar;

import com.googlecode.d2j.Method;
import com.googlecode.d2j.dex.Dex2jar;
import com.googlecode.d2j.dex.DexExceptionHandler;
import com.googlecode.d2j.node.DexMethodNode;
import com.googlecode.d2j.reader.BaseDexFileReader;
import com.googlecode.d2j.reader.MultiDexFileReader;

import org.objectweb.asm.MethodVisitor;
import org.objectweb.asm.Opcodes;
import org.objectweb.asm.Type;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Enumeration;
import java.util.HexFormat;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;
import java.util.zip.ZipOutputStream;

/**
 * DEX to JVM bytecode translation for {@code .cs3} archives.
 *
 * Implements DROP-2..DROP-5 of docs/PRD/31: translation happens once at install
 * time, the result is cached beside the archive and invalidated by content hash,
 * the original {@code .cs3} is never modified, multi-DEX archives are handled,
 * and failure is a reportable outcome rather than a crash.
 *
 * The translator is dex2jar 2.4.38. That choice is not a guess — it was measured
 * against the full vendored corpus of 392 community plugins; see
 * docs/PRD/35-phase1-translation-spike-results.md and tools/dex-spike.
 */
public final class DexTranslator {

    /** Outcome of a translation attempt. Failure is data, never an exception to the caller. */
    public record Outcome(
            boolean ok,
            Path translatedJar,
            String sourceSha256,
            int dexCount,
            int classCount,
            String manifestClassName,
            boolean requiresResources,
            Integer manifestVersion,
            String manifestName,
            boolean fromCache,
            String failureKind,
            String failureDetail) {

        static Outcome failure(String kind, String detail) {
            return new Outcome(false, null, null, 0, 0, null, false, null, null, false, kind, detail);
        }
    }

    /**
     * Bumped whenever translated output changes shape.
     *
     * <p>The cache is keyed on the archive's content hash, which answers "is
     * this the same plugin" and nothing else. It does not answer "was this
     * translated by the current code", and that omission made a fixed bug come
     * back: {@link KotlinNameRepair} was corrected, and every plugin already in
     * the cache kept being served from its pre-fix jar, so
     * {@code kotlin.Result.constructor_impl} still failed on exactly the
     * installs that had been working longest. A fresh machine was fine and an
     * existing one was not, which is the worst possible signature.
     *
     * <p>Raise this by one for any change to translation or to the repair pass.
     * It costs one re-translation per plugin and nothing else.
     *
     * <p>2 — KotlinNameRepair rewrote only the first class carrying each broken
     * reference; every later class kept the underscore spelling.
     */
    private static final int CACHE_GENERATION = 2;

    /**
     * Serializes dex2jar translations across worker threads.
     *
     * dex2jar builds extensive in-memory AST and instruction structures. Running
     * multiple translations concurrently multiplies peak heap consumption and
     * leads to OutOfMemoryError on bulk updates or cold starts. Serializing
     * translation bounds peak memory to a single plugin at a time.
     */
    private static final Object TRANSLATION_LOCK = new Object();

    /**
     * Marks a translation that failed, so the next launch does not repeat it.
     *
     * <p>Without it a failure was rediscovered on every launch and every call
     * that reached the archive. For an archive whose translation exhausts the
     * heap that is not a slow failure but a destructive one: StreamPlay filled
     * a 4 GB heap each time, and the {@code OutOfMemoryError} took every other
     * extension's calls down with it. Twelve abandoned {@code .jar.tmp} files
     * for that one archive were sitting in a user's cache, one per attempt.
     */
    static final String FAILED_SUFFIX = ".failed";

    /**
     * A method dex2jar cannot convert becomes one that throws, instead of
     * failing the whole archive.
     *
     * <p>Without a handler dex2jar throws out of the translation and the
     * extension is lost over one method -- measured on StreamPlay, where a single
     * method past the JVM's 64 KB limit cost all of its providers. The provider
     * now loads and works everywhere except the path that calls that method,
     * which fails with a reason. Same rule as the android shim: concede the
     * type, refuse the operation.
     */
    private static final DexExceptionHandler REFUSE_FAILED_METHOD = new DexExceptionHandler() {
        @Override
        public void handleFileException(Exception e) {
            throw new IllegalStateException(e);
        }

        @Override
        public void handleMethodTranslateException(Method method, DexMethodNode node, MethodVisitor mv, Exception e) {
            System.err.println("DexTranslator: " + method + " could not be translated and will throw when called: " + e);
            int locals = (Type.getArgumentsAndReturnSizes(method.getDesc()) >> 2)
                    - ((node.access & Opcodes.ACC_STATIC) != 0 ? 1 : 0);
            mv.visitCode();
            mv.visitTypeInsn(Opcodes.NEW, "java/lang/UnsupportedOperationException");
            mv.visitInsn(Opcodes.DUP);
            mv.visitLdcInsn("This method could not be translated for the desktop runtime: " + method.getName());
            mv.visitMethodInsn(Opcodes.INVOKESPECIAL, "java/lang/UnsupportedOperationException", "<init>",
                    "(Ljava/lang/String;)V", false);
            mv.visitInsn(Opcodes.ATHROW);
            mv.visitMaxs(3, Math.max(locals, 0));
            mv.visitEnd();
        }
    };

    private final Path cacheRoot;

    /**
     * Repairs Kotlin's hyphenated method names, which dex2jar rewrites to
     * underscores. Built once and reused: it indexes every runtime jar, which
     * is not work worth repeating per plugin. Null when no classpath was given.
     */
    private final KotlinNameRepair nameRepair;

    public DexTranslator(Path cacheRoot) throws IOException {
        this(cacheRoot, null);
    }

    public DexTranslator(Path cacheRoot, Path runtimeClasspathDir) throws IOException {
        this.cacheRoot = cacheRoot;
        this.nameRepair = runtimeClasspathDir == null ? null : new KotlinNameRepair(runtimeClasspathDir);
        Files.createDirectories(cacheRoot);
        sweepAbandonedTemps();
    }

    /**
     * Translates {@code cs3} to a JVM jar, reusing a cached translation when the
     * archive's SHA-256 is unchanged.
     *
     * <p>The cache key is the content hash rather than the version field, because
     * a repository can republish a plugin without incrementing its version and a
     * stale translation would then be silently loaded.
     */
    /**
     * Removes this archive's translations from every other generation.
     *
     * Best-effort throughout: a jar that cannot be deleted is wasted disk, not
     * a failed translation, and the one being written does not depend on it.
     */
    private void discardOtherGenerations(String sha) {
        String keep = sha + ".g" + CACHE_GENERATION + ".jar";
        try (DirectoryStream<Path> stale = Files.newDirectoryStream(cacheRoot, sha + "*.jar")) {
            for (Path path : stale) {
                if (path.getFileName().toString().equals(keep)) continue;
                try {
                    Files.deleteIfExists(path);
                } catch (IOException ignored) {
                    // Held open by a live class loader; it will go on the next run.
                }
            }
        } catch (IOException ignored) {
            // No cache directory to sweep.
        }
    }

    public Outcome translate(Path cs3) {
        if (!Files.isRegularFile(cs3)) {
            return Outcome.failure("ARCHIVE_MISSING", "No file at " + cs3);
        }

        String sha;
        try {
            sha = sha256(Files.readAllBytes(cs3));
        } catch (IOException e) {
            return Outcome.failure("ARCHIVE_UNREADABLE", e.toString());
        }

        Manifest manifest;
        List<byte[]> dexes;
        try (ZipFile zf = new ZipFile(cs3.toFile())) {
            manifest = readManifest(zf);
            dexes = readDexes(zf);
        } catch (IOException e) {
            return Outcome.failure("ARCHIVE_UNREADABLE", e.toString());
        }

        if (manifest == null || manifest.pluginClassName == null) {
            return Outcome.failure("MANIFEST_INVALID",
                    "manifest.json is absent or has no pluginClassName; the plugin has no entry point.");
        }
        if (dexes.isEmpty()) {
            return Outcome.failure("NO_DEX",
                    "Archive contains no classes.dex; it is not an Android-built CloudStream extension.");
        }

        Path out = cacheRoot.resolve(sha + ".g" + CACHE_GENERATION + ".jar");
        if (Files.isRegularFile(out)) {
            return new Outcome(true, out, sha, dexes.size(), countClasses(out),
                    manifest.pluginClassName, manifest.requiresResources, manifest.version,
                    manifest.name, true, null, null);
        }

        // A translation that failed for these exact bytes is not attempted again
        // — see FAILED_SUFFIX. The archive's hash is in the name, so an update
        // is a fresh attempt, and the generation is too, so a translator fix is.
        Path failed = cacheRoot.resolve(sha + ".g" + CACHE_GENERATION + FAILED_SUFFIX);
        if (Files.isRegularFile(failed)) {
            return Outcome.failure("TRANSLATION_FAILED", readFailure(failed));
        }

        synchronized (TRANSLATION_LOCK) {
            // Re-check cache under lock in case another worker thread just completed it
            if (Files.isRegularFile(out)) {
                return new Outcome(true, out, sha, dexes.size(), countClasses(out),
                        manifest.pluginClassName, manifest.requiresResources, manifest.version,
                        manifest.name, true, null, null);
            }

            // Translate to a temp file and move into place, so an interrupted run can
            // never leave a partial jar that a later load would treat as cached.
            Path tmp = cacheRoot.resolve(sha + "." + UUID.randomUUID() + ".jar.tmp");
            // Superseded jars for this archive are dead weight the moment the
            // generation moves; removing them here rather than in a startup sweep
            // keeps the clean-up next to the thing that caused it.
            discardOtherGenerations(sha);
            try {
                BaseDexFileReader reader = MultiDexFileReader.open(packForReader(dexes));
                Set<String> oversized = OversizedMethods.find(reader);
                if (!oversized.isEmpty()) {
                    System.err.println("DexTranslator: " + oversized.size()
                            + " method(s) too large for the JVM will throw when called: " + oversized);
                }
                Dex2jar.from(OversizedMethods.stubbing(reader, oversized))
                        .withExceptionHandler(REFUSE_FAILED_METHOD)
                        .skipDebug(false)
                        .topoLogicalSort()
                        .noCode(false)
                        .to(tmp);

                // Before the jar becomes a cache entry, not after: the cache is
                // keyed by the archive's hash and a repaired jar must be what a
                // later cache hit serves, or the fix would apply only on the very
                // first load of each plugin.
                if (nameRepair != null) nameRepair.repair(tmp);

                Files.move(tmp, out, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
            } catch (Throwable t) {
                // dex2jar throws Errors as well as Exceptions on malformed input.
                try { Files.deleteIfExists(tmp); } catch (IOException ignored) { }
                /*
                 * No retry, including after OutOfMemoryError. There used to be
                 * one, "in case freed memory allows translation to succeed" -- it
                 * never did: the archive that exhausts the heap exhausts it again,
                 * so the retry doubled the time the sidecar spent unable to
                 * answer anything. The failure is written down instead.
                 */
                if (t instanceof OutOfMemoryError) System.gc();
                String detail = t.getClass().getSimpleName() + ": " + t.getMessage();
                // An I/O failure -- a locked file, a full disk -- is about this
                // machine at this moment, not about the archive, and is retried.
                if (!(t instanceof java.nio.file.FileSystemException)) recordFailure(failed, detail);
                return Outcome.failure("TRANSLATION_FAILED", detail);
            }

            int classes = countClasses(out);
            if (classes == 0) {
                try { Files.deleteIfExists(out); } catch (IOException ignored) { }
                return Outcome.failure("TRANSLATION_EMPTY", "Translation produced no classes.");
            }

            // Free AST buffers if heap is under pressure (>70% of max heap)
            long free = Runtime.getRuntime().freeMemory();
            long total = Runtime.getRuntime().totalMemory();
            long max = Runtime.getRuntime().maxMemory();
            if ((total - free) > (max * 0.70)) {
                System.gc();
            }

            return new Outcome(true, out, sha, dexes.size(), classes,
                    manifest.pluginClassName, manifest.requiresResources, manifest.version,
                    manifest.name, false, null, null);
        }
    }

    /** Drops every cached translation, and every recorded failure with them. */
    public int clearCache() throws IOException {
        int n = 0;
        try (DirectoryStream<Path> ds = Files.newDirectoryStream(cacheRoot, "*.{jar,failed}")) {
            for (Path p : ds) { Files.deleteIfExists(p); n++; }
        }
        return n;
    }

    private static void recordFailure(Path marker, String detail) {
        try {
            Files.writeString(marker, detail == null ? "" : detail, StandardCharsets.UTF_8);
        } catch (IOException ignored) {
            // Unrecorded means it is tried again next time, which is the old behaviour.
        }
    }

    private static String readFailure(Path marker) {
        try {
            String detail = Files.readString(marker, StandardCharsets.UTF_8).trim();
            return detail.isEmpty() ? "Translation failed on an earlier attempt." : detail;
        } catch (IOException e) {
            return "Translation failed on an earlier attempt.";
        }
    }

    /**
     * Temp files a killed or out-of-memory translation left behind.
     *
     * Only old ones: a temp file younger than an hour may belong to a
     * translation in progress, and deleting it would fail that run.
     */
    private void sweepAbandonedTemps() {
        long cutoff = System.currentTimeMillis() - 60 * 60 * 1000L;
        try (DirectoryStream<Path> temps = Files.newDirectoryStream(cacheRoot, "*.jar.tmp")) {
            for (Path temp : temps) {
                try {
                    if (Files.getLastModifiedTime(temp).toMillis() < cutoff) Files.deleteIfExists(temp);
                } catch (IOException ignored) {
                    // Held or already gone.
                }
            }
        } catch (IOException ignored) {
            // No cache directory yet.
        }
    }

    // --- archive reading -----------------------------------------------------

    record Manifest(String name, String pluginClassName, Integer version, boolean requiresResources) { }

    private static Manifest readManifest(ZipFile zf) throws IOException {
        ZipEntry e = zf.getEntry("manifest.json");
        if (e == null) return null;
        String json;
        try (InputStream is = zf.getInputStream(e)) {
            json = new String(is.readAllBytes(), StandardCharsets.UTF_8);
        }
        return new Manifest(
                Json.string(json, "name"),
                Json.string(json, "pluginClassName"),
                Json.integer(json, "version"),
                Boolean.TRUE.equals(Json.bool(json, "requiresResources")));
    }

    private static List<byte[]> readDexes(ZipFile zf) throws IOException {
        List<byte[]> out = new ArrayList<>();
        Enumeration<? extends ZipEntry> en = zf.entries();
        while (en.hasMoreElements()) {
            ZipEntry e = en.nextElement();
            if (!e.getName().matches("(?i)classes\\d*\\.dex")) continue;
            try (InputStream is = zf.getInputStream(e)) {
                out.add(is.readAllBytes());
            }
        }
        return out;
    }

    /**
     * dex2jar's multi-dex reader takes either a single DEX or a zip of DEX
     * entries, so a multi-DEX archive is repacked rather than concatenated
     * (DROP-5). Concatenating DEX files produces an invalid container.
     */
    private static byte[] packForReader(List<byte[]> dexes) throws IOException {
        if (dexes.size() == 1) return dexes.get(0);
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        try (ZipOutputStream zos = new ZipOutputStream(bos)) {
            for (int i = 0; i < dexes.size(); i++) {
                zos.putNextEntry(new ZipEntry(i == 0 ? "classes.dex" : "classes" + (i + 1) + ".dex"));
                zos.write(dexes.get(i));
                zos.closeEntry();
            }
        }
        return bos.toByteArray();
    }

    private static int countClasses(Path jar) {
        int n = 0;
        try (ZipFile zf = new ZipFile(jar.toFile())) {
            Enumeration<? extends ZipEntry> en = zf.entries();
            while (en.hasMoreElements()) {
                if (en.nextElement().getName().endsWith(".class")) n++;
            }
        } catch (IOException e) {
            return 0;
        }
        return n;
    }

    static String sha256(byte[] data) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(data));
        } catch (Exception e) {
            throw new IllegalStateException("SHA-256 unavailable", e);
        }
    }
}
