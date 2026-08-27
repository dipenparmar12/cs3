package com.lagradost.cloudstream3

import android.content.Context
import com.lagradost.cloudstream3.utils.DataStore
import com.lagradost.cloudstream3.utils.DataStore.getKey
import com.lagradost.cloudstream3.utils.DataStore.removeKey
import com.lagradost.cloudstream3.utils.DataStore.setKey

/**
 * Upstream's application class, and the key/value helpers hung off its companion.
 *
 * This was a bare stub carrying only `context`, and that cost CSX its flagship
 * extension. CineStream's `load()` opens with `Settings.initSeenProviders()`,
 * which calls `setKey(path, value)` — and died with:
 *
 * ```
 * NoSuchMethodError: 'void com.lagradost.cloudstream3.CloudStreamApp$Companion
 *                     .setKey(java.lang.String, java.lang.Object)'
 *   at cs3-plugin-CineStream//com.megix.settings.Settings.initSeenProviders
 *   at cs3-plugin-CineStream//com.megix.CineStream.load
 * ```
 *
 * Three things about that are worth keeping.
 *
 * **`Object`, not `String`.** Upstream declares `fun <T> setKey(path: String,
 * value: T)`; `T` erases to `Object`, so the descriptor a compiled plugin looks
 * for is `(Ljava/lang/String;Ljava/lang/Object;)V`. `AcraApplication` already had
 * a `setKey(String, String?)` — a *different method* to the JVM, present and
 * useless. This repo has now hit that trap three times (`getResources` returning
 * `Object`, `AccountManager.aniListApi` typed as the wrapper, and this).
 *
 * **A companion is not inherited.** `CloudStreamApp : AcraApplication()` does not
 * give `CloudStreamApp.Companion` the members of `AcraApplication.Companion` —
 * they are separate objects with separate classes. Whichever name an archive was
 * compiled against has to carry the method itself, so both do.
 *
 * **The store is real, not a no-op.** These are how extensions remember a chosen
 * server, a quality preference or a seen-providers list; answering `null` forever
 * makes a provider re-run first-time setup on every call, and the corpus reads
 * back what it writes. It goes through `DataStore` and therefore through the
 * plugin's own scoped `SharedPreferences`, so two extensions cannot collide and
 * nothing leaks into the host's datastore.
 */
open class CloudStreamApp : AcraApplication() {
    companion object {
        /**
         * The context these helpers read and write through.
         *
         * Set by `PluginHost` as each plugin is loaded — nothing set it before,
         * so every one of these helpers would have been a silent no-op even once
         * the descriptors matched.
         */
        @JvmStatic
        var context: Context? = null

        @JvmStatic
        fun <T> setKey(path: String, value: T) {
            runCatching { context?.setKey(path, value) }
                .onFailure { DataStore.logDataStoreFailure("setKey($path)", it) }
        }

        @JvmStatic
        fun <T> setKey(folder: String, path: String, value: T) {
            runCatching { context?.setKey(folder, path, value) }
                .onFailure { DataStore.logDataStoreFailure("setKey($folder/$path)", it) }
        }

        @JvmStatic
        fun <T : Any> getKey(path: String, valueType: Class<T>): T? =
            runCatching { context?.getKey(path, valueType) }.getOrNull()

        /**
         * The reified overloads compile into the *plugin*, not into this jar.
         *
         * `inline fun <reified T> getKey(path)` means a shipped `.cs3` carries a
         * copy of the body and calls whatever that body calls — which is the
         * `Class`-taking overload above. Declaring erased `getKey(String)` here
         * as well covers archives built against a version where it was not
         * inline. Both spellings resolve; neither guesses at a type it cannot
         * know, so an unreadable value comes back as null rather than as a cast
         * failure inside the provider.
         */
        @JvmStatic
        fun getKey(path: String): Any? =
            runCatching { context?.getKey<String>(path) }.getOrNull()

        @JvmStatic
        fun removeKey(path: String) {
            runCatching { context?.removeKey(path) }
        }

        @JvmStatic
        fun removeKey(folder: String, path: String) {
            runCatching { context?.removeKey(folder, path) }
        }

        @JvmStatic
        fun getKeys(folder: String): List<String>? =
            runCatching { context?.let { with(DataStore) { it.getKeys(folder) } } }.getOrNull()
    }
}
