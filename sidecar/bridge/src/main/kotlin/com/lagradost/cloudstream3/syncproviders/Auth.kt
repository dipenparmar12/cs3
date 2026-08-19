package com.lagradost.cloudstream3.syncproviders

/**
 * The account-and-login half of CloudStream's sync surface.
 *
 * `:app` types, supplied here for the same loader reason as
 * [com.lagradost.cloudstream3.plugins.Plugin]: the jar must be loaded by the
 * loader that owns `library-jvm.jar` or the `SyncAPI` an extension resolves is
 * a different Class object from the one this module declares.
 *
 * Found by TorraStream and StreamPlay, both of which died at `load()` with
 * `NoClassDefFoundError: com/lagradost/cloudstream3/syncproviders/SyncRepo`
 * before running a line. The type is reachable from an ordinary anime scraper
 * because AniList is where anime providers get canonical titles, artwork and
 * episode counts — it is metadata plumbing, not an account feature, which is
 * why it turns up in extensions that have nothing to do with syncing.
 *
 * ## The split that matters here
 *
 * **Data classes are faithful; behaviour is refused.** The data classes are
 * deserialisation targets — a plugin calls `parseJson<AuthUser>(body)` and
 * Jackson binds by constructor parameter name, so a renamed or reordered
 * property produces a silent null rather than an error. Every name and type
 * below was read from upstream.
 *
 * The *operations* are a different matter. There is no signed-in account in
 * this app, no token store, and no OAuth redirect to catch; an extension asking
 * to log the user in is asking the host for something the host does not have.
 * Those answer null or false — the same answers upstream gives for a service
 * the user has not connected — so the calling code takes its "not logged in"
 * branch instead of failing.
 */

/** Where an OAuth flow should send the browser. */
data class AuthLoginPage(
    val url: String,
    val payload: String? = null,
)

data class AuthToken(
    val accessToken: String? = null,
    val refreshToken: String? = null,
    val accessTokenLifetime: Long? = null,
    val refreshTokenLifetime: Long? = null,
    val payload: String? = null,
)

data class AuthUser(
    val name: String?,
    val id: Int,
    val profilePicture: String? = null,
    val profilePictureHeaders: Map<String, String>? = null,
)

data class AuthData(
    val user: AuthUser,
    val token: AuthToken,
)

data class AuthPinData(
    val deviceCode: String,
    val userCode: String,
    val verificationUrl: String,
    val expiresIn: Int,
    val interval: Int,
)

data class AuthLoginRequirement(
    val password: Boolean = false,
    val username: Boolean = false,
    val email: Boolean = false,
    val server: Boolean = false,
)

data class AuthLoginResponse(
    val password: String?,
    val username: String?,
    val email: String?,
    val server: String?,
)

/**
 * Base of every account-backed service.
 *
 * Abstract upstream and abstract here — a plugin subclassing it (rare, but the
 * corpus does contain custom sync providers) must find the same shape.
 */
abstract class AuthAPI {

    /**
     * Nested upstream, and referenced by that name, so it stays nested. A
     * top-level `LoginInfo` would compile here and resolve against nothing
     * there.
     */
    data class LoginInfo(
        val profilePicture: String? = null,
        val name: String?,
        val accountIndex: Int,
    )

    abstract val name: String
    open val idPrefix: String get() = name.lowercase()
    open val icon: Int? get() = null
    open val requiresLogin: Boolean get() = true
    open val createAccountUrl: String? get() = null

    open val hasOAuth2: Boolean get() = false
    open val hasPin: Boolean get() = false
    open val hasInApp: Boolean get() = false
    open val inAppLoginRequirement: AuthLoginRequirement? get() = null

    /**
     * False, and this is the load-bearing answer.
     *
     * Every well-behaved caller checks availability before reaching for an
     * account, so reporting the truth here is what keeps a plugin on its
     * offline path rather than sending it into a login flow that cannot
     * complete.
     */
    open val isAvailable: Boolean get() = false

    open fun isValidRedirectUrl(url: String): Boolean = false

    open suspend fun login(form: AuthLoginResponse): AuthData? = null

    open suspend fun login(payload: AuthPinData): AuthData? = null

    open suspend fun login(token: AuthToken): AuthData? = null

    open suspend fun loginRequest(): AuthLoginPage? = null

    open suspend fun pinRequest(): AuthPinData? = null

    open suspend fun refreshToken(token: AuthToken): AuthToken? = null

    open suspend fun user(token: AuthToken?): AuthUser? = null

    open fun logout(user: AuthUser?) { }
}

/**
 * The repository wrapper the app hands to UI and to plugins.
 *
 * Upstream this caches tokens and mediates account switching. Here it is a thin
 * pass-through whose only job is to exist with the right supertype, because
 * [SyncRepo] extends it and a missing link in that chain fails exactly as
 * loudly as a missing leaf.
 */
abstract class AuthRepo(open val api: AuthAPI) {

    val name: String get() = api.name
    val idPrefix: String get() = api.idPrefix
    val icon: Int? get() = api.icon
    val requiresLogin: Boolean get() = api.requiresLogin
    val createAccountUrl: String? get() = api.createAccountUrl

    val hasOAuth2: Boolean get() = api.hasOAuth2
    val hasPin: Boolean get() = api.hasPin
    val hasInApp: Boolean get() = api.hasInApp
    val inAppLoginRequirement: AuthLoginRequirement? get() = api.inAppLoginRequirement

    /** No accounts exist on desktop, so every account query is empty. */
    open val isAvailable: Boolean get() = false
    open val accounts: List<AuthData> get() = emptyList()

    open var accountId: Int? = null

    fun isValidRedirectUrl(url: String): Boolean = api.isValidRedirectUrl(url)

    open suspend fun freshAuth(): AuthData? = null
    open fun authData(): AuthData? = null
    open fun authToken(): AuthToken? = null
    open fun authUser(): AuthUser? = null

    open suspend fun pinRequest(): AuthPinData? = null

    /** Opening a browser for an account the app cannot store would mislead. */
    open suspend fun openOAuth2Page(): Boolean = false
    open suspend fun openOAuth2PageWithToast() { }

    open suspend fun setupLogin(token: AuthToken): Boolean = false
    open suspend fun login(form: AuthLoginResponse): Boolean = false
    open suspend fun login(payload: AuthPinData): Boolean = false
    open suspend fun login(redirectUrl: String): Boolean = false

    open fun logout(from: AuthUser) { }
    open fun refreshUser(newAuth: AuthData) { }
}
