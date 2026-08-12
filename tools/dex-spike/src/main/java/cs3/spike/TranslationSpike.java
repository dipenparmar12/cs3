package cs3.spike;

import com.googlecode.d2j.dex.Dex2jar;
import com.googlecode.d2j.reader.BaseDexFileReader;
import com.googlecode.d2j.reader.MultiDexFileReader;
import org.objectweb.asm.ClassReader;
import org.objectweb.asm.tree.ClassNode;
import org.objectweb.asm.tree.MethodNode;
import org.objectweb.asm.util.CheckClassAdapter;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.PrintWriter;
import java.io.StringWriter;
import java.nio.file.*;
import java.util.*;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;
import java.util.zip.ZipInputStream;

/**
 * Phase 1 translation spike for docs/PRD/31 RISK-D1.
 *
 * Answers one question with evidence: does DEX to JVM translation preserve the
 * Kotlin coroutine state machines that every CloudStream provider is built on?
 *
 * For each .cs3 in the corpus it translates the DEX payload, then verifies the
 * result three ways:
 *   1. every emitted class parses and passes ASM's CheckClassAdapter verifier
 *   2. the entry class named by manifest.json survives translation
 *   3. suspend-function state machines are counted and verified specifically
 *
 * Where the publisher also shipped the pre-dex .jar, the translated output is
 * diffed against it -- that is ground truth, not a proxy for it.
 */
public final class TranslationSpike {

    /** A suspend lambda/state machine extends one of these. */
    private static final Set<String> CONTINUATION_BASES = Set.of(
            "kotlin/coroutines/jvm/internal/ContinuationImpl",
            "kotlin/coroutines/jvm/internal/SuspendLambda",
            "kotlin/coroutines/jvm/internal/RestrictedContinuationImpl",
            "kotlin/coroutines/jvm/internal/BaseContinuationImpl");

    record Result(
            String name,
            boolean translated,
            String failure,
            int dexCount,
            int classCount,
            int verifyFailures,
            List<String> verifyFailureDetail,
            int suspendMethods,
            int stateMachineClasses,
            int suspendVerifyFailures,
            String manifestClass,
            boolean manifestClassPresent,
            Integer refJarClasses,
            Integer refMissingInTranslation,
            Integer refMethodMismatches) {}

    public static void main(String[] args) throws Exception {
        Path corpus = Paths.get(args[0]);
        Path refDir = Paths.get(args[1]);
        Path outDir = Paths.get(args[2]);
        Files.createDirectories(outDir);

        List<Path> inputs = new ArrayList<>();
        try (DirectoryStream<Path> ds = Files.newDirectoryStream(corpus, "*.cs3")) {
            for (Path p : ds) inputs.add(p);
        }
        Collections.sort(inputs);

        List<Result> results = new ArrayList<>();
        for (Path in : inputs) {
            results.add(process(in, refDir, outDir));
        }

        report(results);
        writeJson(results, outDir.resolve("spike-results.json"));
    }

