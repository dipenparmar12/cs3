package com.cloudstream.desktop.sidecar;

import org.objectweb.asm.ClassReader;
import org.objectweb.asm.ClassVisitor;
import org.objectweb.asm.ClassWriter;
import org.objectweb.asm.MethodVisitor;
import org.objectweb.asm.Opcodes;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.DirectoryStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.Enumeration;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;
import java.util.zip.ZipOutputStream;

/**
 * Repairs Kotlin's mangled method names after DEX translation.
 *
 * <p><b>The defect.</b> Kotlin mangles the names of members of inline value
 * classes with a hyphen: {@code kotlin.Result} declares
 * {@code constructor-impl}, {@code box-impl}, {@code isFailure-impl},
 * {@code equals-impl0}. A hyphen is legal in a JVM method name and illegal in a
 * Java identifier, and dex2jar rewrites it to an underscore on the way out. The
 * declarations it emits are consistent with themselves, but every call to a
 * method that lives in a jar it did <em>not</em> translate — the whole Kotlin
 * standard library — now names a method that does not exist:
 *
 * <pre>
 *   NoSuchMethodError: 'java.lang.Object kotlin.Result.constructor_impl(java.lang.Object)'
 * </pre>
 *
 * <p><b>Why it matters this much.</b> {@code Result} is what {@code runCatching}
 * compiles to, and scrapers wrap nearly every network call in it. Measured
 * across the installed corpus, the translated jars carried 3 such references
 * each and zero correct ones, and the failure lands at the exact moment a
 * provider tries to resolve a video link — so search worked, metadata worked,
 * and playback failed with an error naming a Kotlin internal.
 *
 * <p><b>The repair.</b> Every method reference whose name contains an underscore
 * is checked against the runtime classpath. It is rewritten only when the owner
 * genuinely has no such method <em>and</em> does have one with the same
 * descriptor under the hyphenated spelling. That double condition is what makes
 * this safe: a legitimately named {@code foo_impl} resolves and is left alone,
 * and a rewrite only ever happens where the reference was already broken.
 *
 * <p>Declarations are deliberately not renamed. A plugin's own value-class
 * members are called only from code translated the same way, so both sides
 * agree; renaming one side would break the pair.
 */
final class KotlinNameRepair {

    /** Method names on classpath jars, keyed by internal class name. */
    private final Map<String, Set<String>> hyphenatedMembers = new HashMap<>();

    /** Resolved rewrites, so the same reference is decided once per session. */
    private final Map<String, String> decisions = new HashMap<>();

    private int rewrites;

    /**
     * Indexes the jars a plugin links against.
     *
     * Only names actually containing a hyphen are kept. Everything else is
     * irrelevant to this repair, and the full member index of 57 jars is a lot
     * of memory to hold for no reason.
     */
    KotlinNameRepair(Path runtimeClasspathDir) {
        if (runtimeClasspathDir == null || !Files.isDirectory(runtimeClasspathDir)) return;

        try (DirectoryStream<Path> jars = Files.newDirectoryStream(runtimeClasspathDir, "*.jar")) {
            for (Path jar : jars) index(jar);
        } catch (IOException e) {
            // An unreadable classpath means no repairs are possible. That is the
            // pre-existing behaviour, not a new failure, so it is not fatal here.
        }
    }

    private void index(Path jar) {
        try (ZipFile zip = new ZipFile(jar.toFile())) {
            Enumeration<? extends ZipEntry> entries = zip.entries();
            while (entries.hasMoreElements()) {
                ZipEntry entry = entries.nextElement();
                if (!entry.getName().endsWith(".class")) continue;

                try (InputStream in = zip.getInputStream(entry)) {
                    new ClassReader(in).accept(new ClassVisitor(Opcodes.ASM9) {
                        private String owner;

                        @Override
                        public void visit(int version, int access, String name, String signature,
                                          String superName, String[] interfaces) {
                            this.owner = name;
                        }

                        @Override
                        public MethodVisitor visitMethod(int access, String name, String descriptor,
                                                         String signature, String[] exceptions) {
                            if (name.indexOf('-') >= 0) {
                                hyphenatedMembers
                                        .computeIfAbsent(owner, k -> new HashSet<>())
                                        .add(name + descriptor);
                            }
                            return null;
                        }
                    }, ClassReader.SKIP_CODE | ClassReader.SKIP_DEBUG | ClassReader.SKIP_FRAMES);
                } catch (Exception ignored) {
                    // One unreadable class does not invalidate the index.
                }
            }
        } catch (IOException ignored) {
            // Likewise for one unreadable jar.
        }
    }

