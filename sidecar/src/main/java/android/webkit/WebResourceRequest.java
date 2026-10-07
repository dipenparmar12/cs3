package android.webkit;

import android.net.Uri;

import java.util.Map;

/** {@code android.webkit.WebResourceRequest} — Android's interface, as {@link WebViewClient} overrides name it. */
public interface WebResourceRequest {
    Uri getUrl();
    boolean isForMainFrame();
    boolean isRedirect();
    boolean hasGesture();
    String getMethod();
    Map<String, String> getRequestHeaders();
}
