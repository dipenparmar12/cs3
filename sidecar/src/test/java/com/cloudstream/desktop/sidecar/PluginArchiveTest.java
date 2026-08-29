package com.cloudstream.desktop.sidecar;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.objectweb.asm.AnnotationVisitor;
import org.objectweb.asm.ClassWriter;
import org.objectweb.asm.Opcodes;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Telling a cross-platform jar from a {@code .cs3}, and finding its entry point.
 *
 * <p>These rows guard the two failures the jar lane can have, and both are the
 * kind that report the wrong party. Mistaking a jar for a DEX archive sends it
 * to dex2jar, which answers "no classes.dex" — a translation error for an
 * archive that never needed translating, and the reader goes looking at the
 * translator. Failing to find the entry class produces an extension that
 * installs, verifies and registers nothing, which is indistinguishable from a
 * provider whose site is down.
 *
 * <p>The class files here are synthesised with ASM rather than checked in.
 * A committed binary fixture is one nobody can read in a diff and nobody
 * updates; generating it states the shape being tested in the test itself.
 */
class PluginArchiveTest {

    private static final String ANNOTATION = "Lcom/lagradost/cloudstream3/plugins/CloudstreamPlugin;";

    /**
     * A class file shaped like a real published one.
     *
     * Modelled on {@code recloudstream/DailymotionPlugin.class} from
     * {@code recloudstream/extensions}, which carries the annotation and extends
     * {@code BasePlugin} `[measured]`.
     */
    private static byte[] classFile(String internalName, boolean annotated) {
        ClassWriter cw = new ClassWriter(0);
        cw.visit(Opcodes.V17, Opcodes.ACC_PUBLIC, internalName, null,
                "com/lagradost/cloudstream3/plugins/BasePlugin", null);
        if (annotated) {
            AnnotationVisitor av = cw.visitAnnotation(ANNOTATION, true);
            av.visitEnd();
        }
        cw.visitEnd();
        return cw.toByteArray();
    }

    private static Path jar(Path dir, String name, String... entries) throws IOException {
        Path file = dir.resolve(name);
        try (ZipOutputStream zip = new ZipOutputStream(Files.newOutputStream(file))) {
            for (int i = 0; i < entries.length; i += 2) {
                String path = entries[i];
                boolean annotated = Boolean.parseBoolean(entries[i + 1]);
                zip.putNextEntry(new ZipEntry(path));
                zip.write(classFile(path.substring(0, path.length() - ".class".length()), annotated));
                zip.closeEntry();
            }
        }
        return file;
    }

    // --- which lane -----------------------------------------------------------

    @Test
    void anArchiveWithADexIsTheDexLane(@TempDir Path dir) throws Exception {
        Path cs3 = dir.resolve("Provider.cs3");
        try (ZipOutputStream zip = new ZipOutputStream(Files.newOutputStream(cs3))) {
            zip.putNextEntry(new ZipEntry("manifest.json"));
            zip.write("{\"pluginClassName\":\"x.Y\"}".getBytes(StandardCharsets.UTF_8));
            zip.closeEntry();
            zip.putNextEntry(new ZipEntry("classes.dex"));
            zip.write(new byte[]{ 'd', 'e', 'x', '\n' });
            zip.closeEntry();
        }
        assertEquals(PluginArchive.Lane.DEX, PluginArchive.detect(cs3));
    }

    @Test
    void anArchiveOfClassFilesIsTheJarLane(@TempDir Path dir) throws Exception {
        Path file = jar(dir, "Provider.csj", "recloudstream/DailymotionPlugin.class", "true");
        assertEquals(PluginArchive.Lane.JAR, PluginArchive.detect(file));
    }

    /**
     * The extension is not the evidence.
     *
     * Whoever downloaded the file chose the name, and that is exactly the sort
     * of thing that drifts — a repository renaming its artifacts, an install
     * path written by an older version of this app. The contents cannot drift.
     */
    @Test
    void theLaneComesFromTheContentsNotTheFileName(@TempDir Path dir) throws Exception {
        Path misnamed = jar(dir, "Provider.cs3", "com/example/ExamplePlugin.class", "true");
        assertEquals(PluginArchive.Lane.JAR, PluginArchive.detect(misnamed));
    }

