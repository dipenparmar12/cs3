package com.lagradost.cloudstream3.utils

import android.content.Context
import android.content.SharedPreferences
import com.lagradost.cloudstream3.utils.AppUtils.parseJson
import com.lagradost.cloudstream3.utils.AppUtils.toJsonLiteral

/**
 * `com.lagradost.cloudstream3.utils.DataStore` — the single largest cause of
 * extension load failure in the corpus: **48** of 113 recorded failures named
 * it, more than twice the next.
 *
 * Same category as [com.lagradost.cloudstream3.plugins.Plugin]: an `:app` type
 * that `library-jvm` does not publish. The name looks like library code and sits
 * in a package full of library code — `utils/` in `library-jvm-4.8.0.jar`
 * contains `AppUtils`, `Coroutines` and `ExtractorApi` but not this — which is
 * why it was not caught alongside the other `:app` types.
 *
 * ## Why this had to be a faithful reimplementation
 *
 * Most of upstream's `DataStore` is `inline fun … reified`, so its body is
 * compiled *into the extension* rather than called. A shipped `.cs3` therefore
 * does not call `getKey` at all — it carries a copy of `getKey`'s body, which
 * calls `getSharedPrefs(context)` and `AppUtils.parseJson`. Those two have to
 * exist with exactly the descriptors the extension was compiled against, and
 * nothing else about this class matters to an inlined call site.
 *
 * That constrains the shape absolutely. This is an `object` with extension
 * functions on `Context` because upstream's is: Kotlin compiles
 * `object DataStore { fun Context.getSharedPrefs() }` to an `INSTANCE` field
 * plus a virtual method taking the receiver as its first argument, and an
 * extension's bytecode reads exactly that. A top-level function, a class with
 * statics, or a differently-ordered parameter list would all compile here and
 * link against nothing there.
 *
 * ## What it stores
 *
 * Both preference roots resolve to the plugin's own scoped storage, via the
 * `Context` shim. On Android they are two different files — the app's default
 * `PreferenceManager` store and CloudStream's own `rebuild_preference` — and
 * that distinction is preserved rather than collapsed, because an extension that
 * writes a setting through one root and reads it through the other is relying on
 * them being separate. Neither reaches the host's datastore: extension settings
 * are the extension's, and DROP-12 keeps them scoped.
 *
 * **`PreferenceDelegate` is not implemented.** It reaches `CloudStreamApp`, the
 * Android application singleton, which has no desktop counterpart. No plugin in
 * the 392-archive corpus references it, so supplying a broken one would add a
 * type that can only mislead.
 */

/** Used to display metadata about downloads and resume watching */
const val DOWNLOAD_HEADER_CACHE = "download_header_cache"
const val DOWNLOAD_HEADER_CACHE_BACKUP = "BACKUP_download_header_cache"
const val DOWNLOAD_EPISODE_CACHE = "download_episode_cache"
const val DOWNLOAD_EPISODE_CACHE_BACKUP = "BACKUP_download_episode_cache"
const val VIDEO_PLAYER_BRIGHTNESS = "video_player_alpha_key"
const val USER_SELECTED_HOMEPAGE_API = "home_api_used"
const val USER_PROVIDER_API = "user_custom_sites"
const val PREFERENCES_NAME = "rebuild_preference"

/**
 * Android's default `PreferenceManager` file name is `<package>_preferences`.
 * Reproduced literally so the two roots stay distinct, as they are on Android.
 */
private const val DEFAULT_PREFERENCES_NAME = "com.lagradost.cloudstream3.desktop_preferences"

/**
 * Batched writer, matching upstream's shape exactly — a `data class` wrapping a
 * [SharedPreferences.Editor], with `setKeyRaw` and `apply`.
 *
 * Upstream calls `System.gc()` in `apply()` to reclaim the string churn from
 * writing thousands of keys on a phone. That is omitted here: it is a
 * whole-JVM stop-the-world pause triggered by whichever extension happens to
 * save a setting, and the sidecar is shared by every other extension in the
 * process.
 */
data class Editor(
    val editor: SharedPreferences.Editor
) {
    /** Always remember to call apply after */
    fun <T> setKeyRaw(path: String, value: T) {
        @Suppress("UNCHECKED_CAST")
        if (isStringSet(value)) {
            editor.putStringSet(path, value as Set<String>)
        } else {
            when (value) {
                is Boolean -> editor.putBoolean(path, value)
                is Int -> editor.putInt(path, value)
                is String -> editor.putString(path, value)
                is Float -> editor.putFloat(path, value)
                is Long -> editor.putLong(path, value)
            }
        }
    }

    private fun isStringSet(value: Any?): Boolean {
        if (value is Set<*>) {
            return value.filterIsInstance<String>().size == value.size
        }
        return false
    }

    fun apply() {
        editor.apply()
    }
}

