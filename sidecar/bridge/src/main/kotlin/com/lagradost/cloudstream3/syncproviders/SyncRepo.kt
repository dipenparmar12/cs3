package com.lagradost.cloudstream3.syncproviders

import com.lagradost.cloudstream3.syncproviders.providers.AniListApi

/**
 * The type that killed TorraStream before it ran a line.
 *
 * `NoClassDefFoundError: com/lagradost/cloudstream3/syncproviders/SyncRepo` at
 * `load()`, with no provider registered and nothing else to go on. It is an
 * `:app` type — `library-jvm` 4.8.0 ships only `SyncIdName` out of this whole
 * package — and it is reached from scrapers through
 * [AccountManager.aniListApi], which is how anime providers look up canonical
 * titles and episode counts.
 *
 * Upstream this wraps a [SyncAPI] with token handling and caching. Here it
 * forwards, because the wrapped API already answers "nothing" for everything;
 * keeping the forwarding rather than short-circuiting means a plugin that
 * subclasses [SyncAPI] and registers its own still works.
 *
 * `Result` rather than a bare value, matching upstream: callers write
 * `.getOrNull()` and a differently-shaped return would fail at the call site.
 */
open class SyncRepo(override val api: SyncAPI) : AuthRepo(api) {

    val syncIdName get() = api.syncIdName

    var requireLibraryRefresh: Boolean = false

    suspend fun updateStatus(id: String, newStatus: SyncAPI.AbstractSyncStatus): Result<Boolean> =
        runCatching { api.score(id, newStatus) }

    suspend fun status(id: String): Result<SyncAPI.AbstractSyncStatus?> =
        runCatching { api.getStatus(id) }

    suspend fun load(id: String): Result<SyncAPI.SyncResult?> =
        runCatching { api.load(id) }

    suspend fun library(): Result<SyncAPI.LibraryMetadata?> =
        runCatching { api.getPersonalLibrary() }

    suspend fun search(name: String): Result<List<SyncAPI.SyncSearchResult>?> =
        runCatching { api.search(name) }

    fun getIdFromUrl(url: String): String = api.getIdFromUrl(url)
}

/**
 * Account registry, as extensions reach it.
 *
 * Referenced as `AccountManager.aniListApi` and `AccountManager.syncApis` from
 * static context, which in Kotlin means the companion — so the members live
 * there and are `@JvmStatic` so a Java-shaped call site resolves too.
 *
 * The instances are real objects rather than nulls. An extension writing
 * `AccountManager.aniListApi.load(id)` with no null check — which is the common
 * shape, because on Android the API always exists whether or not anyone has
 * logged in — gets a working call that returns an empty `Result` instead of an
 * NPE inside its own scraper.
 */
abstract class AccountManager(open val idPrefixOverride: String? = null) {

    companion object {
        /**
         * Typed `AniListApi`, not `SyncRepo`, and the difference was measured.
         *
         * Declaring it as the repository wrapper compiled fine and then failed
         * at TorraStream's call site with
         * `NoSuchMethodError: AniListApi AccountManager$Companion.getAniListApi()`.
         * The JVM resolves by exact descriptor, so a getter returning a
         * supertype is a different method — this is the same near-miss the
         * `PluginManager` shim warns about, caught in the act.
         */
        @JvmStatic
        val aniListApi = AniListApi()

        /**
         * Every sync service the app knows about.
         *
         * Only AniList is supplied. The others (MAL, Kitsu, Simkl, Trakt) have
         * not been observed in a single failure across the corpus, and a stub
         * that exists but is never exercised is a liability: it looks
         * supported, and the first extension to use it discovers otherwise at
         * runtime rather than at link time. Members get added when a real
         * extension is seen to need one.
         */
        @JvmStatic
        val syncApis: Array<SyncRepo> = arrayOf(SyncRepo(aniListApi))

        @JvmStatic
        val subtitleProviders: Array<Any> = emptyArray()

        /** No accounts are stored on desktop, so the caches are empty. */
        @JvmStatic
        val cachedAccounts: MutableMap<String, Array<AuthData>> = mutableMapOf()

        @JvmStatic
        val cachedAccountIds: MutableMap<String, Int> = mutableMapOf()
    }
}
