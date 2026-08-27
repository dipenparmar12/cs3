package com.lagradost.cloudstream3

import android.app.Application
import android.content.Context
import com.lagradost.cloudstream3.utils.DataStore
import com.lagradost.cloudstream3.utils.DataStore.getKey
import com.lagradost.cloudstream3.utils.DataStore.removeKey
import com.lagradost.cloudstream3.utils.DataStore.setKey

/**
 * The older name for the same companion helpers.
 *
 * A Kotlin companion is a separate object with a separate class, and it is **not**
 * inherited: `CloudStreamApp : AcraApplication()` gives
 * `CloudStreamApp.Companion` nothing from `AcraApplication.Companion`. Archives
 * in the corpus were compiled against both names depending on their vintage, so
 * both carry the methods rather than one delegating to the other.
 *
 * The previous `setKey(String, String?)` here was present and could never be
 * called: upstream's is `fun <T> setKey(path: String, value: T)`, whose erased
 * descriptor is `(Ljava/lang/String;Ljava/lang/Object;)V`. A method that differs
 * only in a parameter type is a different method to the JVM — the same trap as
 * `getResources` returning `Object` and `AccountManager.aniListApi` typed as the
 * wrapper. See `CloudStreamApp` for the full note.
 */
open class AcraApplication : Application() {
    companion object {
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
