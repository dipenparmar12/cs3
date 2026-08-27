package com.lagradost.cloudstream3.syncproviders.providers

import com.lagradost.cloudstream3.syncproviders.SyncAPI
import com.lagradost.cloudstream3.syncproviders.SyncIdName

/**
 * SIMKL, supplied for the same reason AniList is: an extension reaches for it.
 *
 * `SyncRepo.kt` states the rule this follows — *"members get added when a real
 * extension is seen to need one"* — and names SIMKL among the ones deliberately
 * left out because nothing had been observed to use it. CSX's **CineStream** is
 * that observation. Its `load()` constructs `CineSimklProvider`, which reads
 * `AccountManager.simklApi`, and the whole extension stopped at:
 *
 * ```
 * NoSuchMethodError: 'com.lagradost.cloudstream3.syncproviders.providers.SimklApi
 *                     com.lagradost.cloudstream3.syncproviders.AccountManager$Companion.getSimklApi()'
 *   at cs3-plugin-CineStream//com.megix.CineSimklProvider.<init>
 *   at cs3-plugin-CineStream//com.megix.CineStream.load
 * ```
 *
 * Note the return type in that descriptor. The property has to be typed
 * `SimklApi`, not `SyncAPI` and not `SyncRepo` — the JVM resolves by exact
 * descriptor, so a getter returning a supertype is a different method. That
 * exact near-miss has now been made three times in this repo (`getResources`
 * returning `Object`, `aniListApi` typed as the wrapper, and `setKey` taking
 * `String` where upstream's generic erases to `Object`).
 *
 * **The data classes are faithful; the account operations are not.** These are
 * Jackson binding targets reached through `parseJson`, and `jackson-module-kotlin`
 * binds by constructor parameter *name*: a renamed property does not fail, it
 * binds to null, and the resulting "SIMKL returned no artwork" is close to
 * untraceable. The operations answer null because there is no signed-in account
 * here, which is the branch a caller's "not logged in" path already handles.
 */
class SimklApi : SyncAPI() {

    override val name = "Simkl"
    override val mainUrl = "https://simkl.com"
    override val syncIdName = SyncIdName.Simkl
    override val icon: Int? = null
    override val requiresLogin = true
    override val createAccountUrl = "$mainUrl/signup"

    /** SIMKL returns ids as a bag of cross-service references on every object. */
    data class MediaIds(
        val simkl: Int?,
        val slug: String?,
        val imdb: String?,
        val tmdb: String?,
        val tvdb: String?,
        val mal: String?,
        val anidb: String?,
        val anilist: String?,
        val traktslug: String?,
        val offen: String?,
        val letterboxd: String?,
        val tvdbslug: String?,
        val instagram: String?,
        val tw: String?,
        val fb: String?,
        val wikien: String?,
        val wikijp: String?,
    )

    data class Poster(
        val poster: String?,
        val fanart: String?,
    )

    data class ShowMetadata(
        val title: String?,
        val year: Int?,
        val ids: MediaIds?,
        val poster: String?,
        val fanart: String?,
        val type: String?,
    )

    data class SearchResult(
        val title: String?,
        val year: Int?,
        val type: String?,
        val ids: MediaIds?,
        val poster: String?,
        val url: String?,
    )

    data class EpisodeMetadata(
        val title: String?,
        val description: String?,
        val season: Int?,
        val episode: Int?,
        val type: String?,
        val aired: String?,
        val img: String?,
        val ids: MediaIds?,
    )

    /*
     * `load`, `search`, `getStatus` and `score` are deliberately not overridden.
     *
     * `SyncAPI` already answers null / false for all of them, which is the
     * honest result with no signed-in account and the branch a caller's "not
     * logged in" path already handles. Restating them here would add four
     * signatures that must track upstream's for no behavioural difference — and
     * a signature that drifts is exactly how this cluster broke the last time.
     */
}
