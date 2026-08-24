package com.cloudstream.desktop.bridge

import com.lagradost.cloudstream3.AnimeLoadResponse
import com.lagradost.cloudstream3.AudioFile
import com.lagradost.cloudstream3.Episode
import com.lagradost.cloudstream3.LiveStreamLoadResponse
import com.lagradost.cloudstream3.LoadResponse
import com.lagradost.cloudstream3.MainAPI
import com.lagradost.cloudstream3.MovieLoadResponse
import com.lagradost.cloudstream3.Score
import com.lagradost.cloudstream3.SearchResponse
import com.lagradost.cloudstream3.SubtitleFile
import com.lagradost.cloudstream3.TorrentLoadResponse
import com.lagradost.cloudstream3.TvSeriesLoadResponse
import com.lagradost.cloudstream3.utils.DrmExtractorLink
import com.lagradost.cloudstream3.utils.ExtractorLink
import com.lagradost.cloudstream3.utils.ExtractorLinkPlayList
import com.lagradost.cloudstream3.utils.ExtractorLinkType
import com.lagradost.cloudstream3.utils.PlayListItem
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

    init {
        /**
         * NewPipeExtractor needs a downloader installed before anything touches
         * it, and nothing was installing one — so every YouTube link a provider
         * returned failed with `NullPointerException: downloader is null`.
         *
         * Done here because this object is the first bridge code the sidecar
         * loads, so it runs exactly once and before any `loadLinks` can reach
         * `loadExtractor`. `install()` never throws: a bridge that failed to
         * load over an optional extractor would take every provider with it.
         */
        NewPipeBootstrap.install()
    }

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
     * Both overloads are attempted, paginated first, because which one a
     * provider implements is not knowable in advance and the base class throws
     * `NotImplementedError` for the other.
     *
     * The order is not arbitrary and it is the opposite of what doc 36 assumed.
     * Measured against library 4.8.0 with the real InternetArchiveProvider:
     * calling `search(query)` alone returns "unsupported", because 4.8.0
     * introduced `search(query, page): SearchResponseList` as the primary form
     * and providers now override that. Older providers still only implement the
     * single-argument version, so the fallback has to stay.
     */
    @JvmStatic
    fun search(provider: Any, query: String, timeoutMs: Long): String = guarded(timeoutMs) {
        val api = provider as MainAPI

        val results: List<SearchResponse> = try {
            api.search(query, 1)?.items.orEmpty()
        } catch (t: Throwable) {
            if (!notImplemented(t)) throw t
            api.search(query).orEmpty()
        }

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
        val year = (item as? com.lagradost.cloudstream3.MovieSearchResponse)?.year
            ?: (item as? com.lagradost.cloudstream3.TvSeriesSearchResponse)?.year
            ?: (item as? com.lagradost.cloudstream3.AnimeSearchResponse)?.year
        field("year", year)
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
            /**
             * Live TV, and the reason an entire content category was missing.
             *
             * `TvType.Live` providers are a substantial part of the corpus and
             * every one of them fell into the `else` branch below, which said
             * live streams had "no single data url worth guessing at". They do:
             * `dataUrl` is on the class, and it is the only handle the channel
             * has. Without it a live provider searched, opened a detail page and
             * offered nothing to play.
             *
             * `isLive` travels with it because live changes the player rather
             * than just the source: there is no duration to seek within, no
             * position worth resuming, and an ended stream is a channel going
             * off air rather than a title finishing.
             */
            is LiveStreamLoadResponse -> {
                field("dataUrl", response.dataUrl)
                field("isLive", true)
            }
            else -> {
                // Other LoadResponse shapes carry neither an episode list nor a
                // single data url. Nothing here is worth guessing at.
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
        /**
         * The provider's own answer to "what is this stream?".
         *
         * `ExtractorLinkType` is what Android hands ExoPlayer to pick a
         * `MediaSource` factory, so it is a statement of intent rather than a
         * guess — and it is the only reliable one available. The desktop used
         * to re-derive the transport by matching `.m3u8`, `/hls/` and
         * `?format=m3u8` against the URL, which is wrong in both directions:
         * providers serve playlists from `.php` addresses with no extension,
         * and a progressive MP4 sitting behind a path containing `dash` is not
         * a manifest. `isDash` in particular was never read from here at all —
         * the base class has carried it since 4.x and the host was inferring it
         * from the string.
         */
        field("mimeType", mimeTypeOf(link.type))
        field("isM3u8", link.isM3u8)
        field("isDash", link.isDash)
        // Upstream's `allHeaders` does exactly this fold. Sending the referer as
        // a header matters: many hosts 403 a request that omits it, which the
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
        /**
         * Audio delivered as its own file, beside the video.
         *
         * Android merges these into the timeline with a `MergingMediaSource`,
         * which is how a provider ships one video track and four dubs without
         * muxing five copies of the film. Only the URL used to cross this
         * boundary, and a URL without its headers is a 403 on most of the hosts
         * that do this — so the track arrived nameless *and* unfetchable.
         */
        rawArray("audioTracks", link.audioTracks.orEmpty().map { encodeAudioFile(it) })

        /**
         * DRM, as the provider declared it.
         *
         * This is the field whose absence was most expensive. A
         * `DrmExtractorLink` carries the ClearKey pair or the licence endpoint
         * that makes the stream playable, and none of it reached the desktop —
         * so an encrypted stream arrived indistinguishable from an ordinary
         * one, was handed to ffprobe (which holds no keys), spent its timeout
         * on encrypted noise and was reported as a corrupt file. The engine has
         * had somewhere to put this since PRD-37; nothing was ever filling it.
         */
        if (link is DrmExtractorLink) {
            raw("drm", encodeDrm(link))
        }

        /**
         * A film delivered in parts.
         *
         * `ExtractorLinkPlayList` is how a provider says "these N URLs are one
         * title, in this order" — the shape used by hosts that cap upload
         * length. Android concatenates them into a single timeline. Dropping
         * the list left only the base link, which for a playlist is not a
         * playable address at all.
         */
        if (link is ExtractorLinkPlayList) {
            rawArray("playlist", link.playlist.map { encodePlayListItem(it) })
        }
    }

    private fun encodeAudioFile(file: AudioFile): String = json {
        field("url", file.url)
        stringMap("headers", file.headers)
    }

    private fun encodePlayListItem(item: PlayListItem): String = json {
        field("url", item.url)
        // Microseconds, as ExoPlayer's ClippingMediaSource takes them. Kept in
        // the source unit rather than converted, because 0 means "unknown" here
        // and would become an indistinguishable 0.0 seconds after a divide.
        field("durationUs", item.durationUs)
    }

    /**
     * The DRM parameters, named by scheme rather than by UUID.
     *
     * The UUID is what Android needs and a meaningless 36 characters to
     * everything on the desktop side, where the question is only ever "can this
     * machine decrypt it?". ClearKey can be answered locally from `kid`/`key`;
     * Widevine and PlayReady need a CDM this app does not ship. Both the raw
     * UUID and the resolved name go over, because a scheme we do not recognise
     * must still be reportable by its identifier rather than silently becoming
     * "no DRM" — which would send it back down the ffmpeg path this exists to
     * keep it off.
     */
    private fun encodeDrm(link: DrmExtractorLink): String {
        val uuid = runCatching { link.uuid.toString() }.getOrNull()
        return json {
            field("scheme", drmSchemeOf(uuid))
            field("uuid", uuid)
            field("kid", link.kid)
            field("key", link.key)
            field("keyType", link.kty)
            field("licenseUrl", link.licenseUrl)
            stringMap("keyRequestParameters", link.keyRequestParameters)
        }
    }

    /**
     * The MIME type upstream attaches to each link type.
     *
     * Restated here rather than read from `ExtractorLinkType.mimeType`, which is
     * `internal` to the library module: its bytecode is public but the Kotlin
     * metadata hides it, so referencing it does not compile. The four values are
     * copied verbatim from that property — if upstream changes one, this is the
     * line that has to follow it.
     */
    private fun mimeTypeOf(type: ExtractorLinkType): String = when (type) {
        ExtractorLinkType.VIDEO -> "video/mp4"
        ExtractorLinkType.M3U8 -> "application/x-mpegURL"
        ExtractorLinkType.DASH -> "application/dash+xml"
        ExtractorLinkType.TORRENT, ExtractorLinkType.MAGNET -> "application/x-bittorrent"
    }

    /** The three registered DRM system ids, lower-cased and hyphenated. */
    private fun drmSchemeOf(uuid: String?): String = when (uuid?.lowercase()) {
        "edef8ba9-79d6-4ace-a3c8-27dcd51d21ed" -> "widevine"
        "9a04f079-9840-4286-ab92-e65be0885f95" -> "playready"
        "e2719d58-a985-b3c9-781a-b030af78d30e" -> "clearkey"
        null -> "clearkey"
        else -> "unknown"
    }

    private fun encodeSubtitle(subtitle: SubtitleFile): String = json {
        field("lang", subtitle.lang)
        field("url", subtitle.url)
        stringMap("headers", subtitle.headers)
    }
}
