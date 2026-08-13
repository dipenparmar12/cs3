package com.lagradost.cloudstream3.plugins

import android.content.Context
import android.content.res.Resources

/**
 * The class every Android CloudStream extension extends — supplied here,
 * because upstream does not publish it anywhere a desktop build can reach.
 *
 * This is the single point that blocked the entire community ecosystem.
 * `library-jvm`, the only artifact the provider API is published through,
 * contains [BasePlugin] but not `Plugin`: `Plugin` lives in CloudStream's
 * Android *app* module, which is not published at all. Community `.cs3`
 * archives are compiled against it, so every one of them failed to load with
 *
 *     NoClassDefFoundError: com/lagradost/cloudstream3/plugins/Plugin
 *
 * before its code was ever reached. Translation, analysis and classification
 * all succeeded; the class simply was not there to link against.
 *
 * It is deliberately a faithful copy of the upstream shape rather than a
 * reinterpretation. Extensions are compiled against the real signatures, and
 * the JVM resolves methods by exact descriptor — a `load` taking anything other
 * than `android.content.Context` is not an override, it is an unrelated method
 * that never gets called, and the extension would load successfully while
 * registering no providers at all. That failure is silent, which makes it far
 * worse than the one it replaces.
 *
 * Lives in the bridge module for one reason: this jar is loaded by the same
 * class loader that owns `library-jvm.jar`, so the [BasePlugin] this extends is
 * the same Class object the plugin's own superclass resolves to. Loaded
 * anywhere else it would be a different type with the same name, and every
 * extension would fail a cast instead of a lookup.
 *
 * **Not implemented: `registerVideoClickAction`.** Its parameter type pulls in
 * `UiText`, `ResultEpisode`, `LinkLoadingResult` and `Activity` — the Android
 * player UI, which has no desktop counterpart. An extension calling it gets a
 * `NoSuchMethodError` at that line rather than at class load, so its providers
 * still register and its search still works. Stubbing the type would not
 * improve on that: constructing the extension's own subclass would fail on the
 * same missing UI types one frame later.
 */
abstract class Plugin : BasePlugin() {

    /**
     * Called when the plugin is loaded.
     *
     * Defaults to the cross-platform [BasePlugin.load], exactly as upstream
     * does, so an extension that overrides only the no-argument form still runs.
     */
    @Throws(Throwable::class)
    open fun load(context: Context) {
        load()
    }

    /**
     * Populated on Android for extensions built with `requiresResources`.
     *
     * Left null here. The accessors on the desktop [Resources] stub all throw,
     * so an extension that genuinely needs its resource table fails where it
     * uses it, naming the reason — rather than silently rendering wrong text.
     */
    var resources: Resources? = null

    /**
     * Set by extensions that contribute a settings screen.
     *
     * Held but never invoked: there is no host UI to surface it in yet. Keeping
     * the field means assigning to it still links, which is all most extensions
     * do with it during `load`.
     */
    var openSettings: ((context: Context) -> Unit)? = null
}
