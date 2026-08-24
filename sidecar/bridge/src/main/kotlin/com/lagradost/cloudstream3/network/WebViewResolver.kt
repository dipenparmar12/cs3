package com.lagradost.cloudstream3.network

import com.cloudstream.desktop.bridge.HostBridge
import com.cloudstream.desktop.bridge.json
import com.lagradost.cloudstream3.USER_AGENT
import com.lagradost.cloudstream3.utils.AppUtils.parseJson
import com.lagradost.nicehttp.requestCreator
import kotlinx.coroutines.runBlocking
import okhttp3.Interceptor
import okhttp3.Request
import okhttp3.Response

/**
 * `com.lagradost.cloudstream3.network.WebViewResolver`, actually implemented.
 *
 * ## The class this replaces resolves perfectly and does nothing
 *
 * Unlike `Plugin`, `DataStore` or `CloudflareKiller`, this type is **not**
 * missing from `library-jvm` 4.8.0. It is published, it links, and a
 * compatibility audit that counts `NoClassDefFoundError` sees nothing wrong
 * with it. Its JVM variant is:
 *
 * ```kotlin
 * override fun intercept(chain: Interceptor.Chain): Response = chain.proceed(request)
 * actual suspend fun resolveUsingWebView(...) = TODO("Not yet implemented")
 * ```
 *
 * So a provider that needs a browser does not degrade — it throws
 * `NotImplementedError`, or, through the interceptor, silently receives a
 * Cloudflare interstitial as though it were the page it asked for and reports
 * that it found nothing. **That is why four rounds of shim work never surfaced
 * it**: every one of them was driven by counting missing classes, and this class
 * is not missing.
 *
 * 45 plugin directories across 11 repositories reference this or
 * [CloudflareKiller]. The true reach is wider, because the shared bot-protected
 * extractors (Voe, Vidsonic) are called by many more providers than name the
 * class themselves.
 *
 * ## This must be in the bridge jar, and it must be found first
 *
 * The bridge is loaded by the shared runtime loader, the one that owns
 * `library-jvm.jar`; that is what makes its `MainAPI` the same Class object a
 * provider's is. Here it buys something else as well — a `URLClassLoader`
 * searches its URLs in order, so a copy of this class in a jar reached earlier
 * wins. `PluginHost.shared()` now sorts the bridge to the front for exactly this
 * reason. Before that the order came from `Files.newDirectoryStream`, which
 * specifies none: which implementation loaded would have been a property of the
 * filesystem.
 *
 * ## What differs from Android, honestly
 *
 * Android drives a `WebView` in-process and streams every intercepted request to
 * `requestCallBack` as it happens; returning `true` destroys the view mid-load.
 * Here the browser is Chromium in the Electron process, one RPC away, and the
 * answer arrives as a batch. So the callback is invoked *afterwards*, in
 * observation order, and a `true` truncates the list at that point — which
 * reconstructs what the list would have held had the view been destroyed then.
 * What it cannot do is stop the page loading any sooner. Every corpus call site
 * uses the callback to collect or to filter, both of which survive this; the
 * early-stop is a saving, not a semantic.
 *
 * The other deliberate difference is `useOkhttp`. Android re-issues page
 * subrequests through its own OkHttp client to share cookies and headers; here
 * the browser has its own stack and its own cookie jar, and interposing on every
 * subrequest across a process boundary would cost more than it buys. The flag is
 * carried to the host and used only as the hint upstream documents it as —
 * "disable for cloudflare" — which the host honours by not interfering.
 */
