package com.cloudstream.desktop.bridge

import okhttp3.OkHttpClient
import okhttp3.Request as OkRequest
import okhttp3.RequestBody.Companion.toRequestBody
import org.schabi.newpipe.extractor.NewPipe
import org.schabi.newpipe.extractor.downloader.Downloader
import org.schabi.newpipe.extractor.downloader.Request
import org.schabi.newpipe.extractor.downloader.Response
import org.schabi.newpipe.extractor.exceptions.ReCaptchaException
import org.schabi.newpipe.extractor.localization.ContentCountry
import org.schabi.newpipe.extractor.localization.Localization
import java.util.concurrent.TimeUnit

/**
 * Gives NewPipeExtractor the downloader it refuses to work without.
 *
 * `NewPipeExtractor` ships inside `library-jvm`'s dependency closure and backs
 * upstream's `YoutubeExtractor`, which `loadExtractor` reaches for on any
 * `youtube.com` or `youtu.be` link — and plenty of providers hand those back,
 * either as the video itself or as a trailer. The extractor is a singleton
 * holding one global `Downloader`, installed with `NewPipe.init(...)`.
 *
 * **Nothing installed it here.** On Android the app does it at startup; this
 * sidecar had no equivalent, so the field stayed null and the very first line of
 * `Extractor.<init>` — `Objects.requireNonNull(downloader, "downloader is null")`
 * — threw. Every YouTube link in the corpus failed with
 * `NullPointerException: downloader is null`, from a stack that names NewPipe
 * and okhttp and never mentions the missing call, so it reads like a broken
 * extractor rather than an uninitialised library.
 *
 * That puts it in the same family as `Plugin`, `DataStore` and `CloudflareKiller`
 * before it: not a translation problem, but something the Android `:app` module
 * does that the sidecar had never been told to do.
 *
 * ## Why the request goes through OkHttp rather than the JDK client
 *
 * OkHttp is already on the shared runtime classpath — every provider's HTTP goes
 * through NiceHttp, which wraps it — so this adds no jar and inherits the same
 * TLS behaviour the rest of the corpus gets. A second HTTP stack with different
 * defaults would make YouTube fail differently from every other host, which is
 * exactly the kind of divergence that costs a day to find.
 */
object NewPipeBootstrap {

    /**
     * A desktop browser User-Agent.
     *
     * Not decoration: YouTube serves a different, cut-down page to unrecognised
     * clients, and NewPipe's parsers are written against the browser response.
     * The library sends no User-Agent of its own — it is the downloader's job,
     * which is part of why a downloader is mandatory.
     */
    private const val USER_AGENT =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
            "(KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36"

    @Volatile
    private var installed = false

    /**
     * Installs the downloader once.
     *
     * Idempotent and non-throwing. It is called from `ProviderBridge`'s
     * initialiser, and a bridge that failed to load because an optional
     * extractor could not be set up would take every provider down with it —
     * a far worse outcome than YouTube links not resolving.
     */
    @JvmStatic
    @Synchronized
    fun install(): Boolean {
        if (installed) return true
        return try {
            NewPipe.init(OkHttpDownloader(), Localization("en", "US"), ContentCountry("US"))
            installed = true
            true
        } catch (t: Throwable) {
            System.err.println(
                "WARN NewPipeBootstrap: YouTube extraction is unavailable: " +
                    "${t.javaClass.simpleName}: ${t.message}"
            )
            false
        }
    }

    private class OkHttpDownloader : Downloader() {

        private val client = OkHttpClient.Builder()
            .connectTimeout(20, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .callTimeout(60, TimeUnit.SECONDS)
            // Redirects are followed for us; `latestUrl` below reports where we
            // ended up, which is what NewPipe uses to detect consent walls.
            .followRedirects(true)
            .followSslRedirects(true)
            .build()

        override fun execute(request: Request): Response {
            val body = request.dataToSend()?.toRequestBody()
            val builder = OkRequest.Builder()
                .url(request.url())
                .method(request.httpMethod(), body)

            for ((name, values) in request.headers()) {
                // Replace rather than append: NewPipe passes a header map where
                // each entry is the complete value list for that name, and
                // `addHeader` in a loop would produce duplicates on a retry.
                builder.removeHeader(name)
                for (value in values) builder.addHeader(name, value)
            }
            if (request.headers().keys.none { it.equals("User-Agent", ignoreCase = true) }) {
                builder.header("User-Agent", USER_AGENT)
            }

            client.newCall(builder.build()).execute().use { response ->
                /**
                 * 429 is a captcha wall, and NewPipe has a dedicated exception
                 * for it that upstream's error handling already understands.
                 * Returning it as an ordinary response would surface as a parse
                 * failure several frames away from the cause.
                 */
                if (response.code == 429) {
                    throw ReCaptchaException("reCaptcha challenge requested", request.url())
                }

                return Response(
                    response.code,
                    response.message,
                    response.headers.toMultimap(),
                    response.body?.string(),
                    response.request.url.toString()
                )
            }
        }
    }
}
