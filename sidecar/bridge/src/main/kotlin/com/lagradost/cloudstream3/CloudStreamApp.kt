package com.lagradost.cloudstream3

import android.content.Context

/**
 * Stub for CloudStream's Android application class.
 */
open class CloudStreamApp : AcraApplication() {
    companion object {
        @JvmStatic
        var context: Context? = null
    }
}