object DataStore {

    private fun getPreferences(context: Context): SharedPreferences {
        return context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)
    }

    fun Context.getSharedPrefs(): SharedPreferences {
        return getPreferences(this)
    }

    fun Context.getDefaultSharedPrefs(): SharedPreferences {
        return getSharedPreferences(DEFAULT_PREFERENCES_NAME, Context.MODE_PRIVATE)
    }

    fun getFolderName(folder: String, path: String): String {
        return "${folder}/${path}"
    }

    fun editor(context: Context, isEditingAppSettings: Boolean = false): Editor {
        val editor: SharedPreferences.Editor =
            if (isEditingAppSettings) context.getDefaultSharedPrefs().edit()
            else context.getSharedPrefs().edit()
        return Editor(editor)
    }

    fun Context.getKeys(folder: String): List<String> {
        // Ensure that the folder ends with "/" to prevent matching with other folders
        val fixedFolder = folder.trimEnd('/') + "/"
        return this.getSharedPrefs().all.keys.filter { it.startsWith(fixedFolder) }
    }

    fun Context.removeKey(folder: String, path: String) {
        removeKey(getFolderName(folder, path))
    }

    fun Context.containsKey(folder: String, path: String): Boolean {
        return containsKey(getFolderName(folder, path))
    }

    fun Context.containsKey(path: String): Boolean {
        return getSharedPrefs().contains(path)
    }

    fun Context.removeKey(path: String) {
        try {
            val prefs = getSharedPrefs()
            if (prefs.contains(path)) {
                prefs.edit().remove(path).apply()
            }
        } catch (t: Throwable) {
            // Upstream swallows this through logError. A settings write that
            // fails must not propagate into a provider's scrape path.
            logDataStoreFailure("removeKey($path)", t)
        }
    }

    fun Context.removeKeys(folder: String): Int {
        val keys = getKeys("$folder/")
        return try {
            val editor = getSharedPrefs().edit()
            keys.forEach { value -> editor.remove(value) }
            editor.apply()
            keys.size
        } catch (t: Throwable) {
            logDataStoreFailure("removeKeys($folder)", t)
            0
        }
    }

    fun <T> Context.setKey(path: String, value: T) {
        try {
            getSharedPrefs().edit().putString(path, value?.toJsonLiteral()).apply()
        } catch (t: Throwable) {
            logDataStoreFailure("setKey($path)", t)
        }
    }

    fun <T> Context.setKey(folder: String, path: String, value: T) {
        setKey(getFolderName(folder, path), value)
    }

    fun <T : Any> Context.getKey(path: String, valueType: Class<T>): T? {
        return try {
            val json: String = getSharedPrefs().getString(path, null) ?: return null
            parseJson(json, valueType.kotlin)
        } catch (_: Throwable) {
            null
        }
    }

    /**
     * The reified overloads are `inline`, so an extension compiled against
     * upstream carries its own copy of each body and never calls these. They are
     * declared anyway for the extension that reaches `DataStore` reflectively
     * or was built against a non-inlined build.
     */
    inline fun <reified T : Any> Context.getKey(path: String, defVal: T?): T? {
        return try {
            val json: String = getSharedPrefs().getString(path, null) ?: return defVal
            parseJson<T>(json)
        } catch (_: Throwable) {
            null
        }
    }

    inline fun <reified T : Any> Context.getKey(path: String): T? {
        return getKey(path, null)
    }

    inline fun <reified T : Any> Context.getKey(folder: String, path: String): T? {
        return getKey(getFolderName(folder, path), null)
    }

    inline fun <reified T : Any> Context.getKey(folder: String, path: String, defVal: T?): T? {
        return getKey(getFolderName(folder, path), defVal) ?: defVal
    }

    fun <T : Any> String.toKotlinObject(valueType: Class<T>): T {
        return parseJson(this, valueType.kotlin)
    }

    /**
     * stdout carries RPC frames and nothing else, so this goes to stderr like
     * every other diagnostic the plugin side produces.
     */
    fun logDataStoreFailure(operation: String, t: Throwable) {
        System.err.println("[cs3-sidecar] DataStore.$operation failed: $t")
    }
}
