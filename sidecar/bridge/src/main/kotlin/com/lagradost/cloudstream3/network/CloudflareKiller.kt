package com.lagradost.cloudstream3.network

import com.cloudstream.desktop.bridge.HostBridge
import com.cloudstream.desktop.bridge.json
import com.lagradost.cloudstream3.utils.AppUtils.parseJson
import okhttp3.Headers
import okhttp3.Interceptor
import okhttp3.Response
import java.net.URI

/**
 * `com.lagradost.cloudstream3.network.CloudflareKiller` — and since the WebView
 * bridge landed, it actually kills Cloudflare.
 *
 * ## The failure was originally not where it looked
 *
 * 16 load failures named this class, and none of them was a plugin trying to
 * bypass anything. Every recorded trace ends in `PluginHost.describeProvider` →
 * `Class.getMethod`, which resolves the parameter and return types of *every*
 * public method on a class — so a provider that merely declares
 * `override val interceptor = CloudflareKiller()` could not be asked its own
 * name. That half was fixed in `PluginHost` (its catch includes `LinkageError`
 * now); this class had to exist as well, or the same providers failed again at
 * their first request instead of at load.
 *
 * ## What changed
 *
 * This used to forward the request unchanged and return whatever the host said,
 * because there was no WebView in the sidecar and a proof-of-work interstitial
 * cannot be answered by an HTTP client. There is a browser now — Chromium, in
 * the Electron process, one reverse RPC away — so the challenge is solved for
 * real and `cf_clearance` comes back with the answer.
 *
 * The shape is upstream's, deliberately, so extensions did not have to change:
 *
 * 1. No saved cookies for the host -> send the request. If the reply is not a
 *    Cloudflare challenge, that is the answer and no browser is opened.
 * 2. A challenge -> solve it in the browser, save the cookies, re-send.
 * 3. Saved cookies -> send with them attached from the start.
 *
 * **A browser is only opened when a real challenge came back.** The corpus
 * attaches this interceptor defensively — set once on the provider, covering
 * every request it makes, protected or not — so opening one per request would
 * put a Chromium page behind every scrape in the app.
 *
 * ## Two things kept from the forwarding version
 *
 * When no browser is reachable — an older runtime, or a JVM whose host has gone
 * — this still forwards rather than throwing. A site behind Cloudflare then
 * answers 403 and the provider reports no results, which is the truth and is
 * exactly what shipped before.
 *
 * And nothing is ever forged. DROP-9 rules out inventing a `cf_clearance` for
 * the same reason `PackageManager.getPackagesForUid` returns null rather than a
 * plausible package name: lying to plugin code about its platform makes every
 * downstream bug undiagnosable.
 */
@Suppress("unused")
class CloudflareKiller : Interceptor {

