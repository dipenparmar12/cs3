package cs3.spike;

import org.objectweb.asm.*;

import java.io.ByteArrayOutputStream;
import java.nio.file.*;
import java.util.*;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * Measures the exact runtime classpath the JVM sidecar must supply.
 *
 * Doc 31 §2.3/§2.4 surveyed Kotlin *imports* in provider source. This surveys
 * the translated *bytecode* of the shipped artifacts, which is what actually
 * has to link. It reports every external type a plugin references but does not
 * itself contain, bucketed by owner, so the shim inventory is derived from
 * evidence rather than estimated.
 */
public final class ClasspathSurvey {

    public static void main(String[] args) throws Exception {
        Path dir = Paths.get(args[0]);

        // type -> number of distinct plugins referencing it
        Map<String, Set<String>> refToPlugins = new HashMap<>();
        Map<String, Set<String>> memberRefs = new HashMap<>(); // owner#member for :app + android
        Set<String> selfContained = new HashSet<>();
        int plugins = 0;

        List<Path> jars = new ArrayList<>();
        try (DirectoryStream<Path> ds = Files.newDirectoryStream(dir, "*.translated.jar")) {
            for (Path p : ds) jars.add(p);
        }
        Collections.sort(jars);

        for (Path jar : jars) {
            plugins++;
            String plugin = jar.getFileName().toString().replaceAll("\\.translated\\.jar$", "");
            Map<String, byte[]> classes = readJar(jar);
            Set<String> owned = new HashSet<>();
            for (String k : classes.keySet()) owned.add(k.replaceAll("\\.class$", ""));
            selfContained.addAll(owned);

            Set<String> external = new HashSet<>();
            Set<String> members = new HashSet<>();
            for (byte[] b : classes.values()) collect(b, external, members);

            for (String t : external) {
                if (owned.contains(t)) continue;
                refToPlugins.computeIfAbsent(t, k -> new HashSet<>()).add(plugin);
            }
            for (String m : members) {
                String owner = m.substring(0, m.indexOf('#'));
                if (owned.contains(owner)) continue;
                memberRefs.computeIfAbsent(m, k -> new HashSet<>()).add(plugin);
            }
        }

        System.out.println("plugins analysed: " + plugins);
        System.out.println("distinct external types referenced: " + refToPlugins.size());

        // --- bucket by owner -------------------------------------------------
        Map<String, Integer> buckets = new TreeMap<>();
        for (var e : refToPlugins.entrySet()) {
            buckets.merge(bucket(e.getKey()), 1, Integer::sum);
        }
        System.out.println("\n=== EXTERNAL TYPES BY OWNER (distinct types) ===");
        buckets.entrySet().stream()
                .sorted((a, b) -> b.getValue() - a.getValue())
                .forEach(e -> System.out.printf("  %-28s %5d%n", e.getKey(), e.getValue()));

        dump("ANDROID SURFACE (must be shimmed)", refToPlugins, t -> t.startsWith("android/"), 200);
        dump("CLOUDSTREAM :app + :library SURFACE", refToPlugins,
                t -> t.startsWith("com/lagradost/"), 400);
        dump("THIRD-PARTY LIBRARIES (host must provide)", refToPlugins,
                t -> !t.startsWith("android")
                        && !t.startsWith("com/lagradost/")
                        && !t.startsWith("java/")
                        && !t.startsWith("javax/")
                        && !t.startsWith("kotlin/")
                        && !t.startsWith("kotlinx/")
                        && !selfContained.contains(t), 120);

        System.out.println("\n=== ANDROID MEMBERS ACTUALLY CALLED ===");
        memberRefs.entrySet().stream()
                .filter(e -> e.getKey().startsWith("android/"))
                .sorted((a, b) -> b.getValue().size() - a.getValue().size())
                .limit(80)
                .forEach(e -> System.out.printf("  %-72s %4d plugins%n", e.getKey(), e.getValue().size()));
    }

