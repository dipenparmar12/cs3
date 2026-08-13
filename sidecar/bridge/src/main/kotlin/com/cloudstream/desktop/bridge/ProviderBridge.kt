package com.cloudstream.desktop.bridge

import com.lagradost.cloudstream3.AnimeLoadResponse
import com.lagradost.cloudstream3.Episode
import com.lagradost.cloudstream3.LoadResponse
import com.lagradost.cloudstream3.MainAPI
import com.lagradost.cloudstream3.MovieLoadResponse
import com.lagradost.cloudstream3.Score
import com.lagradost.cloudstream3.SearchResponse
import com.lagradost.cloudstream3.SubtitleFile
import com.lagradost.cloudstream3.TorrentLoadResponse
import com.lagradost.cloudstream3.TvSeriesLoadResponse
import com.lagradost.cloudstream3.utils.ExtractorLink
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout

/**
 * Calls CloudStream providers on behalf of the Java sidecar.
 *
 * This is the piece that makes an installed `.cs3` actually produce results.
 * Everything around it — translation, linkage analysis, the load sequence — has
 * only ever proved a plugin *could* run; nothing until now invoked it.
 *
 * Three properties of the provider API force this to be Kotlin:
 *
 * 1. `search`, `load` and `loadLinks` are `suspend` functions. On the JVM those
 *    compile to methods taking a hidden `Continuation` and returning
 *    `COROUTINE_SUSPENDED` instead of a value, which Java reflection cannot call
 *    usefully.
 * 2. `loadLinks` returns its results through `Function1` callbacks and its
 *    `Boolean` return says only whether the provider thinks it succeeded.
 *    Treating that boolean as the result — and ignoring the callbacks — yields a
 *    provider that always appears to find nothing.
 * 3. A hung provider is the common failure, not the rare one, and it is usually
 *    blocked in a socket read where thread interruption does nothing.
 *    `withTimeout` cancels it properly.
 *
 * Every entry point returns a JSON document and never throws, because the
 * caller is a reflective invoke across a class-loader boundary where a thrown
 * plugin exception would arrive wrapped in `InvocationTargetException` and lose
 * its type.
 */
object ProviderBridge {

    /**
     * A provider that does not override an optional method inherits a base
     * implementation that throws this. It means "unsupported", not "broken" —
     * reporting it as an error would make most providers look faulty.
     */
    private fun notImplemented(t: Throwable): Boolean =
        t is NotImplementedError || t.cause is NotImplementedError

    private inline fun guarded(timeoutMs: Long, crossinline body: suspend () -> String): String =
        try {
            runBlocking { withTimeout(timeoutMs) { body() } }
        } catch (t: Throwable) {
            when {
                notImplemented(t) -> json {
                    field("ok", false)
                    field("unsupported", true)
                    field("error", "This provider does not implement that operation.")
                }
                t is kotlinx.coroutines.TimeoutCancellationException -> json {
                    field("ok", false)
                    field("timedOut", true)
                    field("error", "The provider did not answer within ${timeoutMs} ms.")
                }
                else -> json {
                    field("ok", false)
                    field("error", "${t.javaClass.simpleName}: ${t.message ?: "no detail"}")
                }
            }
        }

    // --- entry points --------------------------------------------------------

    /** Provider identity and capabilities, for the extension manager UI. */
    @JvmStatic
    fun describe(provider: Any): String {
        val api = provider as MainAPI
        return json {
            field("name", api.name)
            field("mainUrl", api.mainUrl)
            field("lang", api.lang)
            field("hasMainPage", api.hasMainPage)
            field("hasQuickSearch", api.hasQuickSearch)
            field("hasDownloadSupport", api.hasDownloadSupport)
            stringArray("supportedTypes", api.supportedTypes.map { it.name })
        }
    }

    /**
     * Full search.
     *
     * The single-argument overload is called deliberately. The paginated
     * `search(query, page)` delegates to it by default, so a provider that only
     * overrode the simple one would throw `NotImplementedError` from the base
     * class if the paginated form were called instead.
     */
    @JvmStatic
    fun search(provider: Any, query: String, timeoutMs: Long): String = guarded(timeoutMs) {
        val api = provider as MainAPI
        val results = api.search(query).orEmpty()
        json {
            field("ok", true)
            rawArray("results", results.map { encodeSearchResponse(it, api) })
        }
    }

    /** Typeahead search. Many providers do not implement it; that is not a fault. */
    @JvmStatic
    fun quickSearch(provider: Any, query: String, timeoutMs: Long): String = guarded(timeoutMs) {
        val api = provider as MainAPI
        val results = api.quickSearch(query).orEmpty()
        json {
            field("ok", true)
            rawArray("results", results.map { encodeSearchResponse(it, api) })
        }
    }

    /** Detail page: plot, poster, and the episode list for series. */
    @JvmStatic
    fun load(provider: Any, url: String, timeoutMs: Long): String = guarded(timeoutMs) {
        val api = provider as MainAPI
        val response = api.load(url)
            ?: return@guarded json {
                field("ok", true)
                field("found", false)
            }
        json {
            field("ok", true)
            field("found", true)
            raw("detail", encodeLoadResponse(response, api))
        }
    }

