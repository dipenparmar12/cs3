package com.lagradost.cloudstream3.syncproviders.providers

import com.lagradost.cloudstream3.syncproviders.SyncAPI
import com.lagradost.cloudstream3.syncproviders.SyncIdName

/**
 * AniList, present for its **data classes** rather than its account features.
 *
 * The nested types here are what anime extensions deserialise AniList's
 * GraphQL replies into. `AniListApi$CoverImage` was already noted as an
 * outstanding gap reached by Anichi during `loadLinks`, and the same cluster
 * turns up in StreamPlay and TorraStream — three unrelated archives, one cause,
 * which is the signal that a type is worth supplying rather than working
 * around.
 *
 * Property names and types are upstream's exactly. These are Jackson binding
 * targets reached through `parseJson`, and `jackson-module-kotlin` binds by
 * constructor parameter name: a renamed property does not fail, it binds to
 * null, and the resulting "AniList returned no artwork" is close to
 * untraceable. Nullability is reproduced for the same reason — AniList omits
 * fields freely and a non-null Kotlin property throws on a missing one.
 *
 * The annotations upstream carries (`@JsonProperty`, `@SerialName`) are
 * deliberately absent: every name below is already identical to the wire name,
 * so they would add a kotlinx-serialization compiler plugin dependency to this
 * module and change nothing about how the classes bind.
 *
 * Network calls are not reproduced. An extension that reaches AniList directly
 * does so with its own HTTP client, which works; one that asks *this* to fetch
 * gets the null it would get from an unconnected account.
 */
class AniListApi : SyncAPI() {

    override val name = "AniList"
    override val mainUrl = "https://anilist.co"
    override val syncIdName = SyncIdName.Anilist
    override val icon: Int? = null
    override val requiresLogin = true
    override val createAccountUrl = "$mainUrl/signup"

    data class CoverImage(
        val medium: String?,
        val large: String?,
        val extraLarge: String?,
    )

    data class MediaCoverImage(
        val extraLarge: String?,
        val large: String?,
        val medium: String?,
        val color: String?,
    )

    data class MediaTitle(
        val romaji: String?,
        val english: String?,
        val native: String?,
        val userPreferred: String?,
    )

    data class Title(
        val english: String?,
        val romaji: String?,
    )

    data class Recommendation(
        val mediaRecommendation: RecommendedMedia?,
    )

    data class RecommendationConnection(
        val edges: List<RecommendationEdge> = emptyList(),
        val nodes: List<Recommendation> = emptyList(),
    )

    data class RecommendationEdge(
        val node: Recommendation,
    )

    data class RecommendedMedia(
        val id: Int?,
        val title: MediaTitle?,
        val coverImage: MediaCoverImage?,
    )

    data class SeasonNextAiringEpisode(
        val episode: Int?,
        val timeUntilAiring: Int?,
    )

    data class LikePageInfo(
        val total: Int?,
        val currentPage: Int?,
        val lastPage: Int?,
        val perPage: Int?,
        val hasNextPage: Boolean?,
    )

    /**
     * AniList ids are numeric and appear at the end of `/anime/12345/slug`, so
     * the last path segment is not reliably the id. Taking the first run of
     * digits matches upstream's behaviour and is what makes a URL captured from
     * a scraped page resolve.
     */
    override fun getIdFromUrl(url: String): String =
        Regex("""/anime/(\d+)""").find(url)?.groupValues?.get(1)
            ?: url.filter { it.isDigit() }
}
