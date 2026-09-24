package com.cloudstream.desktop.sidecar;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.objectweb.asm.ClassWriter;
import org.objectweb.asm.MethodVisitor;
import org.objectweb.asm.Opcodes;

import java.io.IOException;
import java.lang.reflect.Method;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.List;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

import static org.junit.jupiter.api.Assertions.*;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

/**
 * Unloading has to let go of the archive, and of everything the archive put in
 * the ecosystem's global lists.
 *
 * <p>Both failures are silent where they happen and loud somewhere else. A class
 * loader left open holds a Windows handle on the {@code .cs3}, and the next
 * update of that extension fails its rename with {@code EPERM} — measured on a
 * real install, for the one extension that fails at {@code load()} on every
 * launch. A provider left in {@code APIHolder.allProviders} after its loader is
 * closed is found later by somebody else's lookup and throws there.
 *
 * <p>The move assertions are what fail without the fix, and only on Windows,
 * which is where the bug lives: elsewhere an open file can be renamed.
 */
class PluginUnloadTest {

    private static final String BASE_PLUGIN = "com/lagradost/cloudstream3/plugins/BasePlugin";
    private static final String MAIN_API = "com/lagradost/cloudstream3/MainAPI";
    private static final String ANNOTATION = "Lcom/lagradost/cloudstream3/plugins/CloudstreamPlugin;";

    private static Path runtimeDir() {
        Path dir = Paths.get("runtime").toAbsolutePath();
        return Files.isDirectory(dir) ? dir : Paths.get("sidecar", "runtime").toAbsolutePath();
    }

    private static boolean runtimeIsBuilt(Path dir) {
        if (!Files.isDirectory(dir)) return false;
        try (var jars = Files.list(dir)) {
            return jars.anyMatch(p -> p.getFileName().toString().startsWith("library-jvm"));
        } catch (IOException e) {
            return false;
        }
    }

    private static PluginHost hostFor(Path runtime, Path temp) throws IOException {
        return new PluginHost(new DexTranslator(temp.resolve("cache"), runtime), runtime);
    }

    /** A plugin whose constructor throws, the way Ultima's load fails on desktop. */
    private static byte[] brokenPlugin() {
        ClassWriter cw = new ClassWriter(ClassWriter.COMPUTE_MAXS);
        cw.visit(Opcodes.V17, Opcodes.ACC_PUBLIC, "test/BrokenPlugin", null, BASE_PLUGIN, null);
        cw.visitAnnotation(ANNOTATION, true).visitEnd();
        MethodVisitor init = cw.visitMethod(Opcodes.ACC_PUBLIC, "<init>", "()V", null, null);
        init.visitCode();
        init.visitVarInsn(Opcodes.ALOAD, 0);
        init.visitMethodInsn(Opcodes.INVOKESPECIAL, BASE_PLUGIN, "<init>", "()V", false);
        init.visitTypeInsn(Opcodes.NEW, "java/lang/IllegalStateException");
        init.visitInsn(Opcodes.DUP);
        init.visitLdcInsn("needs the Android app");
        init.visitMethodInsn(Opcodes.INVOKESPECIAL, "java/lang/IllegalStateException",
                "<init>", "(Ljava/lang/String;)V", false);
        init.visitInsn(Opcodes.ATHROW);
        init.visitMaxs(0, 0);
        init.visitEnd();
        cw.visitEnd();
        return cw.toByteArray();
    }

    /** A plugin that registers one provider from `load()`, through the real BasePlugin. */
    private static byte[] registeringPlugin() {
        ClassWriter cw = new ClassWriter(ClassWriter.COMPUTE_MAXS);
        cw.visit(Opcodes.V17, Opcodes.ACC_PUBLIC, "test/GoodPlugin", null, BASE_PLUGIN, null);
        cw.visitAnnotation(ANNOTATION, true).visitEnd();

        MethodVisitor init = cw.visitMethod(Opcodes.ACC_PUBLIC, "<init>", "()V", null, null);
        init.visitCode();
        init.visitVarInsn(Opcodes.ALOAD, 0);
        init.visitMethodInsn(Opcodes.INVOKESPECIAL, BASE_PLUGIN, "<init>", "()V", false);
        init.visitInsn(Opcodes.RETURN);
        init.visitMaxs(0, 0);
        init.visitEnd();

        MethodVisitor load = cw.visitMethod(Opcodes.ACC_PUBLIC, "load", "()V", null, null);
        load.visitCode();
        load.visitVarInsn(Opcodes.ALOAD, 0);
        load.visitTypeInsn(Opcodes.NEW, "test/GoodApi");
        load.visitInsn(Opcodes.DUP);
        load.visitMethodInsn(Opcodes.INVOKESPECIAL, "test/GoodApi", "<init>", "()V", false);
        load.visitMethodInsn(Opcodes.INVOKEVIRTUAL, BASE_PLUGIN, "registerMainAPI",
                "(L" + MAIN_API + ";)V", false);
        load.visitInsn(Opcodes.RETURN);
        load.visitMaxs(0, 0);
        load.visitEnd();

        cw.visitEnd();
        return cw.toByteArray();
    }

