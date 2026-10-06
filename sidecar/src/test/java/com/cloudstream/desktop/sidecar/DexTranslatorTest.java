package com.cloudstream.desktop.sidecar;

import com.googlecode.d2j.dex.writer.DexFileWriter;
import com.googlecode.d2j.smali.Smali;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.lang.reflect.InvocationTargetException;
import java.net.URL;
import java.net.URLClassLoader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.stream.Stream;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

import static org.junit.jupiter.api.Assertions.*;

/**
 * The two ways one archive used to take the sidecar down with it.
 *
 * Found on a 468-archive install: StreamPlay's translation exhausted a 4 GB
 * heap on every launch, and the resulting {@code OutOfMemoryError} stalled
 * every other extension for fourteen minutes. See {@link OversizedMethods}.
 */
class DexTranslatorTest {

    private static Path archive(Path dir, String name, byte[] dex) throws Exception {
        Path cs3 = dir.resolve(name);
        try (ZipOutputStream z = new ZipOutputStream(Files.newOutputStream(cs3))) {
            z.putNextEntry(new ZipEntry("manifest.json"));
            z.write("{\"pluginClassName\":\"t.Big\",\"name\":\"Big\",\"version\":1}".getBytes(StandardCharsets.UTF_8));
            z.closeEntry();
            z.putNextEntry(new ZipEntry("classes.dex"));
            z.write(dex);
            z.closeEntry();
        }
        return cs3;
    }

    /** A class with one ordinary method and one past {@link OversizedMethods#STATEMENT_LIMIT}. */
    private static byte[] dexWithAnOversizedMethod() {
        StringBuilder smali = new StringBuilder()
                .append(".class public Lt/Big;\n.super Ljava/lang/Object;\n")
                .append(".method public static small()I\n  .registers 1\n  const/4 v0, 0x7\n  return v0\n.end method\n")
                .append(".method public static huge()I\n  .registers 2\n");
        for (int i = 0; i <= OversizedMethods.STATEMENT_LIMIT; i++) smali.append("  const/4 v0, 0x1\n");
        smali.append("  return v0\n.end method\n");
        DexFileWriter writer = new DexFileWriter();
        Smali.smaliFile("Big.smali", smali.toString(), writer);
        writer.visitEnd();
        return writer.toByteArray();
    }

    @Test
    void anOversizedMethodThrowsWhenCalledAndTheRestOfTheClassWorks(@TempDir Path dir) throws Exception {
        Path cs3 = archive(dir, "big.cs3", dexWithAnOversizedMethod());

        DexTranslator.Outcome o = new DexTranslator(dir.resolve("cache")).translate(cs3);

        // The extension is not lost over one method.
        assertTrue(o.ok(), o.failureKind() + ": " + o.failureDetail());
        try (URLClassLoader loader = new URLClassLoader(new URL[] {o.translatedJar().toUri().toURL()}, null)) {
            Class<?> big = loader.loadClass("t.Big");
            assertEquals(7, big.getMethod("small").invoke(null));
            InvocationTargetException thrown =
                    assertThrows(InvocationTargetException.class, () -> big.getMethod("huge").invoke(null));
            assertEquals("java.lang.UnsupportedOperationException", thrown.getCause().getClass().getName());
        }
    }

    @Test
    void aFailedTranslationIsRecordedAndNotAttemptedAgain(@TempDir Path dir) throws Exception {
        Path cs3 = archive(dir, "bad.cs3", new byte[] {'d', 'e', 'x', '\n', 0, 0, 0, 0, 1, 2, 3});
        Path cache = dir.resolve("cache");
        DexTranslator translator = new DexTranslator(cache);

        DexTranslator.Outcome first = translator.translate(cs3);
        assertFalse(first.ok());
        try (Stream<Path> files = Files.list(cache)) {
            assertTrue(files.anyMatch(p -> p.toString().endsWith(DexTranslator.FAILED_SUFFIX)),
                    "the failure must be written down, or every launch pays for it again");
        }

        // Same answer, from the record — and a new translator (a new launch) reads it too.
        DexTranslator.Outcome second = new DexTranslator(cache).translate(cs3);
        assertFalse(second.ok());
        assertEquals("TRANSLATION_FAILED", second.failureKind());
        assertEquals(first.failureDetail(), second.failureDetail());

        // Clearing the cache is how a person asks for another attempt.
        translator.clearCache();
        try (Stream<Path> files = Files.list(cache)) {
            assertFalse(files.anyMatch(p -> p.toString().endsWith(DexTranslator.FAILED_SUFFIX)));
        }
    }

    @Test
    void temporaryFilesFromAnAbandonedRunAreSweptOnlyOnceTheyAreOld(@TempDir Path dir) throws Exception {
        Path cache = Files.createDirectories(dir.resolve("cache"));
        Path abandoned = Files.writeString(cache.resolve("abc.1.jar.tmp"), "x");
        Path current = Files.writeString(cache.resolve("abc.2.jar.tmp"), "x");
        Files.setLastModifiedTime(abandoned,
                java.nio.file.attribute.FileTime.fromMillis(System.currentTimeMillis() - 2 * 60 * 60 * 1000L));

        new DexTranslator(cache);

        assertFalse(Files.exists(abandoned));
        // A recent one may belong to a translation still running.
        assertTrue(Files.exists(current));
    }
}
