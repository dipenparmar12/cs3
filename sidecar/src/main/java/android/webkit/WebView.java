package android.webkit;

import android.content.Context;
import android.content.UnsupportedAndroidApiException;
import android.os.Handler;
import android.view.MotionEvent;
import android.view.ViewGroup;

/**
 * {@code android.webkit.WebView} — present so extensions that carry a WebView
 * fallback can load; refused at the one point that needs a browser.
 *
 * <p><b>Counted first.</b> On a 468-archive install five extensions failed at
 * {@code load()} on {@code NoClassDefFoundError: android/webkit/WebView} —
 * StreamPlay, AniSnatch, FullPorner, BingeCloud, MovieLinkBDProvider — and lost
 * every provider they register, though in each the WebView is a fallback path
 * beside ordinary HTTP scraping.
 *
 * <p><b>Where the refusal sits.</b> Constructing a WebView, configuring its
 * settings and attaching clients are inert on Android until a page loads, so
 * they are accepted here. Loading a page or running script throws
 * {@link UnsupportedAndroidApiException}: there is no browser behind this
 * object, and a load that silently did nothing would leave the extension
 * waiting for an {@code onPageFinished} that never comes — a hang where a
 * failure belongs. Clean-up ({@link #destroy}, {@link #stopLoading}, …) never
 * throws, because it runs in {@code finally} blocks on the error path.
 *
 * <p>The pages providers need a real browser for are already handled by the
 * host's {@code WebViewResolver} and {@code CloudflareKiller}
 * ({@code webViewHost.ts}); this class does not try to be a second route there.
 */
public class WebView extends ViewGroup {

    private final Context context;
    private final WebSettings settings = new WebSettings();

    public WebView(Context context) {
        super(context);
        this.context = context;
    }

    public static void setWebContentsDebuggingEnabled(boolean enabled) { }

    @Override
    public Context getContext() { return context; }

    public WebSettings getSettings() { return settings; }

    public void setWebViewClient(WebViewClient client) { }
    public void setWebChromeClient(WebChromeClient client) { }
    public void addJavascriptInterface(Object object, String name) { }
    public void removeJavascriptInterface(String name) { }

    public void loadUrl(String url) { throw refusal("loadUrl"); }
    public void loadUrl(String url, java.util.Map<String, String> additionalHttpHeaders) { throw refusal("loadUrl"); }
    public void loadData(String data, String mimeType, String encoding) { throw refusal("loadData"); }
    public void loadDataWithBaseURL(String baseUrl, String data, String mimeType, String encoding, String historyUrl) {
        throw refusal("loadDataWithBaseURL");
    }
    public void postUrl(String url, byte[] postData) { throw refusal("postUrl"); }
    public void evaluateJavascript(String script, ValueCallback<String> resultCallback) {
        throw refusal("evaluateJavascript");
    }
    public void reload() { throw refusal("reload"); }

    public String getUrl() { return null; }
    public String getTitle() { return null; }
    public boolean canGoBack() { return false; }
    public void goBack() { }

    public void stopLoading() { }
    public void destroy() { }
    public void clearHistory() { }
    public void clearCache(boolean includeDiskFiles) { }
    public void onPause() { }
    public void onResume() { }
    public void pauseTimers() { }
    public void resumeTimers() { }
    @Override public void removeAllViews() { }
    @Override public void invalidate() { }
    @Override public void setBackgroundColor(int color) { }
    /** Android's answer for a view attached to no window. */
    @Override public Handler getHandler() { return null; }
    @Override public boolean dispatchTouchEvent(MotionEvent event) { return false; }

    private static UnsupportedAndroidApiException refusal(String method) {
        return new UnsupportedAndroidApiException("android.webkit.WebView." + method,
                "There is no embedded browser behind an extension's WebView on desktop; "
                        + "this provider's WebView path cannot run, its HTTP scraping still does.");
    }
}
