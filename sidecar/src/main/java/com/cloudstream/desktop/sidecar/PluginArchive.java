package com.cloudstream.desktop.sidecar;

import org.objectweb.asm.AnnotationVisitor;
import org.objectweb.asm.ClassReader;
import org.objectweb.asm.ClassVisitor;
import org.objectweb.asm.Opcodes;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * What kind of extension archive this is, and how to open it.
 *
 * <p>Upstream's Gradle plugin has carried an {@code isCrossPlatform} flag for
 * some time. Setting it makes {@code :make} emit a plain JVM <b>jar</b> beside
 * the {@code .cs3}, runs {@code jdeps --print-module-deps} over that jar, and
 * <b>fails the build</b> if the output mentions {@code android.} — then writes
 * {@code jarUrl}, {@code jarHash} and {@code jarFileSize} into the published
 * plugin entry.
 *
 * <p>Measured against the live indexes on 2026-08-28: <b>5 of 5</b> extensions
 * in {@code recloudstream/extensions} and <b>47 of 79</b> in
 * {@code phisher98/cloudstream-extensions-phisher} already publish a
 * {@code jarUrl}, and every one checked matched its declared hash and size. So
 * this is not a lane we are asking anyone to adopt — it is a lane a large part
 * of the corpus is already publishing into, with no host reading it.
 *
 * <p>For an archive on that lane, the entire DEX pipeline is skipped: no
 * dex2jar, no {@link KotlinNameRepair}, no hash-keyed translation cache, no
 * concurrent-translation nonce, no dropping cached output on a runtime
 * generation bump. Every one of those has been a real defect in this repository
 * at least once. There is nothing to translate, so there is nothing to get
 * wrong.
 *
 * <p><b>What it does not retire, stated so it is not overclaimed:</b>
 * {@code jdeps} flags {@code android.*} and nothing else. A cross-platform jar
 * still links against {@code library-jvm} and can still reach the {@code :app}
 * types the bridge supplies — {@code Plugin}, {@code DataStore},
 * {@code CloudflareKiller}, {@code syncproviders}. {@link LinkageAnalyzer} still
 * runs and tiers still apply. This removes the <i>bytecode</i> problem, not the
 * <i>classpath</i> one.
 *
 * <h2>The one real difference at load time</h2>
 *
 * <p>A {@code .cs3} contains exactly two members: {@code manifest.json} and
 * {@code classes.dex} {@code [measured]}. The published jar contains
 * <b>neither</b> — it is the module's compiled output and nothing else, so
 * {@code manifest.json} is simply not there. Android's load sequence reads that
 * file through the class loader to learn {@code pluginClassName}, and on this
 * lane there is no file to read.
 *
 * <p>The entry class is recovered the same way upstream's build finds it in the
 * first place: by scanning for the {@code @CloudstreamPlugin} annotation.
 * Verified on {@code recloudstream/DailymotionPlugin.class}, which carries
 * {@code Lcom/lagradost/cloudstream3/plugins/CloudstreamPlugin;} and extends
 * {@code BasePlugin} {@code [measured]}. That is a stronger signal than a naming
 * convention: {@code *Plugin.class} is a convention authors are free to ignore,
 * and the annotation is what the build itself is keyed on.
 */
public final class PluginArchive {

    /** Which pipeline an archive goes through. */
    public enum Lane {
        /** A {@code .cs3}: Android DEX, translated to JVM bytecode at install. */
        DEX,
        /** A cross-platform jar: JVM bytecode already, loaded as-is. */
        JAR
    }

    /** The annotation upstream's build scans for to generate {@code manifest.json}. */
    private static final String PLUGIN_ANNOTATION =
            "Lcom/lagradost/cloudstream3/plugins/CloudstreamPlugin;";

    private PluginArchive() {
    }

