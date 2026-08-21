package com.lagradost.cloudstream3

import android.app.Application
import android.content.Context

/**
 * Stub for CloudStream's ACRA application base class.
 */
open class AcraApplication : Application() {
    companion object {
        @JvmStatic
        var context: Context? = null

        @JvmStatic
        fun getKey(key: String): String? = null

        @JvmStatic
        fun setKey(key: String, value: String?) {}
    }
}