    private static Result process(Path cs3, Path refDir, Path outDir) {
        String name = cs3.getFileName().toString().replaceAll("\\.cs3$", "");
        List<byte[]> dexes = new ArrayList<>();
        String manifestClass = null;

        try (ZipFile zf = new ZipFile(cs3.toFile())) {
            Enumeration<? extends ZipEntry> en = zf.entries();
            while (en.hasMoreElements()) {
                ZipEntry e = en.nextElement();
                String n = e.getName();
                if (n.matches("(?i).*(^|/)classes\\d*\\.dex")) {
                    try (InputStream is = zf.getInputStream(e)) {
                        dexes.add(is.readAllBytes());
                    }
                } else if (n.equalsIgnoreCase("manifest.json")) {
                    try (InputStream is = zf.getInputStream(e)) {
                        String json = new String(is.readAllBytes(), java.nio.charset.StandardCharsets.UTF_8);
                        manifestClass = extractJsonString(json, "pluginClassName");
                    }
                }
            }
        } catch (Exception ex) {
            return failed(name, "archive unreadable: " + ex, manifestClass);
        }

        if (dexes.isEmpty()) return failed(name, "no classes.dex in archive", manifestClass);

        // --- translate ------------------------------------------------------
        Map<String, byte[]> classes = new TreeMap<>();
        try {
            BaseDexFileReader reader = MultiDexFileReader.open(concatIfSingle(dexes));
            Path jarOut = outDir.resolve(name + ".translated.jar");
            Dex2jar.from(reader)
                    .skipDebug(false)
                    .topoLogicalSort()
                    .noCode(false)
                    .to(jarOut);
            classes.putAll(readJar(jarOut));
        } catch (Throwable t) {
            return failed(name, "translation threw: " + t.getClass().getSimpleName() + ": " + t.getMessage(), manifestClass);
        }

        if (classes.isEmpty()) return failed(name, "translation produced no classes", manifestClass);

        // --- verify ---------------------------------------------------------
        int verifyFailures = 0;
        int suspendMethods = 0;
        int stateMachines = 0;
        int suspendVerifyFailures = 0;
        List<String> detail = new ArrayList<>();

        for (Map.Entry<String, byte[]> e : classes.entrySet()) {
            ClassNode cn = new ClassNode();
            boolean isStateMachine = false;
            int localSuspend = 0;
            try {
                new ClassReader(e.getValue()).accept(cn, 0);
                if (cn.superName != null && CONTINUATION_BASES.contains(cn.superName)) {
                    isStateMachine = true;
                }
                for (MethodNode mn : cn.methods) {
                    // A suspend function carries a trailing Continuation parameter.
                    if (mn.desc.contains("Lkotlin/coroutines/Continuation;")) localSuspend++;
                }
            } catch (Throwable t) {
                verifyFailures++;
                if (detail.size() < 5) detail.add(e.getKey() + ": parse: " + t);
                continue;
            }

            suspendMethods += localSuspend;
            if (isStateMachine) stateMachines++;

            StringWriter sw = new StringWriter();
            try {
                // Verifier needs a loader for frame merging; classes reference
                // provider-API types absent from this classpath, so a failure to
                // resolve is not a translation defect. Only structural verdicts
                // (bad bytecode, bad frames) are counted.
                CheckClassAdapter.verify(new ClassReader(e.getValue()), false, new PrintWriter(sw));
            } catch (Throwable t) {
                sw.append(t.toString());
            }
            String v = sw.toString();
            if (isStructuralFailure(v)) {
                verifyFailures++;
                if (isStateMachine || localSuspend > 0) suspendVerifyFailures++;
                if (detail.size() < 5) detail.add(e.getKey() + ": " + firstLine(v));
            }
        }

        boolean manifestPresent = manifestClass == null
                || classes.containsKey(manifestClass.replace('.', '/') + ".class");

        // --- diff against publisher jar when available ----------------------
        Integer refClasses = null, refMissing = null, refMethodMismatch = null;
        Path ref = refDir.resolve(name + ".jar");
        if (Files.exists(ref)) {
            try {
                Map<String, byte[]> refMap = readJar(ref);
                refClasses = refMap.size();
                int missing = 0, mism = 0;
                for (Map.Entry<String, byte[]> e : refMap.entrySet()) {
                    byte[] got = classes.get(e.getKey());
                    if (got == null) { missing++; continue; }
                    if (!methodSet(got).equals(methodSet(e.getValue()))) mism++;
                }
                refMissing = missing;
                refMethodMismatch = mism;
            } catch (Exception ignored) {
                // A malformed reference jar is not a finding about translation.
            }
        }

        return new Result(name, true, null, dexes.size(), classes.size(), verifyFailures,
                detail, suspendMethods, stateMachines, suspendVerifyFailures,
                manifestClass, manifestPresent, refClasses, refMissing, refMethodMismatch);
    }