@Suppress("unused")
class WebViewResolver(
    /*
     * Declared `val`, as Android does and the JVM variant does not.
     *
     * The archives we load were compiled against the *Android* artifact, so an
     * extension may read `resolver.interceptUrl`. Exposing the properties is a
     * superset of both surfaces and costs nothing; omitting them would fail at a
     * call site with `NoSuchMethodError` long after this class had linked.
     */
    val interceptUrl: Regex,
    val additionalUrls: List<Regex> = emptyList(),
    val userAgent: String? = USER_AGENT,
    val useOkhttp: Boolean = true,
    val script: String? = null,
    val scriptCallback: ((String) -> Unit)? = null,
    val timeout: Long = DEFAULT_TIMEOUT
) : Interceptor {

    companion object {
        /** Upstream's value. Extensions pass their own; this is the fallback. */
        val DEFAULT_TIMEOUT = 60_000L

        /**
         * The browser's own user agent, filled in by the first resolve.
         *
         * Read by extensions that want their later plain-HTTP requests to look
         * like the browser that solved the challenge — sending a different one
         * is a reliable way to have a fresh `cf_clearance` rejected.
         */
        var webViewUserAgent: String? = null

        /**
         * Present because the Android artifact has it and the JVM one does not.
         * `@JvmName` matches upstream's, so an archive compiled against Android
         * finds the method under the name its bytecode actually references.
         */
        @JvmName("getWebViewUserAgent1")
        fun getWebViewUserAgent(): String? = webViewUserAgent

        private const val TAG = "WebViewResolver"
    }

    /**
     * Blocking, exactly as Android is.
     *
     * An interceptor has to return a `Response`, so there is nowhere to suspend
     * to. Upstream wraps the resolve in `runBlocking` here too; matching it keeps
     * the threading behaviour extensions were written against.
     *
     * When no browser is reachable this proceeds with the original request,
     * which is precisely what the stub it replaces did — so a host without the
     * channel is no worse off than before this class existed.
     */
    override fun intercept(chain: Interceptor.Chain): Response {
        val request = chain.request()
        if (!HostBridge.isAvailable()) return chain.proceed(request)
        return runBlocking {
            val fixed = resolveUsingWebView(request).first
            chain.proceed(fixed ?: request)
        }
    }

    suspend fun resolveUsingWebView(
        url: String,
        referer: String? = null,
        method: String = "GET",
        requestCallBack: (Request) -> Boolean = { false },
    ): Pair<Request?, List<Request>> =
        resolveUsingWebView(url, referer, emptyMap(), method, requestCallBack)

    suspend fun resolveUsingWebView(
        url: String,
        referer: String? = null,
        headers: Map<String, String> = emptyMap(),
        method: String = "GET",
        requestCallBack: (Request) -> Boolean = { false },
    ): Pair<Request?, List<Request>> {
        return try {
            resolveUsingWebView(
                requestCreator(method, url, referer = referer, headers = headers), requestCallBack
            )
        } catch (e: IllegalArgumentException) {
            // Upstream's own guard: `Request.Builder().url(...)` rejects
            // anything that is not http(s), and `data:` URLs reach here.
            System.err.println("[$TAG] illegal url in resolveUsingWebView: $url (${e.message})")
            null to emptyList()
        }
    }

    suspend fun resolveUsingWebView(
        request: Request,
        requestCallBack: (Request) -> Boolean = { false }
    ): Pair<Request?, List<Request>> {
        val params = json {
            field("url", request.url.toString())
            field("method", request.method)
            stringMap("headers", request.headers.toMap())
            field("interceptUrl", interceptUrl.pattern)
            stringArray("additionalUrls", additionalUrls.map { it.pattern })
            field("userAgent", userAgent)
            field("script", script)
            field("useOkhttp", useOkhttp)
            field("timeoutMs", timeout.coerceIn(1_000L, 180_000L))
        }

        val answer = runCatching {
            parseJson<HostWebViewAnswer>(HostBridge.call("webview.resolve", params))
        }.getOrElse {
            System.err.println("[$TAG] unreadable answer from the desktop app: ${it.message}")
            return null to emptyList()
        }

        if (!answer.ok) {
            System.err.println("[$TAG] ${answer.error}")
            return null to emptyList()
        }

        // Recorded before anything else: an extension that goes on to make plain
        // HTTP requests needs the agent the challenge was solved under, and it
        // needs it even when nothing matched.
        answer.userAgent?.takeIf { it.isNotBlank() }?.let { webViewUserAgent = it }
        answer.scriptResults.forEach { scriptCallback?.invoke(it) }

        // In observation order, stopping where the callback asked to stop. The
        // request that returned `true` is kept: Android adds it to the list and
        // *then* destroys the view.
        val extra = mutableListOf<Request>()
        for (seen in answer.extra) {
            val built = seen.toRequest() ?: continue
            extra.add(built)
            if (requestCallBack(built)) return null to extra
        }

        val fixed = answer.request?.toRequest()
        if (fixed != null) requestCallBack(fixed)
        return fixed to extra
    }
}

/**
 * One request the browser was seen to make.
 *
 * Bound by Jackson through [parseJson], which matches constructor parameter
 * *names* — so these have to stay in step with what `webViewHost.ts` emits.
 * Defaults on every field, because a renamed property does not fail loudly, it
 * binds to nothing.
 */
internal data class HostWebRequest(
    val url: String = "",
    val method: String = "GET",
    val headers: Map<String, String> = emptyMap(),
) {
    /**
     * Built through NiceHttp's `requestCreator`, as Android's `toRequest()` is,
     * so header and parameter handling is identical. Null rather than throwing
     * for a URL OkHttp refuses — `data:` and `blob:` subrequests are ordinary on
     * a real page and must not take the whole resolve down with them.
     */
    fun toRequest(): Request? = runCatching { requestCreator(method, url, headers) }.getOrNull()
}

/** The whole answer document. See [HostWebRequest] on why every field has a default. */
internal data class HostWebViewAnswer(
    val ok: Boolean = false,
    val error: String? = null,
    val request: HostWebRequest? = null,
    val extra: List<HostWebRequest> = emptyList(),
    val userAgent: String? = null,
    val cookies: Map<String, String> = emptyMap(),
    val scriptResults: List<String> = emptyList(),
)
