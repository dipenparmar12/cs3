package com.cloudstream.desktop.sidecar;

import com.googlecode.d2j.CallSite;
import com.googlecode.d2j.DexLabel;
import com.googlecode.d2j.Field;
import com.googlecode.d2j.Method;
import com.googlecode.d2j.Proto;
import com.googlecode.d2j.reader.BaseDexFileReader;
import com.googlecode.d2j.reader.DexFileReader;
import com.googlecode.d2j.reader.Op;
import com.googlecode.d2j.visitors.DexClassVisitor;
import com.googlecode.d2j.visitors.DexCodeVisitor;
import com.googlecode.d2j.visitors.DexFileVisitor;
import com.googlecode.d2j.visitors.DexMethodVisitor;

import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * Keeps one enormous method from costing a whole extension, and the JVM with it.
 *
 * <p><b>The measurement.</b> StreamPlay (phisher98) carries
 * {@code StreamPlayExtractor.invokeMovieBox}: 22,870 DEX statements, a Kotlin
 * coroutine state machine. dex2jar's register allocation over it is quadratic
 * in practice — it exhausted a 3 GB heap, and with 9 GB it ran for 140 seconds
 * only to fail with ASM's {@code MethodTooLargeException}, because the result
 * is past the JVM's 64 KB limit on a method body. DEX has no such limit, which
 * is why the extension runs on Android. In the app the translation never
 * finished: it was retried on every launch, filled the sidecar's heap, and the
 * {@code OutOfMemoryError} that followed stalled every other extension.
 *
 * <p><b>The fix.</b> Methods above {@link #STATEMENT_LIMIT} are found by a
 * counting pass — a third of a second across StreamPlay's 12,754 methods — and
 * translated as a body that throws {@code UnsupportedOperationException}. The
 * method could never have run on the JVM, so nothing is lost that was not
 * already lost; the class still links, and every other method works. Measured:
 * StreamPlay then translates in 25 seconds in under 500 MB.
 *
 * <p>This is the shim rule applied to bytecode: concede the type, refuse the
 * operation. The provider registers, searches and resolves through every path
 * except the one that called the missing method, which fails with a reason.
 *
 * <p><b>The threshold.</b> Across 468 installed community archives the largest
 * method after StreamPlay's is 9,749 statements, and it translates normally.
 * 15,000 leaves room above that and stays well below the size that broke.
 */
final class OversizedMethods {

    static final int STATEMENT_LIMIT = 15_000;

    private static final String REFUSAL = "Ljava/lang/UnsupportedOperationException;";

    private OversizedMethods() { }

    /** Every method whose body is longer than {@link #STATEMENT_LIMIT}, as {@code Method.toString()}. */
    static Set<String> find(BaseDexFileReader reader) {
        Set<String> oversized = new HashSet<>();
        reader.accept(new DexFileVisitor() {
            @Override
            public DexClassVisitor visit(int access, String className, String superClass, String[] interfaces) {
                return new DexClassVisitor() {
                    @Override
                    public DexMethodVisitor visitMethod(int accessFlags, Method method) {
                        return new DexMethodVisitor() {
                            @Override
                            public DexCodeVisitor visitCode() {
                                return new Counter(method, oversized);
                            }
                        };
                    }
                };
            }
        }, DexFileReader.SKIP_DEBUG);
        return oversized;
    }

    /**
     * {@code reader} as dex2jar should see it: each method in {@code oversized}
     * with its body replaced by {@code throw new UnsupportedOperationException()}.
     */
    static BaseDexFileReader stubbing(BaseDexFileReader reader, Set<String> oversized) {
        if (oversized.isEmpty()) return reader;
        return new BaseDexFileReader() {
            @Override public int getDexVersion() { return reader.getDexVersion(); }
            @Override public List<String> getClassNames() { return reader.getClassNames(); }
            @Override public void accept(DexFileVisitor v) { reader.accept(wrap(v)); }
            @Override public void accept(DexFileVisitor v, int config) { reader.accept(wrap(v), config); }
            @Override public void accept(DexFileVisitor v, int index, int config) { reader.accept(wrap(v), index, config); }

            private DexFileVisitor wrap(DexFileVisitor target) {
                return new DexFileVisitor(target) {
                    @Override
                    public DexClassVisitor visit(int access, String className, String superClass, String[] interfaces) {
                        DexClassVisitor cv = super.visit(access, className, superClass, interfaces);
                        if (cv == null) return null;
                        return new DexClassVisitor(cv) {
                            @Override
                            public DexMethodVisitor visitMethod(int accessFlags, Method method) {
                                DexMethodVisitor mv = super.visitMethod(accessFlags, method);
                                if (mv == null || !oversized.contains(method.toString())) return mv;
                                return new DexMethodVisitor(mv) {
                                    @Override
                                    public DexCodeVisitor visitCode() {
                                        DexCodeVisitor code = super.visitCode();
                                        return code == null ? null : new Refusal(code);
                                    }
                                };
                            }
                        };
                    }
                };
            }
        };
    }

    /**
     * Emits a three-statement body into {@code code} and swallows the original.
     *
     * Register 0 is free for the exception in any method with a body this
     * large: DEX places parameters in the highest registers, and a method that
     * reached the limit has locals below them.
     */
    private static final class Refusal extends DexCodeVisitor {
        private final DexCodeVisitor code;

        Refusal(DexCodeVisitor code) {
            this.code = code;
        }

        @Override
        public void visitRegister(int total) {
            code.visitRegister(total);
            code.visitTypeStmt(Op.NEW_INSTANCE, 0, 0, REFUSAL);
            code.visitMethodStmt(Op.INVOKE_DIRECT, new int[] {0}, new Method(REFUSAL, "<init>", new String[0], "V"));
            code.visitStmt1R(Op.THROW, 0);
        }

        @Override
        public void visitEnd() {
            code.visitEnd();
        }
    }

    /** Counts a method's statements; records it when the count passes the limit. */
    private static final class Counter extends DexCodeVisitor {
        private final Method method;
        private final Set<String> oversized;
        private int statements;

        Counter(Method method, Set<String> oversized) {
            this.method = method;
            this.oversized = oversized;
        }

        private void count() { statements++; }

        @Override public void visitStmt0R(Op op) { count(); }
        @Override public void visitStmt1R(Op op, int a) { count(); }
        @Override public void visitStmt2R(Op op, int a, int b) { count(); }
        @Override public void visitStmt3R(Op op, int a, int b, int c) { count(); }
        @Override public void visitStmt2R1N(Op op, int a, int b, int n) { count(); }
        @Override public void visitTypeStmt(Op op, int a, int b, String type) { count(); }
        @Override public void visitConstStmt(Op op, int a, Object value) { count(); }
        @Override public void visitFieldStmt(Op op, int a, int b, Field field) { count(); }
        @Override public void visitFillArrayDataStmt(Op op, int a, Object array) { count(); }
        @Override public void visitFilledNewArrayStmt(Op op, int[] args, String type) { count(); }
        @Override public void visitMethodStmt(Op op, int[] args, Method m) { count(); }
        @Override public void visitMethodStmt(Op op, int[] args, CallSite site) { count(); }
        @Override public void visitMethodStmt(Op op, int[] args, Method m, Proto proto) { count(); }
        @Override public void visitJumpStmt(Op op, int a, int b, DexLabel label) { count(); }
        @Override public void visitPackedSwitchStmt(Op op, int a, int first, DexLabel[] labels) { count(); }
        @Override public void visitSparseSwitchStmt(Op op, int a, int[] cases, DexLabel[] labels) { count(); }

        @Override
        public void visitEnd() {
            if (statements > STATEMENT_LIMIT) oversized.add(method.toString());
        }
    }
}
