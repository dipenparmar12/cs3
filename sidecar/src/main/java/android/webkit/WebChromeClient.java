package android.webkit;

/** {@code android.webkit.WebChromeClient} — callbacks with Android's do-nothing defaults. See {@link WebView}. */
public class WebChromeClient {

    public WebChromeClient() { }

    public void onProgressChanged(WebView view, int newProgress) { }
    public void onReceivedTitle(WebView view, String title) { }
}