    /**
     * Resolves playable links for one movie or episode.
     *
     * Results arrive through the two callbacks, not the return value. The
     * boolean is recorded as `reportedSuccess` because a provider can return
     * false having already emitted usable links, and discarding those would
     * throw away a working stream.
     */
    @JvmStatic
    fun loadLinks(provider: Any, data: String, timeoutMs: Long): String = guarded(timeoutMs) {
        val api = provider as MainAPI
        val links = mutableListOf<ExtractorLink>()
        val subtitles = mutableListOf<SubtitleFile>()

        val reported = api.loadLinks(
            data,
            false,
            { subtitle -> synchronized(subtitles) { subtitles += subtitle } },
            { link -> synchronized(links) { links += link } }
        )

        json {
            field("ok", true)
            field("reportedSuccess", reported)
            rawArray("links", links.map { encodeLink(it) })
            rawArray("subtitles", subtitles.map { encodeSubtitle(it) })
        }
    }

    // --- encoding ------------------------------------------------------------

    /**
     * `Score` stores a normalised value; the integer argument is the scale to
     * express it on. Ten matches the 0–10 rating the desktop UI renders.
     */
    private fun scoreOutOfTen(score: Score?): Double? =
        score?.let { runCatching { it.toFloat(10).toDouble() }.getOrNull() }

    private fun encodeSearchResponse(item: SearchResponse, api: MainAPI): String = json {
        field("name", item.name)
        field("url", item.url)
        // A provider may leave apiName blank; the provider's own name is the
        // value every downstream filter and the UI group-by expects.
        field("apiName", item.apiName.ifBlank { api.name })
        field("type", item.type?.name)
        field("posterUrl", item.posterUrl)
        stringMap("posterHeaders", item.posterHeaders)
        field("id", item.id)
        field("quality", item.quality?.name)
    }

    private fun encodeLoadResponse(response: LoadResponse, api: MainAPI): String = json {
        field("name", response.name)
        field("url", response.url)
        field("apiName", response.apiName.ifBlank { api.name })
        field("type", response.type.name)
        field("posterUrl", response.posterUrl)
        field("year", response.year)
        field("plot", response.plot)
        field("rating", scoreOutOfTen(response.score))
        stringArray("tags", response.tags)
        field("duration", response.duration)
        stringArray("actors", response.actors?.mapNotNull { it.actor.name })
        rawArray("recommendations", response.recommendations.orEmpty().map { encodeSearchResponse(it, api) })

        // The playable identity differs by shape: a film carries a single data
        // URL, a series carries episodes. The host needs whichever exists,
        // because that string is what gets handed back to loadLinks.
        when (response) {
            is MovieLoadResponse -> field("dataUrl", response.dataUrl)
            is TorrentLoadResponse -> {
                field("dataUrl", response.magnet ?: response.torrent)
            }
            is TvSeriesLoadResponse ->
                rawArray("episodes", response.episodes.map { encodeEpisode(it) })
            is AnimeLoadResponse ->
                // Anime is keyed by dub status; flattening keeps one episode
                // list for the UI, tagged so a dub and its sub do not collide.
                rawArray(
                    "episodes",
                    response.episodes.entries.flatMap { (status, list) ->
                        list.map { encodeEpisode(it, status.name) }
                    }
                )
            else -> {
                // Other LoadResponse shapes exist (live streams, audio). They
                // have no episode list and no single data url worth guessing at.
            }
        }
    }

    private fun encodeEpisode(episode: Episode, dubStatus: String? = null): String = json {
        // `data` is the provider's opaque handle for this episode and the exact
        // string loadLinks must be given back. It is the load-bearing field.
        field("data", episode.data)
        field("name", episode.name)
        field("season", episode.season)
        field("episode", episode.episode)
        field("posterUrl", episode.posterUrl)
        field("description", episode.description)
        field("date", episode.date)
        field("runTime", episode.runTime)
        field("rating", scoreOutOfTen(episode.score))
        field("dubStatus", dubStatus)
    }

    private fun encodeLink(link: ExtractorLink): String = json {
        field("source", link.source)
        field("name", link.name)
        field("url", link.url)
        field("referer", link.referer)
        field("quality", link.quality)
        field("type", link.type.name)
        field("isM3u8", link.isM3u8)
        // Upstream's `allHeaders` does exactly this fold, but it is `internal`
        // to the library module and so invisible here. Sending the referer as a
        // header matters: many hosts 403 a request that omits it, which the
        // player would surface as an unplayable stream rather than a rejection.
        stringMap(
            "headers",
            buildMap {
                putAll(link.headers)
                if (link.referer.isNotBlank() && !containsKey("referer") && !containsKey("Referer")) {
                    put("Referer", link.referer)
                }
            }
        )
        field("extractorData", link.extractorData)
        // AudioFile carries a URL and headers only — there is no track name or
        // language on it, so separate audio streams are reported by URL.
        stringArray("audioTracks", link.audioTracks?.map { it.url })
    }

    private fun encodeSubtitle(subtitle: SubtitleFile): String = json {
        field("lang", subtitle.lang)
        field("url", subtitle.url)
        stringMap("headers", subtitle.headers)
    }
}
