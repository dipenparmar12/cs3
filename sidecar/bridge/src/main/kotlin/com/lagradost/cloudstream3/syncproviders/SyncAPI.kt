package com.lagradost.cloudstream3.syncproviders

import com.lagradost.cloudstream3.ActorData
import com.lagradost.cloudstream3.NextAiring
import com.lagradost.cloudstream3.Score
import com.lagradost.cloudstream3.SearchQuality
import com.lagradost.cloudstream3.SearchResponse
import com.lagradost.cloudstream3.ShowStatus
import com.lagradost.cloudstream3.TvType
import com.lagradost.cloudstream3.utils.ListSorting
import com.lagradost.cloudstream3.utils.SyncWatchType
import com.lagradost.cloudstream3.utils.UiText
import java.util.Date

/**
 * The metadata-sync surface, and the reason ordinary scrapers reference it.
 *
 * `SyncResult` is the shape an anime provider reads AniList and MAL answers
 * into — canonical title, synopsis, air status, episode count, artwork,
 * recommendations. That makes this a *metadata* type as much as an account
 * one, which is why it shows up in extensions with no sync feature at all and
 * why supplying it turns a total load failure back into a working scraper.
 *
 * The nested types stay nested. They are referenced as
 * `SyncAPI$LibraryList` and `SyncAPI$SyncResult`; a top-level `LibraryList`
 * would satisfy the compiler here and resolve against nothing in a `.cs3`.
 *
 * Every property is faithful to upstream because these are deserialisation
 * targets — Jackson binds by constructor parameter name through
 * `jackson-module-kotlin`, so a renamed field silently binds to null rather
 * than failing, which is the failure mode hardest to trace back to here.
 */
abstract class SyncAPI : AuthAPI() {

    /**
     * Whether this service can be searched by name as well as by id.
     * Reported false: there is no account behind it to search.
     */
    open val mainUrl: String get() = ""

    open val syncIdName: SyncIdName get() = SyncIdName.Anilist

    open val requireLibraryRefresh: Boolean get() = false

    /** One search hit from a sync service. */
    data class SyncSearchResult(
        override val name: String,
        override val apiName: String,
        var syncId: String,
        override val url: String,
        override var posterUrl: String?,
        override var type: TvType? = null,
        override var quality: SearchQuality? = null,
        override var posterHeaders: Map<String, String>? = null,
        override var id: Int? = null,
        override var score: Score? = null,
    ) : SearchResponse

    /**
     * Abstract upstream, and abstract here.
     *
     * A plugin subclassing this — which is how a custom sync provider reports
     * state — needs the same abstract members, and a concrete base would let a
     * subclass compile there and fail to link here.
     */
    abstract class AbstractSyncStatus {
        abstract var status: SyncWatchType
        abstract var score: Score?
        abstract var watchedEpisodes: Int?
        abstract var isFavorite: Boolean?
        abstract var maxEpisodes: Int?
    }

    data class SyncStatus(
        override var status: SyncWatchType,
        override var score: Score?,
        override var watchedEpisodes: Int?,
        override var isFavorite: Boolean? = null,
        override var maxEpisodes: Int? = null,
    ) : AbstractSyncStatus()

    /** The metadata payload. This is what scrapers are actually after. */
    data class SyncResult(
        var id: String,
        var totalEpisodes: Int? = null,
        var title: String? = null,
        var publicScore: Score? = null,
        var duration: Int? = null,
        var synopsis: String? = null,
        var airStatus: ShowStatus? = null,
        var nextAiring: NextAiring? = null,
        var studio: List<String>? = null,
        var genres: List<String>? = null,
        var synonyms: List<String>? = null,
        var trailers: List<String>? = null,
        var isAdult: Boolean? = null,
        var posterUrl: String? = null,
        var backgroundPosterUrl: String? = null,
        var startDate: Long? = null,
        var endDate: Long? = null,
        var recommendations: List<SyncSearchResult>? = null,
        var nextSeason: SyncSearchResult? = null,
        var prevSeason: SyncSearchResult? = null,
        var actors: List<ActorData>? = null,
    )

    data class LibraryItem(
        override val name: String,
        override val url: String,
        val syncId: String,
        val episodesCompleted: Int?,
        val episodesTotal: Int?,
        val personalRating: Score?,
        val lastUpdatedUnixTime: Long?,
        override val apiName: String,
        override var type: TvType?,
        override var posterUrl: String?,
        override var posterHeaders: Map<String, String>?,
        override var quality: SearchQuality?,
        val releaseDate: Date?,
        override var id: Int? = null,
        val plot: String? = null,
        override var score: Score? = null,
        val tags: List<String>? = null,
    ) : SearchResponse

    data class LibraryList(
        val name: UiText,
        val items: List<LibraryItem>,
    )

    data class LibraryMetadata(
        val allLibraryLists: List<LibraryList>,
        val supportedListSorting: Set<ListSorting>,
    )

    data class Page(
        val title: UiText,
        var items: List<LibraryItem>,
    )

    /**
     * Every operation answers "nothing", never throws.
     *
     * These are reached from `runCatching` in some extensions and from bare
     * calls in others. A null propagates through both — the first records a
     * failed `Result`, the second takes its "no metadata available" branch —
     * whereas an exception from the bare call would abort a scrape that had
     * everything else it needed.
     */
    open suspend fun score(id: String, status: AbstractSyncStatus): Boolean = false

    open suspend fun getStatus(id: String): AbstractSyncStatus? = null

    open suspend fun load(id: String): SyncResult? = null

    open suspend fun search(name: String): List<SyncSearchResult>? = null

    open suspend fun getPersonalLibrary(): LibraryMetadata? = null

    open fun getIdFromUrl(url: String): String = url.substringAfterLast('/')
}
