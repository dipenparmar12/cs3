package android.webkit;

/** {@code android.webkit.WebResourceError} — Android's abstract shape, as {@link WebViewClient#onReceivedError} names it. */
public abstract class WebResourceError {
    public abstract int getErrorCode();
    public abstract CharSequence getDescription();
}