    private static byte[] provider() {
        ClassWriter cw = new ClassWriter(ClassWriter.COMPUTE_MAXS);
        cw.visit(Opcodes.V17, Opcodes.ACC_PUBLIC, "test/GoodApi", null, MAIN_API, null);
        MethodVisitor init = cw.visitMethod(Opcodes.ACC_PUBLIC, "<init>", "()V", null, null);
        init.visitCode();
        init.visitVarInsn(Opcodes.ALOAD, 0);
        init.visitMethodInsn(Opcodes.INVOKESPECIAL, MAIN_API, "<init>", "()V", false);
        init.visitInsn(Opcodes.RETURN);
        init.visitMaxs(0, 0);
        init.visitEnd();
        cw.visitEnd();
        return cw.toByteArray();
    }

    private static Path jar(Path dir, String name, Object... entries) throws IOException {
        Path file = dir.resolve(name);
        try (ZipOutputStream zip = new ZipOutputStream(Files.newOutputStream(file))) {
            for (int i = 0; i < entries.length; i += 2) {
                zip.putNextEntry(new ZipEntry((String) entries[i]));
                zip.write((byte[]) entries[i + 1]);
                zip.closeEntry();
            }
        }
        return file;
    }

    /** Every provider in the shared APIHolder whose `sourcePlugin` names this archive. */
    private static long registeredFrom(PluginHost host, Path archive) throws Exception {
        ClassLoader shared = host.shared();
        Class<?> holder = Class.forName("com.lagradost.cloudstream3.APIHolder", true, shared);
        Class<?> mainApi = Class.forName("com.lagradost.cloudstream3.MainAPI", true, shared);
        Method source = mainApi.getMethod("getSourcePlugin");
        Object inst = holder.getField("INSTANCE").get(null);
        List<?> all = (List<?>) holder.getMethod("getAllProviders").invoke(inst);
        String stamp = archive.toAbsolutePath().toString();
        long count = 0;
        for (Object provider : List.copyOf(all)) {
            if (stamp.equals(source.invoke(provider))) count++;
        }
        return count;
    }

    @Test
    void aLoadThatFailsReleasesTheArchive(@TempDir Path temp) throws Exception {
        Path runtime = runtimeDir();
        assumeTrue(runtimeIsBuilt(runtime), "sidecar/runtime is not built");

        Path archive = jar(temp, "Broken.cs3", "test/BrokenPlugin.class", brokenPlugin());
        PluginHost host = hostFor(runtime, temp);

        assertThrows(Exception.class, () -> host.load("broken", archive));
        assertFalse(host.loadedPluginIds().contains("broken"));

        // An update replaces the archive in place. With the loader leaked this
        // throws "being used by another process" on Windows.
        archive.toFile().setWritable(true);
        Files.move(archive, temp.resolve("Broken.cs3.moved"));
    }

    @Test
    void unloadWithdrawsWhatThePluginRegisteredAndReleasesTheArchive(@TempDir Path temp)
            throws Exception {
        Path runtime = runtimeDir();
        assumeTrue(runtimeIsBuilt(runtime), "sidecar/runtime is not built");

        Path archive = jar(temp, "Good.cs3",
                "test/GoodPlugin.class", registeringPlugin(),
                "test/GoodApi.class", provider());
        PluginHost host = hostFor(runtime, temp);

        PluginHost.Loaded loaded = host.load("good", archive);
        assertEquals(1, loaded.providers().size(), "the fixture registers exactly one provider");
        assertEquals(1, registeredFrom(host, archive));

        assertTrue(host.unload("good"));
        assertEquals(0, registeredFrom(host, archive),
                "the provider outlived its unload and would be found by later lookups");

        archive.toFile().setWritable(true);
        Files.move(archive, temp.resolve("Good.cs3.moved"));
    }

    /**
     * Loading an id that is already loaded replaces it rather than leaking the
     * first copy — the host can ask for this after it has lost track of what
     * the JVM holds, and each leaked copy is another handle on the archive.
     */
    @Test
    void loadingTwiceReplacesTheFirstCopy(@TempDir Path temp) throws Exception {
        Path runtime = runtimeDir();
        assumeTrue(runtimeIsBuilt(runtime), "sidecar/runtime is not built");

        Path archive = jar(temp, "Good.cs3",
                "test/GoodPlugin.class", registeringPlugin(),
                "test/GoodApi.class", provider());
        PluginHost host = hostFor(runtime, temp);

        host.load("good", archive);
        host.load("good", archive);
        assertEquals(1, registeredFrom(host, archive), "the first copy's provider was left behind");

        assertTrue(host.unload("good"));
        archive.toFile().setWritable(true);
        Files.move(archive, temp.resolve("Good.cs3.moved"));
    }
}