    /**
     * Classifies an archive by what is inside it, never by its file extension.
     *
     * <p>The extension is chosen by whoever downloaded the file and is exactly
     * the sort of thing that drifts — a repository that renames its artifacts,
     * an install path written by an older version of this app, a user pointing
     * at a file by hand. The contents cannot drift: a DEX archive has a
     * {@code .dex} member and a jar has {@code .class} members, and no real
     * archive has both.
     *
     * <p>Defaults to {@link Lane#DEX} when it cannot tell, because that is the
     * path with the diagnosis attached — {@link DexTranslator} reports a
     * specific failure kind for an archive it cannot open, where the jar path
     * would fail later and less legibly.
     */
    public static Lane detect(Path archive) {
        boolean sawClass = false;
        try (ZipInputStream zip = new ZipInputStream(Files.newInputStream(archive))) {
            for (ZipEntry entry = zip.getNextEntry(); entry != null; entry = zip.getNextEntry()) {
                String name = entry.getName();
                if (name.endsWith(".dex")) return Lane.DEX;
                if (name.endsWith(".class")) sawClass = true;
            }
        } catch (IOException e) {
            return Lane.DEX;
        }
        return sawClass ? Lane.JAR : Lane.DEX;
    }

    /** What a jar told us about itself, in place of the {@code manifest.json} it has none of. */
    public record JarManifest(String entryClass, List<String> candidates) {
    }

    /**
     * Finds the {@code @CloudstreamPlugin} class inside a jar.
     *
     * <p>Every candidate is collected rather than returning at the first hit,
     * because an archive with two annotated classes is a real possibility and
     * silently picking whichever the zip happened to list first would make the
     * choice unreproducible. The list travels with the answer so the failure can
     * name both.
     */
    public static JarManifest readJarManifest(Path jar) throws IOException {
        List<String> found = new ArrayList<>();

        try (ZipInputStream zip = new ZipInputStream(Files.newInputStream(jar))) {
            for (ZipEntry entry = zip.getNextEntry(); entry != null; entry = zip.getNextEntry()) {
                String name = entry.getName();
                if (!name.endsWith(".class")) continue;
                // A nested or synthetic class is never the entry point, and
                // skipping them is most of the scan on a large extension.
                if (name.contains("$")) continue;

                byte[] bytes = readAll(zip);
                if (bytes.length == 0) continue;

                String className = annotatedPluginClass(bytes);
                if (className != null) found.add(className);
            }
        }

        return new JarManifest(found.size() == 1 ? found.get(0) : null, found);
    }

    /**
     * The class's binary name if it carries the annotation, else null.
     *
     * <p>Read with ASM rather than by loading the class: resolving it would need
     * the whole runtime classpath and would run its static initialisers, which
     * is plugin code executing before anything has decided it is allowed to.
     * The annotation is a constant-pool entry, so reading it costs a parse.
     */
    private static String annotatedPluginClass(byte[] classBytes) {
        String[] hit = new String[1];
        String[] self = new String[1];

        try {
            new ClassReader(classBytes).accept(new ClassVisitor(Opcodes.ASM9) {
                @Override
                public void visit(int version, int access, String name, String signature,
                                  String superName, String[] interfaces) {
                    self[0] = name;
                }

                @Override
                public AnnotationVisitor visitAnnotation(String descriptor, boolean visible) {
                    if (PLUGIN_ANNOTATION.equals(descriptor)) hit[0] = self[0];
                    return null;
                }
            }, ClassReader.SKIP_CODE | ClassReader.SKIP_DEBUG | ClassReader.SKIP_FRAMES);
        } catch (RuntimeException e) {
            // A class file this reader cannot parse is not the entry point we
            // are looking for. Failing the whole scan over one would lose an
            // extension for a class it may never have used.
            return null;
        }

        return hit[0] == null ? null : hit[0].replace('/', '.');
    }

    private static byte[] readAll(InputStream in) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buffer = new byte[8192];
        for (int read = in.read(buffer); read > 0; read = in.read(buffer)) {
            out.write(buffer, 0, read);
        }
        return out.toByteArray();
    }

    /** Counts {@code .class} members, so the jar lane can report what the DEX lane reports. */
    public static int countClasses(Path jar) {
        int count = 0;
        try (ZipInputStream zip = new ZipInputStream(Files.newInputStream(jar))) {
            for (ZipEntry entry = zip.getNextEntry(); entry != null; entry = zip.getNextEntry()) {
                if (entry.getName().endsWith(".class")) count++;
            }
        } catch (IOException e) {
            return 0;
        }
        return count;
    }
}
