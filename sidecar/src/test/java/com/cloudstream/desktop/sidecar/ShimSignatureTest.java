package com.cloudstream.desktop.sidecar;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * The one shim mistake this repository keeps making.
 *
 * <p>A parameter or return type widened to {@code Object} does not merely lose
 * type safety — <b>it renames the method</b>. An extension compiled against
 * Android calls {@code getResources()Landroid/content/res/Resources;}; a shim
 * declaring {@code getResources()Ljava/lang/Object;} is a different method
 * entirely, so the call resolves against nothing and throws
 * {@code NoSuchMethodError} at the call site. The shim's own carefully worded
 * "not available on desktop" message is then unreachable, and the reported
 * cause names the reflection layer or the wrong class.
 *
 * <p>It has been made at least seven times here, each found only by a user
 * hitting it:
 *
 * <ul>
 *   <li>{@code Context.getPackageManager} returning {@code Object}</li>
 *   <li>{@code Context.getResources} returning {@code Object}</li>
 *   <li>{@code Context.startActivity} taking {@code Object}</li>
 *   <li>{@code Context.getAssets} returning {@code Object}</li>
 *   <li>{@code Context.getContentResolver} returning {@code Object}</li>
 *   <li>{@code Window.setBackgroundDrawable} taking {@code Object}</li>
 *   <li>{@code Fragment.getResources} returning {@code Object}</li>
 * </ul>
 *
 * <p>Nothing catches it otherwise. It compiles, it links, {@code javac} is
 * happy, and every existing test passes — the failure appears only when a real
 * extension calls the real descriptor, and it surfaces as that extension losing
 * every provider it was about to register.
 *
 * <p>So the rule is enforced mechanically instead: a shim method may not
 * mention bare {@code Object} unless Android's own signature does. The
 * allow-list below is the set where Android really does, each with the reason,
 * and a stale entry fails the test — an allow-list without reasons becomes
 * precedent for the next one.
 */
class ShimSignatureTest {

    /**
     * Methods whose Android signature genuinely uses {@code Object}.
     *
     * <p>Verified against the platform SDK, not assumed. Each entry names the
     * upstream signature it matches; if a shim method is removed or renamed its
     * entry here goes stale and the test says so.
     */
    private static final Map<String, String> ANDROID_USES_OBJECT = Map.ofEntries(
            Map.entry("android.content.Context#getSystemService",
                    "public abstract Object getSystemService(String name)"),
            Map.entry("android.view.View#setTag",
                    "public void setTag(Object tag)"),
            Map.entry("android.view.View#getTag",
                    "public Object getTag()"),
            Map.entry("android.os.Handler#removeCallbacksAndMessages",
                    "public final void removeCallbacksAndMessages(Object token)"),
            Map.entry("android.os.Handler#obtainMessage",
                    "public final Message obtainMessage(int what, Object obj)"),
            Map.entry("android.content.ContentResolver#insert",
                    "ContentValues, which is not shimmed; Object stands in for the "
                            + "parameter of a method that refuses every call anyway"),
            Map.entry("android.content.ContentResolver#update",
                    "ContentValues, as above"),
            Map.entry("android.net.Uri#equals",
                    "java.lang.Object.equals(Object)"));

    /**
     * Types the shim declares. A method mentioning one of these is fine by
     * construction; the check is only about {@code Object}.
     */
    private static Set<String> shimClassNames() throws IOException {
        Path root = Path.of("src/main/java");
        assertTrue(Files.isDirectory(root), "run from the sidecar module directory");
        try (Stream<Path> files = Files.walk(root)) {
            return files
                    .filter(p -> p.toString().endsWith(".java"))
                    .map(root::relativize)
                    .map(Path::toString)
                    .filter(s -> s.startsWith("android" + java.io.File.separator)
                            || s.startsWith("androidx" + java.io.File.separator))
                    .map(s -> s.substring(0, s.length() - ".java".length()))
                    .map(s -> s.replace(java.io.File.separatorChar, '.'))
                    .collect(java.util.stream.Collectors.toSet());
        }
    }

