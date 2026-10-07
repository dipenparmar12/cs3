package android.webkit;

/**
 * {@code android.webkit.ValueCallback} — the callback {@link WebView#evaluateJavascript}
 * and {@link CookieManager} answer through. Implemented by extension code, so the
 * shape is Android's exactly: one generic method, erased to {@code Object}.
 */
public interface ValueCallback<T> {
    void onReceiveValue(T value);
}