    /**
     * An archive that is neither goes down the DEX path, because that is the
     * path with a diagnosis attached: `DexTranslator` names a specific failure
     * kind, where the jar path would fail later and less legibly.
     */
    @Test
    void anUnrecognisableArchiveFallsBackToTheDexLane(@TempDir Path dir) throws Exception {
        Path empty = dir.resolve("empty.bin");
        Files.write(empty, "not a zip at all".getBytes(StandardCharsets.UTF_8));
        assertEquals(PluginArchive.Lane.DEX, PluginArchive.detect(empty));
    }

    // --- finding the entry point ---------------------------------------------

    @Test
    void theAnnotatedClassIsTheEntryPoint(@TempDir Path dir) throws Exception {
        Path file = jar(dir, "Provider.csj",
                "recloudstream/DailymotionProvider.class", "false",
                "recloudstream/DailymotionPlugin.class", "true");

        PluginArchive.JarManifest manifest = PluginArchive.readJarManifest(file);
        assertEquals("recloudstream.DailymotionPlugin", manifest.entryClass());
    }

    /**
     * A jar with no annotated class has no entry point, and must say so rather
     * than guessing. `*Plugin.class` is a convention authors are free to ignore;
     * the annotation is what upstream's own build is keyed on.
     */
    @Test
    void aJarWithNoAnnotatedClassHasNoEntryPoint(@TempDir Path dir) throws Exception {
        Path file = jar(dir, "Provider.csj", "com/example/NotAPlugin.class", "false");

        PluginArchive.JarManifest manifest = PluginArchive.readJarManifest(file);
        assertNull(manifest.entryClass());
        assertTrue(manifest.candidates().isEmpty());
    }

    /**
     * Two entry points is an author error, and picking one silently would make
     * which provider loads a property of zip ordering — reproducible on the
     * machine it was built on and not on anyone else's.
     */
    @Test
    void twoAnnotatedClassesAreReportedRatherThanArbitrated(@TempDir Path dir) throws Exception {
        Path file = jar(dir, "Provider.csj",
                "com/example/FirstPlugin.class", "true",
                "com/example/SecondPlugin.class", "true");

        PluginArchive.JarManifest manifest = PluginArchive.readJarManifest(file);
        assertNull(manifest.entryClass(), "an ambiguous jar must not be resolved by luck");
        assertEquals(2, manifest.candidates().size());
        assertTrue(manifest.candidates().contains("com.example.FirstPlugin"));
        assertTrue(manifest.candidates().contains("com.example.SecondPlugin"));
    }

    /**
     * A Kotlin extension emits dozens of synthetic and nested classes per source
     * file — lambdas, coroutine state machines, `$Companion`. None of them is
     * ever the entry point, and skipping them is most of the scan.
     */
    @Test
    void nestedAndSyntheticClassesAreNotScanned(@TempDir Path dir) throws Exception {
        Path file = jar(dir, "Provider.csj",
                "com/example/RealPlugin.class", "true",
                "com/example/RealPlugin$load$1.class", "true");

        PluginArchive.JarManifest manifest = PluginArchive.readJarManifest(file);
        assertEquals("com.example.RealPlugin", manifest.entryClass());
    }

    /**
     * A class file the reader cannot parse must not lose the extension. It is
     * one member of an archive that may hold fifty, and refusing the whole jar
     * over a class the plugin may never touch is the wrong trade.
     */
    @Test
    void anUnparseableClassIsSkippedRatherThanFatal(@TempDir Path dir) throws Exception {
        Path file = dir.resolve("Provider.csj");
        try (ZipOutputStream zip = new ZipOutputStream(Files.newOutputStream(file))) {
            zip.putNextEntry(new ZipEntry("com/example/Broken.class"));
            zip.write(new byte[]{ (byte) 0xCA, (byte) 0xFE, 0x00, 0x01 });
            zip.closeEntry();
            zip.putNextEntry(new ZipEntry("com/example/RealPlugin.class"));
            zip.write(classFile("com/example/RealPlugin", true));
            zip.closeEntry();
        }

        PluginArchive.JarManifest manifest = PluginArchive.readJarManifest(file);
        assertEquals("com.example.RealPlugin", manifest.entryClass());
    }

    @Test
    void classesAreCountedSoTheJarLaneReportsWhatTheDexLaneReports(@TempDir Path dir)
            throws Exception {
        Path file = jar(dir, "Provider.csj",
                "com/example/RealPlugin.class", "true",
                "com/example/RealPlugin$load$1.class", "false",
                "com/example/Helper.class", "false");

        assertEquals(3, PluginArchive.countClasses(file));
    }
}