    private static void dump(String title, Map<String, Set<String>> refs,
                             java.util.function.Predicate<String> filter, int limit) {
        System.out.println("\n=== " + title + " ===");
        refs.entrySet().stream()
                .filter(e -> filter.test(e.getKey()))
                .sorted((a, b) -> b.getValue().size() - a.getValue().size())
                .limit(limit)
                .forEach(e -> System.out.printf("  %-74s %4d plugins%n", e.getKey(), e.getValue().size()));
    }

    private static String bucket(String t) {
        if (t.startsWith("android/")) return "android.*  [SHIM]";
        if (t.startsWith("com/lagradost/")) return "com.lagradost.*  [API]";
        if (t.startsWith("kotlin/") || t.startsWith("kotlinx/")) return "kotlin/kotlinx";
        if (t.startsWith("java/") || t.startsWith("javax/")) return "JDK";
        if (t.startsWith("okhttp3/") || t.startsWith("okio/")) return "okhttp/okio";
        if (t.startsWith("org/jsoup/")) return "jsoup";
        if (t.startsWith("com/fasterxml/")) return "jackson";
        if (t.startsWith("com/google/gson/")) return "gson";
        if (t.startsWith("org/json/")) return "org.json";
        if (t.startsWith("org/mozilla/")) return "rhino (JS engine)";
        return "other third-party";
    }

    private static void collect(byte[] b, Set<String> types, Set<String> members) {
        ClassReader cr = new ClassReader(b);
        cr.accept(new ClassVisitor(Opcodes.ASM9) {
            @Override public void visit(int v, int a, String name, String sig, String sup, String[] itf) {
                addType(types, sup);
                if (itf != null) for (String i : itf) addType(types, i);
            }
            @Override public FieldVisitor visitField(int a, String n, String d, String s, Object val) {
                addDesc(types, d);
                return null;
            }
            @Override public MethodVisitor visitMethod(int a, String n, String d, String s, String[] ex) {
                addDesc(types, d);
                if (ex != null) for (String e : ex) addType(types, e);
                return new MethodVisitor(Opcodes.ASM9) {
                    @Override public void visitTypeInsn(int op, String type) { addType(types, type); }
                    @Override public void visitFieldInsn(int op, String owner, String name, String desc) {
                        addType(types, owner); addDesc(types, desc);
                        if (owner.startsWith("android/") || owner.startsWith("com/lagradost/"))
                            members.add(owner + "#" + name);
                    }
                    @Override public void visitMethodInsn(int op, String owner, String name, String desc, boolean itf) {
                        addType(types, owner); addDesc(types, desc);
                        if (owner.startsWith("android/") || owner.startsWith("com/lagradost/"))
                            members.add(owner + "#" + name + desc);
                    }
                };
            }
        }, ClassReader.SKIP_DEBUG | ClassReader.SKIP_FRAMES);
    }

    private static void addType(Set<String> out, String internal) {
        if (internal == null) return;
        if (internal.startsWith("[")) { addDesc(out, internal); return; }
        out.add(internal);
    }

    private static void addDesc(Set<String> out, String desc) {
        if (desc == null) return;
        int i = 0;
        while (i < desc.length()) {
            char c = desc.charAt(i);
            if (c == 'L') {
                int end = desc.indexOf(';', i);
                if (end < 0) return;
                out.add(desc.substring(i + 1, end));
                i = end + 1;
            } else i++;
        }
    }

    private static Map<String, byte[]> readJar(Path jar) throws Exception {
        Map<String, byte[]> out = new TreeMap<>();
        try (ZipInputStream zis = new ZipInputStream(Files.newInputStream(jar))) {
            ZipEntry e;
            while ((e = zis.getNextEntry()) != null) {
                if (!e.getName().endsWith(".class")) continue;
                ByteArrayOutputStream bos = new ByteArrayOutputStream();
                zis.transferTo(bos);
                out.put(e.getName(), bos.toByteArray());
            }
        }
        return out;
    }
}
