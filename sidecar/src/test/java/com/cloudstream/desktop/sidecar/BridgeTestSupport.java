package com.cloudstream.desktop.sidecar;

import java.lang.reflect.InvocationHandler;
import java.lang.reflect.Method;
import java.lang.reflect.Proxy;

/**
 * Calls the bridge's Kotlin {@code suspend} functions from a Java test.
 *
 * <p>`resolveUsingWebView` takes a hidden {@code Continuation}, so there is no
 * ordinary way to invoke it from here. The alternative — adding a blocking
 * entry point to the bridge purely so a test can reach it — would put a method
 * in the shipped surface that nothing in the product calls, which is worse than
 * this being awkward.
 *
 * <p>Everything is resolved through the shared loader. A {@code Function2} from
 * the test's own loader would be a different interface to the one
 * {@code runBlocking} expects, and the call would fail with a
 * {@code ClassCastException} that says nothing about why.
 */
final class BridgeTestSupport {

    private BridgeTestSupport() { }

    /** Runs `resolver.resolveUsingWebView(url)` to completion and returns the Pair. */
    static Object awaitResolve(ClassLoader shared, Object resolver, String url) throws Exception {
        Class<?> function1 = Class.forName("kotlin.jvm.functions.Function1", true, shared);
        Class<?> function2 = Class.forName("kotlin.jvm.functions.Function2", true, shared);
        Class<?> continuation = Class.forName("kotlin.coroutines.Continuation", true, shared);
        Class<?> builders = Class.forName("kotlinx.coroutines.BuildersKt", true, shared);
        Class<?> context = Class.forName("kotlin.coroutines.EmptyCoroutineContext", true, shared);

        // `(Request) -> Boolean`, the callback upstream uses to filter matches.
        // Always false here: the tests are about the wire, not the filtering.
        Object never = Proxy.newProxyInstance(shared, new Class<?>[] { function1 },
                (proxy, method, args) -> "invoke".equals(method.getName()) ? Boolean.FALSE
                        : defaultObjectMethod(proxy, method, args));

        Method resolve = resolver.getClass().getMethod(
                "resolveUsingWebView", String.class, String.class, String.class,
                function1, continuation);

        InvocationHandler body = (proxy, method, args) -> {
            if (!"invoke".equals(method.getName())) return defaultObjectMethod(proxy, method, args);
            // args[0] is the CoroutineScope; args[1] is the Continuation the
            // suspend function needs threaded through.
            return resolve.invoke(resolver, url, null, "GET", never, args[1]);
        };
        Object block = Proxy.newProxyInstance(shared, new Class<?>[] { function2 }, body);

        Object empty = context.getField("INSTANCE").get(null);
        Method runBlocking = builders.getMethod("runBlocking",
                Class.forName("kotlin.coroutines.CoroutineContext", true, shared), function2);
        return runBlocking.invoke(null, empty, block);
    }

    private static Object defaultObjectMethod(Object proxy, Method method, Object[] args) {
        return switch (method.getName()) {
            case "hashCode" -> System.identityHashCode(proxy);
            case "equals" -> proxy == args[0];
            case "toString" -> "cs3-test-proxy";
            default -> null;
        };
    }
}
