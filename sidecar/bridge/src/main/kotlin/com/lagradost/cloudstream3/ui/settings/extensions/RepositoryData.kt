package com.lagradost.cloudstream3.ui.settings.extensions

/**
 * One registered extension repository, in upstream's shape.
 *
 * Lives under `ui.settings.extensions` because that is where CloudStream's app
 * module puts it, and the package is part of the name an extension links
 * against. It is a plain data holder despite the `ui` package — nothing here
 * touches Android UI, which is why it can be supplied at all.
 *
 * Referenced by extensions through
 * `RepositoryManager.getRepositories(): Array<RepositoryData>` and read via
 * `getName()`/`getUrl()`. See `PluginManager.kt` for why the inventory those
 * come from is deliberately empty.
 */
data class RepositoryData(
    val name: String,
    val url: String,
)