    /** True when this repair can do anything at all, so callers can skip the rewrite pass. */
    boolean isUsable() {
        return !hyphenatedMembers.isEmpty();
    }

    int rewriteCount() {
        return rewrites;
    }

    /**
     * The name a reference should actually use.
     *
     * Returns the original unless the underscore spelling is absent from the
     * owner and the hyphenated one is present with an identical descriptor.
     */
    private String repairedName(String owner, String name, String descriptor) {
        if (name.indexOf('_') < 0) return name;

        Set<String> hyphenated = hyphenatedMembers.get(owner);
        if (hyphenated == null) return name;

        String key = owner + '.' + name + descriptor;
        String cached = decisions.get(key);
        if (cached != null) return cached;

        // Kotlin only ever mangles with '-', so restoring every underscore is
        // the candidate. Requiring an exact descriptor match on the result is
        // what stops a coincidental name collision from being rewritten.
        String candidate = name.replace('_', '-');
        String resolved = hyphenated.contains(candidate + descriptor) ? candidate : name;

        decisions.put(key, resolved);
        if (!resolved.equals(name)) rewrites++;
        return resolved;
    }

    /**
     * Rewrites a translated jar in place, returning true if anything changed.
     *
     * Writes to a sibling and moves, so an interrupted pass cannot leave a
     * half-written jar where a cached translation is expected.
     */
    boolean repair(Path jar) {
        if (!isUsable()) return false;

        Path tmp = jar.resolveSibling(jar.getFileName() + ".repair.tmp");
        boolean changed = false;

        try {
            try (ZipFile zip = new ZipFile(jar.toFile());
                 ZipOutputStream out = new ZipOutputStream(Files.newOutputStream(tmp))) {

                List<? extends ZipEntry> entries = new ArrayList<>(zip.stream().toList());
                for (ZipEntry entry : entries) {
                    byte[] bytes;
                    try (InputStream in = zip.getInputStream(entry)) {
                        bytes = in.readAllBytes();
                    }

                    if (entry.getName().endsWith(".class")) {
                        byte[] rewritten = rewriteClass(bytes);
                        if (rewritten != null) {
                            bytes = rewritten;
                            changed = true;
                        }
                    }

                    ZipEntry copy = new ZipEntry(entry.getName());
                    out.putNextEntry(copy);
                    out.write(bytes);
                    out.closeEntry();
                }
            }

            if (changed) {
                Files.move(tmp, jar, StandardCopyOption.REPLACE_EXISTING);
            } else {
                Files.deleteIfExists(tmp);
            }
            return changed;
        } catch (Exception e) {
            try { Files.deleteIfExists(tmp); } catch (IOException ignored) { }
            // A failed repair leaves the translated jar exactly as it was. It
            // will fail later with the original NoSuchMethodError, which is no
            // worse than never having tried.
            return false;
        }
    }

    /** Returns rewritten bytes, or null when the class needed no change. */
    private byte[] rewriteClass(byte[] original) {
        int before = rewrites;

        ClassReader reader = new ClassReader(original);
        ClassWriter writer = new ClassWriter(0);

        reader.accept(new ClassVisitor(Opcodes.ASM9, writer) {
            @Override
            public MethodVisitor visitMethod(int access, String name, String descriptor,
                                             String signature, String[] exceptions) {
                MethodVisitor delegate = super.visitMethod(access, name, descriptor, signature, exceptions);
                if (delegate == null) return null;

                return new MethodVisitor(Opcodes.ASM9, delegate) {
                    @Override
                    public void visitMethodInsn(int opcode, String owner, String methodName,
                                                String methodDescriptor, boolean isInterface) {
                        super.visitMethodInsn(opcode, owner,
                                repairedName(owner, methodName, methodDescriptor),
                                methodDescriptor, isInterface);
                    }
                };
            }
        }, 0);

        return rewrites > before ? writer.toByteArray() : null;
    }
}
