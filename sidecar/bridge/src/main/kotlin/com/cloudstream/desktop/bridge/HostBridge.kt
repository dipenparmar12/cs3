package com.cloudstream.desktop.bridge

import java.util.function.BiFunction

/**
 * The bridge's way of asking the desktop app for something.
 *
 * Everything else in this module answers calls that came *from* the sidecar.
 * This is the one thing that goes the other way, and it exists for
 * [com.lagradost.cloudstream3.network.WebViewResolver]: solving a Cloudflare
 * interstitial or running a page's JavaScript needs a browser, and the browser
 * is Chromium in the Electron process rather than anything reachable from this
 * JVM.
 *
 * ## Why a settable handler rather than a call into the sidecar
 *
 * This jar is loaded by the shared runtime loader, whose parent is the sidecar's
 * own loader, so it *could* name a sidecar class directly. It must not. That
 * would point a compile-time dependency from the bridge into the sidecar —
 * inverting the direction the module exists to keep — and it would place a
 * sidecar type on a loader that plugin code delegates through, which DROP-12
 * rules out. Instead the sidecar reflectively installs a handler here at
 * startup, across the same deliberately trivial surface it uses in the other
 * direction: primitives and JSON strings, nothing else.
 *
 * [BiFunction] because both loaders have to resolve the identical type and only
 * `java.*` is guaranteed to come from the bootstrap loader in both. The deadline
 * travels inside the params document rather than as a third argument, because
 * the JDK has no three-argument functional interface taking a `long`.
 *
 * ## No handler is a supported state
 *
 * An older runtime under `%APPDATA%` has a sidecar that never installs one, and
 * the extensions screen can be looking at a JVM that has not finished starting.
 * Callers get [unavailable] — a well-formed failure document — rather than an
 * exception or a null, so a provider reports "no results" exactly as it did
 * before this existed instead of throwing from inside a scrape.
 */
object HostBridge {

    @Volatile
    private var handler: BiFunction<String, String, String>? = null

    /** Installed reflectively by the sidecar once the shared loader exists. */
    @JvmStatic
    fun setHandler(handler: BiFunction<String, String, String>?) {
        this.handler = handler
    }

    @JvmStatic
    fun isAvailable(): Boolean = handler != null

    /**
     * Asks the host for something and returns its answer document.
     *
     * Never throws and never returns null: every failure is rendered as
     * `{"ok":false,"error":…}` so the call site has one shape to read. A thrown
     * exception here would surface as a plugin crash, and the plugin would be
     * blamed for a component it does not know exists.
     */
    @JvmStatic
    fun call(method: String, paramsJson: String): String {
        val current = handler
            ?: return unavailable(
                "The extension runtime has no channel to the desktop app, so $method cannot be served."
            )
        return try {
            // A Java lambda may hand back null whatever its signature says, and
            // this one crosses a class loader, so the platform type is checked.
            val answer: String? = current.apply(method, paramsJson)
            answer ?: unavailable("$method returned no answer.")
        } catch (t: Throwable) {
            // Includes LinkageError: the handler is a lambda from another class
            // loader, and a mismatched runtime fails here rather than at install.
            unavailable("$method failed: ${t::class.java.simpleName}: ${t.message ?: "no detail"}")
        }
    }

    private fun unavailable(message: String): String =
        json {
            field("ok", false)
            field("error", message)
        }
}
