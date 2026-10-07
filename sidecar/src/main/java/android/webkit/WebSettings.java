package android.webkit;

import android.content.Context;

/**
 * {@code android.webkit.WebSettings} — a bag of flags, kept as one.
 *
 * <p>Every setter stores and every getter answers: configuring a WebView is
 * inert on Android too until a page loads, and refusing here would fail the
 * expression that builds the WebView rather than the load that cannot happen —
 * see {@link WebView} for where the refusal sits.
 *
 * <p>Concrete rather than abstract as on Android: nothing in the corpus
 * subclasses it, and the instance {@link WebView#getSettings} returns has to be
 * something.
 */
public class WebSettings {

    public static final int LOAD_DEFAULT = -1;
    public static final int LOAD_NO_CACHE = 2;
    public static final int LOAD_CACHE_ELSE_NETWORK = 1;
    public static final int MIXED_CONTENT_ALWAYS_ALLOW = 0;
    public static final int MIXED_CONTENT_NEVER_ALLOW = 1;
    public static final int MIXED_CONTENT_COMPATIBILITY_MODE = 2;

    /**
     * A current desktop Chrome string. The pages a provider's WebView would load
     * are loaded, on desktop, by the host's Chromium ({@code webViewHost.ts}), so
     * a Chrome identity describes what is really there; an Android WebView one
     * would claim a platform this is not.
     */
    static final String DEFAULT_USER_AGENT =
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
                    + "Chrome/140.0.0.0 Safari/537.36";

    private String userAgent = DEFAULT_USER_AGENT;
    private boolean javaScriptEnabled;
    private boolean domStorageEnabled;
    private boolean databaseEnabled;
    private boolean loadsImagesAutomatically = true;
    private boolean blockNetworkImage;
    private int cacheMode = LOAD_DEFAULT;
    private int mixedContentMode = MIXED_CONTENT_NEVER_ALLOW;

    public static String getDefaultUserAgent(Context context) {
        return DEFAULT_USER_AGENT;
    }

    public String getUserAgentString() { return userAgent; }
    public void setUserAgentString(String ua) { userAgent = ua == null ? DEFAULT_USER_AGENT : ua; }
    public boolean getJavaScriptEnabled() { return javaScriptEnabled; }
    public void setJavaScriptEnabled(boolean flag) { javaScriptEnabled = flag; }
    public boolean getDomStorageEnabled() { return domStorageEnabled; }
    public void setDomStorageEnabled(boolean flag) { domStorageEnabled = flag; }
    public boolean getDatabaseEnabled() { return databaseEnabled; }
    public void setDatabaseEnabled(boolean flag) { databaseEnabled = flag; }
    public boolean getLoadsImagesAutomatically() { return loadsImagesAutomatically; }
    public void setLoadsImagesAutomatically(boolean flag) { loadsImagesAutomatically = flag; }
    public boolean getBlockNetworkImage() { return blockNetworkImage; }
    public void setBlockNetworkImage(boolean flag) { blockNetworkImage = flag; }
    public int getCacheMode() { return cacheMode; }
    public void setCacheMode(int mode) { cacheMode = mode; }
    public int getMixedContentMode() { return mixedContentMode; }
    public void setMixedContentMode(int mode) { mixedContentMode = mode; }

    // Presentation flags: accepted, and meaningless without a surface.
    public void setAllowContentAccess(boolean allow) { }
    public void setAllowFileAccess(boolean allow) { }
    public void setMediaPlaybackRequiresUserGesture(boolean require) { }
    public void setBuiltInZoomControls(boolean enabled) { }
    public void setDisplayZoomControls(boolean enabled) { }
    public void setSupportZoom(boolean support) { }
    public void setLoadWithOverviewMode(boolean overview) { }
    public void setUseWideViewPort(boolean use) { }
    public void setJavaScriptCanOpenWindowsAutomatically(boolean flag) { }
    public void setSupportMultipleWindows(boolean support) { }
}
