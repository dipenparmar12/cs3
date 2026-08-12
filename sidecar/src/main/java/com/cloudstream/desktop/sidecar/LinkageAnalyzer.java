package com.cloudstream.desktop.sidecar;

import org.objectweb.asm.ClassReader;
import org.objectweb.asm.ClassVisitor;
import org.objectweb.asm.FieldVisitor;
import org.objectweb.asm.MethodVisitor;
import org.objectweb.asm.Opcodes;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.*;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * Resolves every type a translated plugin references against the sidecar's
 * shared classpath, and reports what is missing.
 *
 * This is the measurement behind DROP-28's compatibility tier. Static analysis
 * over Kotlin imports — the method docs/PRD/31 §2.3 used — systematically
 * understates the surface, because a shipped {@code .cs3} also carries library
 * code that R8 inlined into it. Working from the translated bytecode measures
 * what actually has to link.
 *
 * <p>A reference is not the same as a call: the JVM resolves lazily, so a type
 * named only in a method that never runs will never be loaded. Unresolved
 * references are therefore reported as <em>risk</em>, and a plugin is only
 * demoted to a blocked tier when the missing type sits on a path the plugin
 * cannot avoid — its entry class, its provider classes, or their supertypes.
 */
public final class LinkageAnalyzer {

    public record Report(
            int classCount,
            List<String> unresolvedCritical,
            List<String> unresolvedIncidental,
            List<String> unresolvedAndroid,
            int suspendMethods,
            int stateMachines,
            String tier,
            String tierReason) { }

    private final ClassLoader shared;

    public LinkageAnalyzer(ClassLoader shared) {
        this.shared = shared;
    }

    public Report analyze(Path translatedJar, String entryClassName) throws IOException {
        Map<String, byte[]> classes = readJar(translatedJar);
        Set<String> owned = new HashSet<>();
        for (String k : classes.keySet()) owned.add(k.replaceAll("\\.class$", ""));

        // Types named in a class's own header (supertype/interfaces) must resolve
        // before the class can be initialised at all; everything else is lazy.
        Map<String, Set<String>> structural = new HashMap<>();
        Set<String> incidental = new HashSet<>();
        int[] counters = new int[2]; // suspendMethods, stateMachines

        for (Map.Entry<String, byte[]> e : classes.entrySet()) {
            String owner = e.getKey().replaceAll("\\.class$", "");
            Set<String> hdr = new HashSet<>();
            Set<String> body = new HashSet<>();
            scan(e.getValue(), hdr, body, counters);
            structural.put(owner, hdr);
            incidental.addAll(body);
        }

        String entryInternal = entryClassName == null ? null : entryClassName.replace('.', '/');

        // Critical = unresolved types in the header closure reachable from the
        // entry class. Those stop the plugin from loading at all.
        Set<String> criticalTypes = new LinkedHashSet<>();
        if (entryInternal != null) {
            Deque<String> queue = new ArrayDeque<>();
            Set<String> seen = new HashSet<>();
            queue.add(entryInternal);
            while (!queue.isEmpty()) {
                String cur = queue.poll();
                if (!seen.add(cur)) continue;
                Set<String> hdr = structural.get(cur);
                if (hdr == null) continue;
                for (String t : hdr) {
                    criticalTypes.add(t);
                    if (owned.contains(t)) queue.add(t);
                }
            }
        } else {
            structural.values().forEach(criticalTypes::addAll);
        }

        List<String> critical = new ArrayList<>();
        List<String> android = new ArrayList<>();
        List<String> other = new ArrayList<>();

        for (String t : criticalTypes) {
            if (owned.contains(t) || resolves(t)) continue;
            if (t.startsWith("android/")) android.add(binary(t));
            else critical.add(binary(t));
        }
        for (String t : incidental) {
            if (owned.contains(t) || criticalTypes.contains(t) || resolves(t)) continue;
            if (t.startsWith("android/")) android.add(binary(t));
            else other.add(binary(t));
        }

        Collections.sort(critical);
        Collections.sort(android);
        Collections.sort(other);

        String tier;
        String reason;
        if (!critical.isEmpty()) {
            tier = "T4_BLOCKED";
            reason = "Types required to load the entry class are absent from the runtime classpath: "
                    + preview(critical) + ". The plugin cannot be instantiated.";
        } else if (!android.isEmpty()) {
            tier = "T3_DEGRADED";
            reason = "Loads, but references " + android.size()
                    + " un-shimmed android.* types on non-critical paths: " + preview(android)
                    + ". Features reaching them will fail with a named error (DROP-7).";
        } else if (!other.isEmpty()) {
            tier = "T3_DEGRADED";
            reason = "Loads, but " + other.size() + " referenced types are missing: " + preview(other) + ".";
        } else {
            tier = "T1_DROPIN";
            reason = "Every referenced type resolves against the runtime classpath.";
        }

        return new Report(classes.size(), critical, other, android,
                counters[0], counters[1], tier, reason);
    }

    private static String preview(List<String> l) {
        return String.join(", ", l.subList(0, Math.min(5, l.size())))
                + (l.size() > 5 ? " (+" + (l.size() - 5) + " more)" : "");
    }

    private static String binary(String internal) {
        return internal.replace('/', '.');
    }

    private boolean resolves(String internalName) {
        if (internalName.startsWith("[")) return true;
        try {
            Class.forName(binary(internalName), false, shared);
            return true;
        } catch (ClassNotFoundException | LinkageError e) {
            return false;
        }
    }

    private static void scan(byte[] bytes, Set<String> header, Set<String> body, int[] counters) {
        new ClassReader(bytes).accept(new ClassVisitor(Opcodes.ASM9) {
            @Override
            public void visit(int v, int access, String name, String sig, String sup, String[] itf) {
                if (sup != null) {
                    header.add(sup);
                    if (sup.startsWith("kotlin/coroutines/jvm/internal/")) counters[1]++;
                }
                if (itf != null) header.addAll(Arrays.asList(itf));
            }

            @Override
            public FieldVisitor visitField(int a, String n, String d, String s, Object val) {
                addDesc(body, d);
                return null;
            }

            @Override
            public MethodVisitor visitMethod(int a, String n, String d, String s, String[] ex) {
                addDesc(body, d);
                if (d.contains("Lkotlin/coroutines/Continuation;")) counters[0]++;
                return new MethodVisitor(Opcodes.ASM9) {
                    @Override public void visitTypeInsn(int op, String type) { addType(body, type); }
                    @Override public void visitFieldInsn(int op, String o, String n2, String d2) {
                        addType(body, o); addDesc(body, d2);
                    }
                    @Override public void visitMethodInsn(int op, String o, String n2, String d2, boolean i) {
                        addType(body, o); addDesc(body, d2);
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
            if (desc.charAt(i) == 'L') {
                int end = desc.indexOf(';', i);
                if (end < 0) return;
                out.add(desc.substring(i + 1, end));
                i = end + 1;
            } else i++;
        }
    }

    private static Map<String, byte[]> readJar(Path jar) throws IOException {
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
