package com.lagradost.cloudstream3.ui.settings

import android.content.Context

/**
 * `com.lagradost.cloudstream3.ui.settings.Globals` — an `:app` type, supplied
 * here for the same reason `Plugin`, `DataStore` and `CloudflareKiller` are.
 *
 * The largest remaining load failure in the CNC Verse repository once the
 * `android.widget` and `Intent` gaps closed: nine of eighteen. Extensions reach
 * it to ask which layout they are running under, almost always as
 * `isLayout(TV)` guarding a branch that builds a different settings screen.
 *
 * Written in Kotlin, in the bridge, rather than as a Java stub, because the
 * binary shape has to match what an extension was compiled against. Upstream
 * declares it as an `object` with a *member extension function*
 * (`fun Context.updateTv()`), and both of those are Kotlin encodings — an
 * `INSTANCE` field and a method taking the receiver as its first parameter.
 * A Java class with static methods of the same names would compile fine here
 * and link against nothing there.
 *
 * ## The answer this gives, and why
 *
 * `PHONE`. Upstream picks between three layouts by reading a stored preference
 * and, failing that, sniffing for a television. Desktop is a windowed
 * application driven by a mouse and keyboard, which is the phone/touch layout's
 * set of assumptions and emphatically not the 10-foot one — a TV layout would
 * have extensions build focus-driven, D-pad-navigable screens for a pointer.
 *
 * Note `layoutId` is deliberately a real field rather than a constant return:
 * `isLayout` is documented upstream as taking a *flag set* (`isLayout(TV or
 * EMULATOR)`), so the bitwise test has to work, not just the equality case.
 */
object Globals {
    /** Upstream's easter-egg counter. Present because extensions can read it. */
    var beneneCount = 0

    const val PHONE: Int = 0b001
    const val TV: Int = 0b010
    const val EMULATOR: Int = 0b100

    private var layoutId: Int = PHONE

    /**
     * Upstream re-derives the layout from preferences and hardware. There is
     * nothing here to re-derive it from, and the answer would not change.
     */
    @Suppress("UnusedReceiverParameter")
    fun Context.updateTv() {
        layoutId = PHONE
    }

    /** The desktop player window is landscape, and so is the app's own layout. */
    fun isLandscape(): Boolean = true

    fun isLayout(flags: Int): Boolean = (layoutId and flags) != 0
}
