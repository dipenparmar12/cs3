package com.lagradost.cloudstream3

import android.app.Activity
import android.content.Context
import com.lagradost.cloudstream3.utils.UiText

/**
 * `com.lagradost.cloudstream3.CommonActivity` — an `:app` symbol in CloudStream 3.
 *
 * Provides activity context, foreground tracking, and toast notifications.
 * In upstream CloudStream, this is a standard Kotlin singleton object with instance methods.
 * Extensions like `StreamingCommunity` access `CommonActivity.activity` (via `CommonActivity.INSTANCE.getActivity()`)
 * to read preferences or register UI settings.
 */
object CommonActivity {

    var activity: Activity? = null

    var keyIsDown: Boolean = false

    var currentFocus: Any? = null

    fun showToast(
        activity: Activity?,
        message: String,
        duration: Int = 0
    ) {
    }

    fun showToast(
        activity: Activity?,
        message: UiText,
        duration: Int = 0
    ) {
    }

    fun showToast(
        activity: Activity?,
        messageRes: Int,
        duration: Int = 0
    ) {
    }

    fun showToast(
        message: String,
        duration: Int = 0
    ) {
        showToast(activity, message, duration)
    }

    fun showToast(
        message: UiText,
        duration: Int = 0
    ) {
        showToast(activity, message, duration)
    }

    fun showToast(
        messageRes: Int,
        duration: Int = 0
    ) {
        showToast(activity, messageRes, duration)
    }

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
