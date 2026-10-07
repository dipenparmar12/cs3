package com.lagradost.cloudstream3.network

import com.cloudstream.desktop.bridge.HostBridge
import com.cloudstream.desktop.bridge.json
import com.lagradost.cloudstream3.utils.AppUtils.parseJson
import okhttp3.Headers
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import okio.Buffer
import java.net.URI
import java.util.Base64
import java.util.concurrent.ConcurrentHashMap

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
 * ## How a challenge is answered here
 *
 * The extension-facing shape is upstream's, so no extension had to change: send
 * the request, and only when the reply is a real challenge, obtain a clearance
 * and re-send with it. **A browser is never opened for a reply that is not a
 * challenge** — the corpus attaches this interceptor defensively, to every
 * request a provider makes.
 *
 * What is *not* upstream's is where the clearance lives. Android keeps it in
 * [savedCookies], per interceptor instance, until the process dies, so every
 * provider re-solves every host after every start. Here the desktop app owns
 * it (`clearance.ts`): the browser partition's cookie jar is the store, one
 * solve per host is shared by every provider and by the app's own indexer
 * client, and a host the browser could not pass is left alone for ten minutes
 * instead of costing a full timeout on every request. So, on a challenge:
 *
 * 1. Ask the host for a clearance. Usually the jar already holds a live one and
 *    no window opens at all — the restart case, which Android pays a browser
 *    for every time.
 * 2. Re-send with it and the browser's agent.
 * 3. Challenged again with a clearance issued moments ago? Then the wall scores
 *    more than the cookie — the TLS handshake, which OkHttp does not perform
 *    like Chrome. The request is relayed through the browser's own network
 *    stack (`clearance.fetch`), the client that earned the clearance.
 * 4. Challenged with a clearance that was *remembered*? It went stale. It is
 *    invalidated in the jar and one fresh one is obtained.
 *
 * ## Kept from the forwarding version
 *
 * When no browser is reachable — an older runtime, or a JVM whose host has gone
 * — this forwards rather than throwing. A site behind Cloudflare then answers
 * 403 and the provider reports no results, which is the truth.
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

        /**
         * Clearances obtained in this process, by host, shared by every
         * instance. A cache of the host's jar, not a second store: it saves a
         * reverse call on every request to a host already cleared.
         */
        private val cleared = ConcurrentHashMap<String, Map<String, String>>()

        /** Deadline for a solve. The host's own browser budget sits inside it. */
        private const val SOLVE_TIMEOUT_MS = 60_000L
        private const val RELAY_TIMEOUT_MS = 30_000L

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
        val cookies = host?.let { savedCookies[it] ?: cleared[it] }.orEmpty()
        val builder = Headers.Builder()
        if (cookies.isNotEmpty()) builder.add("Cookie", cookieHeader(cookies))
        WebViewResolver.webViewUserAgent?.takeIf { it.isNotBlank() }
            ?.let { builder.add("user-agent", it) }
        return builder.build()
    }

    override fun intercept(chain: Interceptor.Chain): Response {
        val request = chain.request()
        val host = request.url.host

        val remembered = savedCookies[host] ?: cleared[host]
        if (!remembered.isNullOrEmpty()) {
            val response = chain.proceed(withCookies(request, remembered))
            if (!isChallenge(response)) return response
            response.close()
            // Refused: the clearance went stale. Forget it here and in the jar,
            // or the host would hand the same dead cookie straight back.
            forget(host)
            if (HostBridge.isAvailable()) {
                HostBridge.call("clearance.invalidate", json { field("url", request.url.toString()) })
            }
            return answerChallenge(chain, request)
        }

        val response = chain.proceed(request)
        if (!isChallenge(response)) return response

        // Upstream closes before re-issuing, and it matters: the body is an
        // interstitial nobody will read, and leaving it open holds the
        // connection out of the pool for the retry that is about to need one.
        response.close()
        return answerChallenge(chain, request)
    }

    private fun answerChallenge(chain: Interceptor.Chain, request: Request): Response {
        val host = request.url.host
        // The original request again on failure, so the caller sees the site's
        // own 403 rather than a failure invented here.
        val clearance = obtain(request.url.toString()) ?: return chain.proceed(request)

        savedCookies[host] = clearance
        cleared[host] = clearance
        val retried = chain.proceed(withCookies(request, clearance))
        if (!isChallenge(retried)) return retried

        // A clearance issued moments ago, refused anyway: the wall is scoring the
        // client, not the cookie. Only the browser itself can send this one.
        val relayed = relay(request) ?: return retried
        retried.close()
        return relayed
    }

    private fun forget(host: String) {
        savedCookies.remove(host)
        cleared.remove(host)
    }

    private fun cookieHeader(cookies: Map<String, String>) =
        cookies.entries.joinToString("; ") { "${it.key}=${it.value}" }

    /**
     * Rebuilds the request with the cookies and the browser's agent.
     *
     * `chain.proceed` rather than upstream's `app.baseClient.newCall`: this is
     * an application interceptor, so proceeding again is allowed and keeps the
     * request inside the chain it started in — every other interceptor the
     * provider installed still applies.
     */
    private fun withCookies(request: Request, cookies: Map<String, String>) =
        request.newBuilder()
            .header("Cookie", cookieHeader(cookies))
            .apply {
                WebViewResolver.webViewUserAgent
                    ?.takeIf { it.isNotBlank() }
                    ?.let { header("user-agent", it) }
            }
            .build()

    /**
     * Upstream's pair, plus Cloudflare's own declaration.
     *
     * A bare 403 is not a challenge — it is far more often hotlink protection or
     * an expired signed URL, neither of which a browser can help with, so the
     * server has to say Cloudflare as well. `cf-mitigated: challenge` is the
     * header Cloudflare documents for exactly this and needs no inference;
     * upstream predates it.
     */
    private fun isChallenge(response: Response): Boolean =
        response.header("cf-mitigated").equals("challenge", ignoreCase = true) ||
            (response.header("Server") in CLOUDFLARE_SERVERS && response.code in ERROR_CODES)

    /** A clearance from the host — out of its jar, or from a browser solve. */
    private fun obtain(url: String): Map<String, String>? {
        if (!HostBridge.isAvailable()) return null
        val params = json {
            field("url", url)
            field("solve", true)
            field("timeoutMs", SOLVE_TIMEOUT_MS)
        }
        val answer = runCatching {
            parseJson<HostClearanceAnswer>(HostBridge.call("clearance.get", params))
        }.getOrElse {
            System.err.println("[$TAG] unreadable clearance answer for $url: ${it.message}")
            return null
        }
        if (!answer.ok) {
            System.err.println("[$TAG] ${answer.error}")
            return null
        }
        answer.userAgent?.takeIf { it.isNotBlank() }?.let { WebViewResolver.webViewUserAgent = it }
        return answer.cookies.takeIf { it.isNotEmpty() }
    }

    /**
     * The request, sent by the browser's network stack instead of OkHttp.
     * Null when the host would not or could not — the caller then returns the
     * challenge it already holds, which is the honest answer.
     */
    private fun relay(request: Request): Response? {
        val body = request.body?.let { body ->
            val buffer = Buffer()
            runCatching { body.writeTo(buffer) }.getOrNull() ?: return null
            Base64.getEncoder().encodeToString(buffer.readByteArray())
        }
        val params = json {
            field("url", request.url.toString())
            field("method", request.method)
            stringMap("headers", request.headers.names().associateWith { request.headers.values(it).joinToString(", ") })
            field("bodyBase64", body)
            field("timeoutMs", RELAY_TIMEOUT_MS)
        }
        val answer = runCatching {
            parseJson<HostRelayAnswer>(HostBridge.call("clearance.fetch", params))
        }.getOrNull()
        val status = answer?.status
        if (answer == null || !answer.ok || status == null) {
            System.err.println("[$TAG] relay refused for ${request.url}: ${answer?.error}")
            return null
        }
        val headers = Headers.Builder().apply {
            for ((name, values) in answer.headers) for (value in values) addUnsafeNonAscii(name, value)
        }.build()
        val bytes = Base64.getDecoder().decode(answer.bodyBase64 ?: "")
        return Response.Builder()
            .request(request)
            .protocol(Protocol.HTTP_1_1)
            .code(status)
            .message(answer.statusText ?: "")
            .headers(headers)
            .body(bytes.toResponseBody(headers["content-type"]?.toMediaTypeOrNull()))
            .build()
    }
}

/** `ClearanceAnswer` in `clearance.ts`; every field defaulted, bound by name. */
internal data class HostClearanceAnswer(
    val ok: Boolean = false,
    val error: String? = null,
    val cookies: Map<String, String> = emptyMap(),
    val userAgent: String? = null,
    val source: String? = null,
)

/** `RelayAnswer` in `clearanceRelay.ts`; every field defaulted, bound by name. */
internal data class HostRelayAnswer(
    val ok: Boolean = false,
    val error: String? = null,
    val status: Int? = null,
    val statusText: String? = null,
    val url: String? = null,
    val headers: Map<String, List<String>> = emptyMap(),
    val bodyBase64: String? = null,
)
