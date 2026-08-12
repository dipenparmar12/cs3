package cs3.spike;

import org.objectweb.asm.ClassReader;
import org.objectweb.asm.tree.ClassNode;
import org.objectweb.asm.tree.MethodNode;

import java.io.ByteArrayOutputStream;
import java.nio.file.*;
import java.util.*;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/** Explains every ground-truth divergence found by TranslationSpike. */
public final class DiffDetail {

    public static void main(String[] args) throws Exception {
        Path refDir = Paths.get(args[0]);
        Path transDir = Paths.get(args[1]);

        Map<String, Integer> reasonCounts = new TreeMap<>();
        List<String> samples = new ArrayList<>();
        List<String> missingClasses = new ArrayList<>();

        try (DirectoryStream<Path> ds = Files.newDirectoryStream(refDir, "*.jar")) {
            for (Path ref : ds) {
                String name = ref.getFileName().toString().replaceAll("\\.jar$", "");
                Path trans = transDir.resolve(name + ".translated.jar");
                if (!Files.exists(trans)) continue;

                Map<String, byte[]> refMap = readJar(ref);
                Map<String, byte[]> tMap = readJar(trans);

                for (var e : refMap.entrySet()) {
                    byte[] got = tMap.get(e.getKey());
                    if (got == null) { missingClasses.add(name + " :: " + e.getKey()); continue; }

                    Set<String> a = methodSet(e.getValue());   // publisher
                    Set<String> b = methodSet(got);            // translated
                    if (a.equals(b)) continue;

                    Set<String> onlyRef = new TreeSet<>(a); onlyRef.removeAll(b);
                    Set<String> onlyTrans = new TreeSet<>(b); onlyTrans.removeAll(a);

                    String reason = classify(onlyRef, onlyTrans);
                    reasonCounts.merge(reason, 1, Integer::sum);
                    if (samples.size() < 25) {
                        samples.add(String.format("%-34s %s%n      only-in-publisher : %s%n      only-in-translated: %s",
                                reason, name + "::" + e.getKey(), trim(onlyRef), trim(onlyTrans)));
                    }
                }
            }
        }

        System.out.println("=== MISSING CLASSES (" + missingClasses.size() + ") ===");
        missingClasses.forEach(m -> System.out.println("  " + m));

        System.out.println("\n=== METHOD-SET MISMATCH REASONS ===");
        reasonCounts.forEach((k, v) -> System.out.printf("  %-34s %d%n", k, v));

        System.out.println("\n=== SAMPLES ===");
        samples.forEach(s -> System.out.println("  " + s + "\n"));
    }

    private static String classify(Set<String> onlyRef, Set<String> onlyTrans) {
        boolean allRefSynthetic = !onlyRef.isEmpty() && onlyRef.stream().allMatch(DiffDetail::looksSynthetic);
        boolean allTransSynthetic = !onlyTrans.isEmpty() && onlyTrans.stream().allMatch(DiffDetail::looksSynthetic);

        if (onlyRef.isEmpty() && allTransSynthetic) return "translated adds synthetic only";
        if (onlyTrans.isEmpty() && allRefSynthetic) return "publisher-only synthetic dropped";
        if (allRefSynthetic && allTransSynthetic) return "synthetic naming differs only";
        if (onlyRef.isEmpty()) return "translated adds real method";
        if (onlyTrans.isEmpty()) return "REAL METHOD LOST";
        return "real method signature differs";
    }

    private static boolean looksSynthetic(String sig) {
        String n = sig.substring(0, Math.max(0, sig.indexOf('(')));
        return n.contains("$") || n.startsWith("access$") || n.isEmpty()
                || n.equals("<clinit>") || n.contains("default") || n.contains("lambda");
    }

    private static String trim(Set<String> s) {
        String j = String.join(", ", s.stream().limit(4).toList());
        return j.length() > 200 ? j.substring(0, 200) + "..." : (j + (s.size() > 4 ? " (+" + (s.size() - 4) + ")" : ""));
    }

    private static Set<String> methodSet(byte[] cls) {
        ClassNode cn = new ClassNode();
        new ClassReader(cls).accept(cn, ClassReader.SKIP_CODE);
        Set<String> s = new TreeSet<>();
        for (MethodNode mn : cn.methods) s.add(mn.name + mn.desc);
        return s;
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