    companion object {
        const val TAG = "CloudflareKiller"

        /** Upstream's pair. A challenge is *both* of these, never one. */
        private val ERROR_CODES = listOf(403, 503)
        private val CLOUDFLARE_SERVERS = listOf("cloudflare-nginx", "cloudflare")

        /** The only cookie that matters, and the signal the challenge is done. */
        private const val CLEARANCE = "cf_clearance"

        /**
         * Pure string work and identical to upstream, so it is implemented
         * rather than stubbed — extensions call it on cookie headers they
         * obtained themselves, which has nothing to do with the browser.
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
     * requests. A solved challenge writes here, and an extension that puts its
     * own entries in gets them back.
     */
    val savedCookies: MutableMap<String, Map<String, String>> = mutableMapOf()

    /**
     * Cookies for [url]'s host, as request headers, with the browser's user
     * agent attached.
     *
     * The agent is not decoration. A `cf_clearance` is issued against the agent
     * that earned it, and replaying it under a different one is a reliable way
     * to be challenged again — which is why upstream includes it here too.
     */
    fun getCookieHeaders(url: String): Headers {
        val host = runCatching { URI(url).host }.getOrNull()
        val cookies = host?.let { savedCookies[it] }.orEmpty()
        val builder = Headers.Builder()
        if (cookies.isNotEmpty()) {
            builder.add("Cookie", cookies.entries.joinToString("; ") { "${it.key}=${it.value}" })
        }
        WebViewResolver.webViewUserAgent?.takeIf { it.isNotBlank() }
            ?.let { builder.add("user-agent", it) }
        return builder.build()
    }

    override fun intercept(chain: Interceptor.Chain): Response {
        val request = chain.request()
        val host = request.url.host

        savedCookies[host]?.takeIf { it.isNotEmpty() }?.let { known ->
            return chain.proceed(withCookies(chain, known))
        }

        val response = chain.proceed(request)
        if (!isChallenge(response)) return response

        // Upstream closes before re-issuing, and it matters: the body is an
        // interstitial nobody will read, and leaving it open holds the
        // connection out of the pool for the retry that is about to need one.
        response.close()

        val solved = solve(request.url.toString(), host)
        if (solved.isEmpty()) {
            System.err.println("[$TAG] could not clear Cloudflare for ${request.url}")
            // The original request again, so the caller sees the site's own 403
            // rather than a failure invented here.
            return chain.proceed(request)
        }

        savedCookies[host] = solved
        return chain.proceed(withCookies(chain, solved))
    }

    /**
     * Rebuilds the request with the cookies and the browser's agent.
     *
     * `chain.proceed` rather than upstream's `app.baseClient.newCall`: this is
     * an application interceptor, so proceeding again is allowed and keeps the
     * request inside the chain it started in — every other interceptor the
     * provider installed still applies. Going out through a second client would
     * also risk re-entering this interceptor, which upstream avoids only by
     * reaching for a client that does not have it attached.
     */
    private fun withCookies(chain: Interceptor.Chain, cookies: Map<String, String>) =
        chain.request().newBuilder()
            .header("Cookie", cookies.entries.joinToString("; ") { "${it.key}=${it.value}" })
            .apply {
                WebViewResolver.webViewUserAgent
                    ?.takeIf { it.isNotBlank() }
                    ?.let { header("user-agent", it) }
            }
            .build()

    /**
     * Both conditions, as upstream has it.
     *
     * A bare 403 is not a challenge — it is far more often hotlink protection or
     * an expired signed URL, neither of which a browser can help with, and both
     * of which are common enough that opening one on every 403 would put a
     * Chromium page behind a large share of ordinary scraping failures.
     */
    private fun isChallenge(response: Response): Boolean =
        response.header("Server") in CLOUDFLARE_SERVERS && response.code in ERROR_CODES

    /**
     * Solves the challenge in the host's browser and returns its cookies.
     *
     * No intercept pattern is sent. Upstream passes the deliberately unmatchable
     * `.^` for the same reason: there is no URL to wait for here, only a cookie,
     * so the host is told to finish the moment `cf_clearance` appears rather
     * than to run out its timeout.
     */
    private fun solve(url: String, host: String): Map<String, String> {
        if (!HostBridge.isAvailable()) return emptyMap()

        val params = json {
            field("url", url)
            field("method", "GET")
            // Cloudflare fingerprints the agent, and upstream passes `null` here
            // with the comment "Cloudflare needs default user agent". Omitting
            // it leaves the browser's own, which is the point.
            field("awaitCookie", CLEARANCE)
            field("interceptUrl", ".^")
            field("useOkhttp", false)
            field("timeoutMs", 60_000L)
        }

        val answer = runCatching {
            parseJson<HostWebViewAnswer>(HostBridge.call("webview.resolve", params))
        }.getOrElse {
            System.err.println("[$TAG] unreadable answer while clearing $host: ${it.message}")
            return emptyMap()
        }

        answer.userAgent?.takeIf { it.isNotBlank() }?.let { WebViewResolver.webViewUserAgent = it }
        if (!answer.ok) {
            System.err.println("[$TAG] ${answer.error}")
            return emptyMap()
        }

        // Only a real clearance counts. Saving whatever cookies the page happened
        // to set would make the next request take the "already solved" path and
        // send an ordinary session cookie into a challenge it cannot answer —
        // failing in a way that no longer even tries the browser.
        return if (answer.cookies.containsKey(CLEARANCE)) answer.cookies else emptyMap()
    }
}
