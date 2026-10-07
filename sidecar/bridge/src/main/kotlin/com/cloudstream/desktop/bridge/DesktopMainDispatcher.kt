package com.cloudstream.desktop.bridge

import kotlinx.coroutines.InternalCoroutinesApi
import kotlinx.coroutines.MainCoroutineDispatcher
import kotlinx.coroutines.internal.MainDispatcherFactory
import java.util.concurrent.Executors
import kotlin.coroutines.CoroutineContext

/**
 * `Dispatchers.Main` for extensions, which Android has and the JVM does not.
 *
 * On a phone `kotlinx-coroutines-android` registers the main looper as `Main`.
 * Here nothing did, so `Dispatchers.Main` threw `IllegalStateException: Module
 * with the Main dispatcher is missing` — from the first `launch(Dispatchers.Main)`
 * in StreamPlay's `load()`, which cost it every provider it was about to
 * register. Almost every use in the corpus is "run this after load" or "post
 * the result back", which needs ordering and nothing a screen provides.
 *
 * One daemon thread, so the guarantee Android code is written against holds:
 * work posted to Main runs one item at a time, in order. Code that then touches
 * a view still meets the shim's refusal, which is the honest answer; what
 * changes is that scheduling stops being the thing that fails.
 *
 * Found by coroutines through `ServiceLoader` (`META-INF/services`), from the
 * loader that owns `kotlinx-coroutines-core` — the shared runtime loader this
 * jar is on, so every extension sees the same Main.
 */
@OptIn(InternalCoroutinesApi::class)
class DesktopMainDispatcherFactory : MainDispatcherFactory {
    override val loadPriority: Int = 0

    override fun createDispatcher(allFactories: List<MainDispatcherFactory>): MainCoroutineDispatcher =
        DesktopMainDispatcher

    override fun hintOnError(): String = "the desktop runtime's Main dispatcher could not start"
}

internal object DesktopMainDispatcher : MainCoroutineDispatcher() {

    @Volatile
    private var mainThread: Thread? = null

    private val executor = Executors.newSingleThreadExecutor { task ->
        Thread(task, "cs3-main").apply {
            isDaemon = true
            mainThread = this
        }
    }

    override val immediate: MainCoroutineDispatcher = Immediate

    override fun dispatch(context: CoroutineContext, block: Runnable) {
        executor.execute(block)
    }

    override fun toString(): String = "Dispatchers.Main[cs3-main]"

    /** `Main.immediate`: runs in place when already on the main thread, as on Android. */
    private object Immediate : MainCoroutineDispatcher() {
        override val immediate: MainCoroutineDispatcher get() = this

        override fun isDispatchNeeded(context: CoroutineContext): Boolean =
            Thread.currentThread() !== mainThread

        override fun dispatch(context: CoroutineContext, block: Runnable) =
            DesktopMainDispatcher.dispatch(context, block)

        override fun toString(): String = "Dispatchers.Main.immediate[cs3-main]"
    }
}