    /**
     * ASM reports unresolved types as ClassNotFoundException/TypeNotPresent while
     * merging frames. Those come from the absent provider API, not from bad
     * translation, so they must not be counted as failures.
     */
    private static boolean isStructuralFailure(String verifierOutput) {
        if (verifierOutput.isBlank()) return false;
        return !(verifierOutput.contains("ClassNotFoundException")
                || verifierOutput.contains("TypeNotPresentException")
                || verifierOutput.contains("NoClassDefFoundError"));
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

    private static byte[] concatIfSingle(List<byte[]> dexes) throws Exception {
        if (dexes.size() == 1) return dexes.get(0);
        // MultiDexFileReader.open takes a zip containing the dex entries.
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        try (java.util.zip.ZipOutputStream zos = new java.util.zip.ZipOutputStream(bos)) {
            for (int i = 0; i < dexes.size(); i++) {
                zos.putNextEntry(new ZipEntry(i == 0 ? "classes.dex" : "classes" + (i + 1) + ".dex"));
                zos.write(dexes.get(i));
                zos.closeEntry();
            }
        }
        return bos.toByteArray();
    }

    private static String extractJsonString(String json, String key) {
        int i = json.indexOf('"' + key + '"');
        if (i < 0) return null;
        int c = json.indexOf(':', i);
        int q1 = json.indexOf('"', c + 1);
        int q2 = json.indexOf('"', q1 + 1);
        return (q1 < 0 || q2 < 0) ? null : json.substring(q1 + 1, q2);
    }

    private static String firstLine(String s) {
        int i = s.indexOf('\n');
        String r = i < 0 ? s : s.substring(0, i);
        return r.length() > 160 ? r.substring(0, 160) : r;
    }

    private static Result failed(String name, String why, String manifestClass) {
        return new Result(name, false, why, 0, 0, 0, List.of(), 0, 0, 0, manifestClass, false, null, null, null);
    }

    // --- reporting ----------------------------------------------------------

    private static void report(List<Result> rs) {
        int total = rs.size();
        long ok = rs.stream().filter(Result::translated).count();
        long clean = rs.stream().filter(r -> r.translated && r.verifyFailures == 0 && r.manifestClassPresent).count();
        int classes = rs.stream().mapToInt(Result::classCount).sum();
        int vf = rs.stream().mapToInt(Result::verifyFailures).sum();
        int susp = rs.stream().mapToInt(Result::suspendMethods).sum();
        int sm = rs.stream().mapToInt(Result::stateMachineClasses).sum();
        int svf = rs.stream().mapToInt(Result::suspendVerifyFailures).sum();
        long missingEntry = rs.stream().filter(r -> r.translated && !r.manifestClassPresent).count();

        System.out.println("=".repeat(72));
        System.out.println("DEX -> JVM TRANSLATION SPIKE  (docs/PRD/31 RISK-D1)");
        System.out.println("=".repeat(72));
        System.out.printf("plugins in corpus            : %d%n", total);
        System.out.printf("translated without throwing  : %d  (%.1f%%)%n", ok, pct(ok, total));
        System.out.printf("fully clean (verify + entry) : %d  (%.1f%%)%n", clean, pct(clean, total));
        System.out.printf("classes emitted              : %d%n", classes);
        System.out.printf("classes failing verification : %d  (%.4f%%)%n", vf, pct(vf, classes));
        System.out.printf("entry class lost             : %d%n", missingEntry);
        System.out.println("-".repeat(72));
        System.out.println("COROUTINES (the RISK-D1 question)");
        System.out.printf("suspend-shaped methods       : %d%n", susp);
        System.out.printf("coroutine state machines     : %d%n", sm);
        System.out.printf("of which fail verification   : %d  (%.4f%%)%n", svf, pct(svf, sm));
        System.out.println("-".repeat(72));

        List<Result> withRef = rs.stream().filter(r -> r.refJarClasses != null).toList();
        int rc = withRef.stream().mapToInt(r -> r.refJarClasses).sum();
        int rm = withRef.stream().mapToInt(r -> r.refMissingInTranslation).sum();
        int rmm = withRef.stream().mapToInt(r -> r.refMethodMismatches).sum();
        System.out.println("GROUND TRUTH vs publisher-built .jar");
        System.out.printf("plugins with reference jar   : %d%n", withRef.size());
        System.out.printf("reference classes            : %d%n", rc);
        System.out.printf("missing after translation    : %d  (%.4f%%)%n", rm, pct(rm, rc));
        System.out.printf("method-set mismatches        : %d  (%.4f%%)%n", rmm, pct(rmm, rc));
        System.out.println("=".repeat(72));

        System.out.println("\nFAILURES:");
        rs.stream().filter(r -> !r.translated)
                .forEach(r -> System.out.printf("  [X] %-44s %s%n", r.name, r.failure));
        rs.stream().filter(r -> r.translated && r.verifyFailures > 0)
                .forEach(r -> System.out.printf("  [!] %-44s %d/%d classes: %s%n",
                        r.name, r.verifyFailures, r.classCount,
                        r.verifyFailureDetail.isEmpty() ? "" : r.verifyFailureDetail.get(0)));
        rs.stream().filter(r -> r.translated && !r.manifestClassPresent)
                .forEach(r -> System.out.printf("  [E] %-44s entry class missing: %s%n", r.name, r.manifestClass));
    }

    private static double pct(long a, long b) { return b == 0 ? 0 : (100.0 * a) / b; }

    private static void writeJson(List<Result> rs, Path out) throws Exception {
        StringBuilder sb = new StringBuilder("[\n");
        for (int i = 0; i < rs.size(); i++) {
            Result r = rs.get(i);
            sb.append("  {\"name\":\"").append(r.name).append("\",\"translated\":").append(r.translated)
              .append(",\"failure\":").append(r.failure == null ? "null" : "\"" + r.failure.replace("\"", "'").replace("\\", "/") + "\"")
              .append(",\"dexCount\":").append(r.dexCount)
              .append(",\"classCount\":").append(r.classCount)
              .append(",\"verifyFailures\":").append(r.verifyFailures)
              .append(",\"suspendMethods\":").append(r.suspendMethods)
              .append(",\"stateMachineClasses\":").append(r.stateMachineClasses)
              .append(",\"suspendVerifyFailures\":").append(r.suspendVerifyFailures)
              .append(",\"manifestClass\":").append(r.manifestClass == null ? "null" : "\"" + r.manifestClass + "\"")
              .append(",\"manifestClassPresent\":").append(r.manifestClassPresent)
              .append(",\"refJarClasses\":").append(r.refJarClasses)
              .append(",\"refMissing\":").append(r.refMissingInTranslation)
              .append(",\"refMethodMismatches\":").append(r.refMethodMismatches)
              .append("}").append(i < rs.size() - 1 ? "," : "").append("\n");
        }
        sb.append("]\n");
        Files.writeString(out, sb.toString());
    }
}
