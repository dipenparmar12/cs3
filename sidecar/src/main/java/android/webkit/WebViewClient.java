package android.webkit;

/**
 * {@code android.webkit.WebViewClient} — subclassed by extensions to hear about
 * page loads. Every callback is Android's default (do nothing, intercept
 * nothing), so a subclass's {@code super} calls resolve; with no page ever
 * loading on desktop ({@link WebView}), none of them is invoked by the host.
 */
public class WebViewClient {

    public WebViewClient() { }

    public void onPageFinished(WebView view, String url) { }
    public void onLoadResource(WebView view, String url) { }
    public boolean shouldOverrideUrlLoading(WebView view, String url) { return false; }
    public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) { return false; }
    public WebResourceResponse shouldInterceptRequest(WebView view, String url) { return null; }
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) { return null; }
    public void onReceivedError(WebView view, int errorCode, String description, String failingUrl) { }
    public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) { }
}
