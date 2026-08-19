package com.lagradost.cloudstream3.network

import okhttp3.Headers
import okhttp3.Interceptor
import okhttp3.Response
import java.net.URI

/**
 * `com.lagradost.cloudstream3.network.CloudflareKiller` — 16 load failures named
 * this class, and none of them was a plugin trying to bypass Cloudflare.
 *
 * ## The failure was not where it looked
 *
 * Every recorded trace ends in `PluginHost.describeProvider` → `Class.getMethod`,
 * not in a request. `getMethod` resolves the parameter and return types of
 * *every* public method on the class, so a provider that merely declares
 *
 * ```kotlin
 * val cfKiller = CloudflareKiller()
 * override val interceptor = cfKiller
 * ```
 *
 * could not have its `getName()` read. The provider had already registered
 * successfully; asking it its own name is what killed the load. That half is
 * fixed in `PluginHost` — the catch there now includes `LinkageError` — but the
 * type still has to exist, or the same providers fail again at their first
 * request instead.
 *
 * Another `:app` type, like [com.lagradost.cloudstream3.plugins.Plugin] and
 * [com.lagradost.cloudstream3.utils.DataStore]. `library-jvm` publishes
 * `WebViewResolver` from this same package but not this class, which is why the
 * gap survived the original survey.
 *
 * ## Why this forwards instead of bypassing
 *
 * The real implementation drives a `WebView`: it loads the challenge page,
 * lets Cloudflare's JavaScript run, and harvests `cf_clearance` from the
 * `CookieManager`. There is no WebView in the sidecar — that is docs/PRD/36
 * step 7, still outstanding — and there is no way to solve the challenge
 * without one. A proof-of-work interstitial cannot be answered by an HTTP
 * client.
 *
 * So this forwards the request unchanged and returns whatever the host says. A
 * site behind Cloudflare answers 403 and the provider reports no results, which
 * is the truth. The alternatives are both worse:
 *
 * - **Throwing** would break providers that attach a `CloudflareKiller`
 *   defensively and mostly talk to hosts that never challenge them. That is the
 *   common case in the corpus — the interceptor is set once on the provider and
 *   covers every request it makes, protected or not.
 * - **Retrying or forging a `cf_clearance`** would be a lie to plugin code about
 *   what happened, and DROP-9 rules it out for the same reason
 *   `PackageManager.getPackagesForUid` returns null rather than a plausible
 *   package name.
 *
 * When the WebView bridge lands, this class is where it plugs in: the shape
 * below is upstream's, so a real `bypassCloudflare` can replace the forward
 * without touching a single extension.
 */
@Suppress("unused")
class CloudflareKiller : Interceptor {

    companion object {
        const val TAG = "CloudflareKiller"

        /**
         * Pure string work and identical to upstream, so it is implemented
         * rather than stubbed — extensions call it on cookie headers they
         * obtained themselves, which has nothing to do with the WebView.
         */
        fun parseCookieMap(cookie: String): Map<String, String> {
            return cookie.split(";").associate {
                val split = it.split("=")
                (split.getOrNull(0)?.trim() ?: "") to (split.getOrNull(1)?.trim() ?: "")
            }.filter { it.key.isNotBlank() && it.value.isNotBlank() }
        }
    }

    /**
     * Real and mutable, because extensions treat it as their own store: the
     * corpus reads it, calls `containsKey` on it, and clears it between
     * requests. Nothing populates it here — no challenge is ever solved — so it
     * stays empty unless an extension puts something in it, and an extension
     * that does gets its own entries back.
     */
    val savedCookies: MutableMap<String, Map<String, String>> = mutableMapOf()

    /**
     * Cookies for [url]'s host, as request headers.
     *
     * Six call sites in the corpus pass `mainUrl` here and splice the result
     * into a request. Empty headers are the correct answer for a host we hold no
     * cookies for, and merging empty headers is a no-op — so those call sites
     * behave exactly as they would on Android before the first challenge.
     */
    fun getCookieHeaders(url: String): Headers {
        val host = runCatching { URI(url).host }.getOrNull()
        val cookies = savedCookies[host] ?: return Headers.headersOf()
        if (cookies.isEmpty()) return Headers.headersOf()
        val cookie = cookies.entries.joinToString("; ") { "${it.key}=${it.value}" }
        return Headers.headersOf("Cookie", cookie)
    }

    override fun intercept(chain: Interceptor.Chain): Response {
        val request = chain.request()
        val cookies = savedCookies[request.url.host]
        if (cookies.isNullOrEmpty()) return chain.proceed(request)

        // An extension that populated the map itself gets its cookies sent.
        val merged = request.newBuilder()
            .header("Cookie", cookies.entries.joinToString("; ") { "${it.key}=${it.value}" })
            .build()
        return chain.proceed(merged)
    }
}
