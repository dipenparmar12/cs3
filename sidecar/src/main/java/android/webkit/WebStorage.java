package android.webkit;

/** {@code android.webkit.WebStorage} — a WebView's storage; with no page ever loaded there is nothing in it. */
public class WebStorage {

    private static final WebStorage INSTANCE = new WebStorage();

    protected WebStorage() { }

    public static WebStorage getInstance() {
        return INSTANCE;
    }

    public void deleteAllData() { }
    public void deleteOrigin(String origin) { }
}
