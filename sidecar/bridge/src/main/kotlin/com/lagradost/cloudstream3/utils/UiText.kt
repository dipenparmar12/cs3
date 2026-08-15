package com.lagradost.cloudstream3.utils

/**
 * Android's "a string, or a string resource id" wrapper.
 *
 * An `:app` type, reached from desktop because it is the declared type of
 * `SyncAPI.LibraryList.name` — so an extension that merely *mentions* a library
 * list needs `UiText` to resolve or the enclosing method fails verification.
 *
 * The resource half cannot work here: there are no Android resources to look
 * an id up in. `asString` therefore answers with the literal text when there is
 * one and a stable placeholder when the value was a resource id, which is
 * honest and keeps string concatenation in plugin code from producing "null".
 */
sealed class UiText {

    abstract fun asString(context: Any? = null): String

    data class DynamicText(val value: String) : UiText() {
        override fun asString(context: Any?): String = value
        override fun toString(): String = value
    }

    /**
     * A reference into `res/values/strings.xml`, which desktop does not have.
     *
     * Reported as the id rather than pretended away: a caller that prints this
     * gets something traceable back to the extension's own resources instead of
     * an empty string that looks like a scraping bug.
     */
    data class StringResource(val resId: Int, val args: List<Any> = emptyList()) : UiText() {
        override fun asString(context: Any?): String = "@string/$resId"
        override fun toString(): String = asString()
    }

    companion object {
        @JvmStatic
        fun of(value: String): UiText = DynamicText(value)
    }
}

/** Upstream's extension constructor, used as `"Trending".toUiText()`. */
fun String.toUiText(): UiText = UiText.DynamicText(this)

fun Int.toUiText(vararg args: Any): UiText = UiText.StringResource(this, args.toList())

/**
 * How a synced library may be ordered.
 *
 * Named in `SyncAPI.LibraryMetadata.supportedListSorting`, which is why it has
 * to exist. The entries are upstream's; nothing here acts on them.
 */
enum class ListSorting {
    Query,
    RatingHigh,
    RatingLow,
    UpdatedNew,
    UpdatedOld,
    AlphabeticalA,
    AlphabeticalZ,
    ReleaseDateNew,
    ReleaseDateOld,
}

/**
 * Watch state as the sync services model it.
 *
 * `internalId` is the wire value upstream sends to MAL and AniList, so the
 * numbering is not arbitrary and is reproduced rather than renumbered.
 */
enum class SyncWatchType(val internalId: Int) {
    WATCHING(0),
    COMPLETED(1),
    ONHOLD(2),
    DROPPED(3),
    PLANTOWATCH(4),
    REWATCHING(5),
    NONE(-1);

    companion object {
        @JvmStatic
        fun fromInternalId(id: Int?): SyncWatchType =
            entries.firstOrNull { it.internalId == id } ?: NONE
    }
}
