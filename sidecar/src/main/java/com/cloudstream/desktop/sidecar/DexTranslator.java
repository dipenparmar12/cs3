package com.cloudstream.desktop.sidecar;

import com.googlecode.d2j.dex.Dex2jar;
import com.googlecode.d2j.reader.BaseDexFileReader;
import com.googlecode.d2j.reader.MultiDexFileReader;

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

    private final Path cacheRoot;

    public DexTranslator(Path cacheRoot) throws IOException {
        this.cacheRoot = cacheRoot;
        Files.createDirectories(cacheRoot);
    }

    /**
     * Translates {@code cs3} to a JVM jar, reusing a cached translation when the
     * archive's SHA-256 is unchanged.
     *
     * <p>The cache key is the content hash rather than the version field, because
     * a repository can republish a plugin without incrementing its version and a
     * stale translation would then be silently loaded.
     */
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

        Path out = cacheRoot.resolve(sha + ".jar");
        if (Files.isRegularFile(out)) {
            return new Outcome(true, out, sha, dexes.size(), countClasses(out),
                    manifest.pluginClassName, manifest.requiresResources, manifest.version,
                    manifest.name, true, null, null);
        }

        // Translate to a temp file and move into place, so an interrupted run can
        // never leave a partial jar that a later load would treat as cached.
        Path tmp = cacheRoot.resolve(sha + ".jar.tmp");
        try {
            BaseDexFileReader reader = MultiDexFileReader.open(packForReader(dexes));
            Dex2jar.from(reader)
                    .skipDebug(false)
                    .topoLogicalSort()
                    .noCode(false)
                    .to(tmp);
            Files.move(tmp, out, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
        } catch (Throwable t) {
            // dex2jar throws Errors as well as Exceptions on malformed input.
            try { Files.deleteIfExists(tmp); } catch (IOException ignored) { }
            return Outcome.failure("TRANSLATION_FAILED",
                    t.getClass().getSimpleName() + ": " + t.getMessage());
        }

        int classes = countClasses(out);
        if (classes == 0) {
            try { Files.deleteIfExists(out); } catch (IOException ignored) { }
            return Outcome.failure("TRANSLATION_EMPTY", "Translation produced no classes.");
        }

        return new Outcome(true, out, sha, dexes.size(), classes,
                manifest.pluginClassName, manifest.requiresResources, manifest.version,
                manifest.name, false, null, null);
    }

    /** Drops every cached translation. Used when the translator itself is upgraded. */
    public int clearCache() throws IOException {
        int n = 0;
        try (DirectoryStream<Path> ds = Files.newDirectoryStream(cacheRoot, "*.jar")) {
            for (Path p : ds) { Files.deleteIfExists(p); n++; }
        }
        return n;
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