    @Test
    void noShimMethodWidensAnAndroidTypeToObject() throws Exception {
        List<String> offenders = new ArrayList<>();
        List<String> checked = new ArrayList<>();

        for (String className : shimClassNames()) {
            Class<?> type = Class.forName(className);
            for (Method method : type.getDeclaredMethods()) {
                if (!Modifier.isPublic(method.getModifiers()) || method.isSynthetic()) continue;

                boolean mentionsObject = method.getReturnType() == Object.class;
                for (Class<?> parameter : method.getParameterTypes()) {
                    if (parameter == Object.class) mentionsObject = true;
                }
                if (!mentionsObject) continue;

                String key = type.getName() + "#" + method.getName();
                checked.add(key);
                if (!ANDROID_USES_OBJECT.containsKey(key)) {
                    offenders.add(key + " " + describe(method));
                }
            }
        }

        assertTrue(
                offenders.isEmpty(),
                """
                A shim method mentions bare Object where Android names a type.

                That is not a style problem: the JVM resolves a call by its full
                descriptor, so a widened parameter or return type renames the
                method. The extension's call site fails with NoSuchMethodError
                and the shim's own message is never reached.

                Either declare the Android type (adding a stub for it if needed,
                as android.content.res.AssetManager was added for getAssets), or
                — if Android's own signature really does use Object — add the
                method to ANDROID_USES_OBJECT with the upstream signature.

                Offending: """ + String.join("\n           ", offenders));

        // Stale entries are failures too, or the list becomes a graveyard that
        // silently permits a future method sharing a removed one's name.
        List<String> stale = new ArrayList<>(ANDROID_USES_OBJECT.keySet());
        stale.removeAll(checked);
        assertTrue(
                stale.isEmpty(),
                "ANDROID_USES_OBJECT names methods that no longer mention Object. "
                        + "Remove them, or the allow-list starts permitting the next bug: " + stale);
    }

    /**
     * The four fixed near-misses, pinned by descriptor.
     *
     * <p>The check above is a rule; these are the specific call sites that were
     * broken, asserted the way an extension asks about them. Together they fail
     * in both directions — a regression on one of these named methods, and a new
     * one anywhere else.
     */
    @Test
    void theKnownNearMissesResolveToTheirAndroidDescriptors() throws Exception {
        assertReturns("android.content.Context", "getAssets", "android.content.res.AssetManager");
        assertReturns("android.content.Context", "getContentResolver", "android.content.ContentResolver");
        assertReturns("android.content.Context", "getResources", "android.content.res.Resources");
        assertReturns("android.content.Context", "getPackageManager", "android.content.pm.PackageManager");
        assertReturns("androidx.fragment.app.Fragment", "getResources", "android.content.res.Resources");

        assertTakes("android.content.Context", "startActivity", "android.content.Intent");
        assertTakes("android.view.Window", "setBackgroundDrawable", "android.graphics.drawable.Drawable");
    }

    /**
     * A refusal has to be reachable to be worth writing.
     *
     * <p>Every one of these returns an object whose accessors throw. That is the
     * design — DROP-12 concedes the type, never the authority — but it only
     * works if the call links first, which is what the descriptors above buy.
     */
    @Test
    void theConcededTypesStillRefuseTheirOperations() throws Exception {
        Object assets = Class.forName("android.content.res.AssetManager")
                .getDeclaredConstructor().newInstance();
        Method open = assets.getClass().getMethod("open", String.class);
        Throwable thrown = org.junit.jupiter.api.Assertions.assertThrows(
                java.lang.reflect.InvocationTargetException.class,
                () -> open.invoke(assets, "anything"));
        assertEquals(
                "android.content.UnsupportedAndroidApiException",
                thrown.getCause().getClass().getName());

        // getType is the documented exception: Android returns null for an
        // unknown type, so a caller that checks takes its own branch.
        Object resolver = Class.forName("android.content.ContentResolver")
                .getDeclaredConstructor().newInstance();
        Method getType = resolver.getClass().getMethod("getType", Class.forName("android.net.Uri"));
        org.junit.jupiter.api.Assertions.assertNull(getType.invoke(resolver, new Object[]{null}));
    }

    // --- helpers -------------------------------------------------------------

    private static void assertReturns(String owner, String method, String expected) throws Exception {
        assertEquals(
                expected,
                Class.forName(owner).getMethod(method).getReturnType().getName(),
                owner + "." + method + " must return Android's declared type, not a supertype");
    }

    private static void assertTakes(String owner, String method, String parameter) throws Exception {
        assertEquals(
                parameter,
                Class.forName(owner).getMethod(method, Class.forName(parameter))
                        .getParameterTypes()[0].getName(),
                owner + "." + method + " must take Android's declared type, not a supertype");
    }

    private static String describe(Method method) {
        StringBuilder sb = new StringBuilder(method.getReturnType().getSimpleName()).append(" (");
        Class<?>[] parameters = method.getParameterTypes();
        for (int i = 0; i < parameters.length; i++) {
            if (i > 0) sb.append(", ");
            sb.append(parameters[i].getSimpleName());
        }
        return sb.append(')').toString();
    }

}
