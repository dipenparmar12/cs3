package com.lagradost.cloudstream3

import android.app.Activity
import android.content.Context
import com.lagradost.cloudstream3.utils.UiText

/**
 * `com.lagradost.cloudstream3.CommonActivity` — an `:app` symbol in CloudStream 3.
 *
 * Provides activity context, foreground tracking, and toast notifications.
 * Extensions like `StreamingCommunity` access `CommonActivity.activity` to read
 * preferences or register UI settings.
 */
object CommonActivity {

    @JvmStatic
    var activity: Activity? = null

    @JvmStatic
    var keyIsDown: Boolean = false

    @JvmStatic
    var currentFocus: Any? = null

    @JvmStatic
    @JvmOverloads
    fun showToast(
        activity: Activity?,
        message: String,
        duration: Int = 0
    ) {
    }

    @JvmStatic
    @JvmOverloads
    fun showToast(
        activity: Activity?,
        message: UiText,
        duration: Int = 0
    ) {
    }

    @JvmStatic
    @JvmOverloads
    fun showToast(
        activity: Activity?,
        messageRes: Int,
        duration: Int = 0
    ) {
    }

    @JvmStatic
    @JvmOverloads
    fun showToast(
        message: String,
        duration: Int = 0
    ) {
        showToast(activity, message, duration)
    }

    @JvmStatic
    @JvmOverloads
    fun showToast(
        message: UiText,
        duration: Int = 0
    ) {
        showToast(activity, message, duration)
    }

    @JvmStatic
    @JvmOverloads
    fun showToast(
        messageRes: Int,
        duration: Int = 0
    ) {
        showToast(activity, messageRes, duration)
    }

    @JvmStatic
    fun canShowToast(): Boolean = true
}

fun Context?.showToast(message: String, duration: Int = 0) {
    CommonActivity.showToast(message, duration)
}

fun Context?.showToast(message: UiText, duration: Int = 0) {
    CommonActivity.showToast(message, duration)
}

fun Context?.showToast(messageRes: Int, duration: Int = 0) {
    CommonActivity.showToast(messageRes, duration)
}
