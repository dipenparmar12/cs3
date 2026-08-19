package com.lagradost.cloudstream3.plugins

import android.content.Context
import com.lagradost.cloudstream3.ui.settings.extensions.RepositoryData
import java.io.File

/**
 * The extension-management API, as Android extensions expect to reach it.
 *
 * More `:app` types upstream does not publish, found the way [Plugin] was — by
 * an entire repository failing to load. Kraptor123/cs-kraptor (65 plugins) died
 * during `load` with a chain of them, one per rebuild:
 *
 *     NoClassDefFoundError: com/lagradost/cloudstream3/plugins/PluginData
 *     NoClassDefFoundError: android/content/pm/PackageManager
 *     NoClassDefFoundError: com/lagradost/cloudstream3/ui/settings/extensions/RepositoryData
 *
 * Every shape here was read out of the bytecode that referenced it, not guessed:
 * `getPluginsLocal()[Lcom/…/PluginData;`,
 * `deletePlugin(Ljava/io/File;Lkotlin/coroutines/Continuation;)Ljava/lang/Object;`
 * and so on. The JVM resolves by exact descriptor, so a near-miss links as an
 * unrelated method that is never called — a silent failure, which is worse than
 * the loud one it replaces.
 *
 * **Every inventory is empty and every mutation is a no-op, deliberately.** What
 * this extension actually does with these is enumerate the host's installed
 * plugins and repositories in order to *delete* some of them (`cleanupPlugins`).
 * On Android that is a plugin tidying its own siblings. Here the inventory
 * belongs to `PluginManager` in the Electron main process, which owns the
 * install paths, the translation cache keyed by archive hash, and the datastore
 * records — an extension reaching in could only corrupt state whose rules it
 * cannot see. Empty inventories mean the cleanup loop iterates nothing and the
 * destructive calls are never reached, so the plugin loads, registers its
 * providers, and searches normally.
 *
 * Lives in the bridge module for the same loader reason as [Plugin].
 *
 * Members get added when a real extension is observed to need one, never
 * speculatively: a method that exists but misbehaves is worse than one that is
 * absent, because absence fails loudly at link time.
 */
object PluginManager {

    /** Extensions installed from a repository. Empty by design; see above. */
    fun getPluginsOnline(): Array<PluginData> = emptyArray()

    /** Extensions sideloaded from local files. Empty by design; see above. */
    fun getPluginsLocal(): Array<PluginData> = emptyArray()

    /** Loaded plugin instances, keyed by file path upstream. Empty by design. */
    fun getPlugins(): MutableMap<String, Any> = mutableMapOf()

    /**
     * Deletes an installed extension. Refused.
     *
     * Returns false rather than throwing: this is reached only from cleanup
     * paths that treat failure as "nothing to remove", and an exception there
     * would abort a `load` that has no other problem.
     */
    @Suppress("UNUSED_PARAMETER", "RedundantSuspendModifier")
    suspend fun deletePlugin(file: File): Boolean = false
}

/**
 * Repository registration, the other half of the same surface.
 *
 * Referenced as `RepositoryManager.INSTANCE.getRepositories()` and
 * `.removeRepository(Context, RepositoryData, Continuation)`.
 */
object RepositoryManager {

    /** Installed repositories. Empty by design; see [PluginManager]. */
    fun getRepositories(): Array<RepositoryData> = emptyArray()

    /** Unregisters a repository. Refused, for the reasons in [PluginManager]. */
    @Suppress("UNUSED_PARAMETER", "RedundantSuspendModifier")
    suspend fun removeRepository(context: Context, repository: RepositoryData) {
        // No-op: the repository list belongs to the host.
    }
}

/**
 * One installed extension, in upstream's shape.
 *
 * Field-for-field with `PluginData` in CloudStream's app module — the same five
 * properties the desktop app's own `PluginData` in `src/types/plugin.ts` was
 * modelled on. Nullability matters: `url` is `String?` upstream, which is what
 * makes the accessor `getUrl()Ljava/lang/String;`, and extensions null-check it.
 */
data class PluginData(
    val internalName: String,
    val url: String?,
    val isOnline: Boolean,
    val filePath: String,
    val version: Int,
)
