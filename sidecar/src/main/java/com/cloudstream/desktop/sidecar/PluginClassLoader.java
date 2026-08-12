package com.cloudstream.desktop.sidecar;

import java.net.URL;
import java.net.URLClassLoader;
import java.util.Set;

/**
 * Class loader for one translated plugin.
 *
 * Stands in for Android's {@code PathClassLoader(filePath, context.classLoader)}
 * (PluginManager.kt:611): parent-first delegation to a shared classpath holding
 * the provider API, the compatibility shims and the third-party libraries the
 * ecosystem depends on, with the plugin's own translated jar layered on top.
 *
 * <h2>What this actually enforces</h2>
 * Loader-level isolation is one control among several, and it is important not
 * to overstate it. This class enforces exactly one thing: plugin code cannot
 * reach the sidecar's own internals, so it cannot reflect into the RPC channel,
 * the translator cache, or the supervisor's state (DROP-12).
 *
 * <p>It does <strong>not</strong> — and cannot — stop {@code System.exit},
 * {@code Runtime.exec} or raw sockets, because those live in {@code java.*} and
 * are always resolved by the bootstrap loader, out of any application loader's
 * reach. Java's {@code SecurityManager}, which used to cover that gap, is
 * deprecated and being removed (JEP 411/486), and DROP-25 forbids designs that
 * depend on it. Those controls are therefore delivered by the layers that can
 * actually deliver them:
 *
 * <ul>
 *   <li>{@code System.exit} — contained by the process boundary. The sidecar is
 *       a separate OS process, so an exiting plugin kills only the sidecar and
 *       the supervisor restarts it (DROP-26, AC-D4).</li>
 *   <li>{@code System.loadLibrary} — the sidecar is launched with an empty
 *       {@code java.library.path}, so native loads fail (DROP-24).</li>
 *   <li>Process creation and raw network egress — an OS-level sandbox (a Windows
 *       job object with a restricted token) applied by the launcher. Until that
 *       ships, DROP-23 and the process-spawn half of DROP-24 are
 *       <em>unenforced</em>, and {@link #SANDBOX_GAPS} states so rather than
 *       letting the absence pass silently.</li>
 * </ul>
 */
public final class PluginClassLoader extends URLClassLoader {

    /**
     * Controls named in docs/PRD/31 §6 that this build does not yet enforce.
     * Reported to the host so the UI can tell the truth about the sandbox
     * instead of implying a guarantee that is not there.
     */
    public static final Set<String> SANDBOX_GAPS = Set.of(
            "DROP-23: outbound network egress is not blocked at the OS level; a plugin can open a raw socket.",
            "DROP-24: process creation is not blocked at the OS level; Runtime.exec is reachable.");

    /** Sidecar internals that plugin code must never resolve. */
    private static final String[] DENIED_PREFIXES = {
            "com.cloudstream.desktop.sidecar.",
    };

    /** Types inside the denied packages that plugins legitimately need. */
    private static final Set<String> DENY_EXEMPT = Set.of(
            "com.cloudstream.desktop.sidecar.shim.Bridge");

    private final String pluginId;

    public PluginClassLoader(String pluginId, URL[] pluginJars, ClassLoader sharedParent) {
        super("cs3-plugin-" + pluginId, pluginJars, sharedParent);
        this.pluginId = pluginId;
    }

    public String pluginId() {
        return pluginId;
    }

    @Override
    protected Class<?> loadClass(String name, boolean resolve) throws ClassNotFoundException {
        for (String denied : DENIED_PREFIXES) {
            if (name.startsWith(denied) && !DENY_EXEMPT.contains(name)) {
                throw new ClassNotFoundException(
                        "Plugin " + pluginId + " attempted to load sidecar internal " + name
                                + ". Plugin code has no access to sidecar internals (DROP-12).");
            }
        }
        return super.loadClass(name, resolve);
    }
}
