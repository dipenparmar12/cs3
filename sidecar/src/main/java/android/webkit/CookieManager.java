package android.webkit;

import java.net.URI;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * {@code android.webkit.CookieManager} — a working cookie jar, in memory.
 *
 * <p>Implemented rather than refused, for {@code Handler}'s reason: what the
 * corpus does with it — remember a cookie, read it back for the next request's
 * header — is plain bookkeeping the JVM does fine, and refusing it would break
 * scraping code on its first line. Cookies a WebView would have collected never
 * arrive here (no page loads, see {@link WebView}), so {@link #getCookie} for
 * a site this process never set anything on answers {@code null}, which is
 * Android's own answer for "no cookies" and the one every caller checks for.
 *
 * <p>Shared by every extension in the process, as Android's is per app. Not
 * persisted: the cookies that matter for challenges are the host's
 * ({@code CloudflareKiller}), and a jar surviving restarts would replay
 * sessions the sites have long expired.
 */
public class CookieManager {

    private static final CookieManager INSTANCE = new CookieManager();

    /** Host (or `.domain` for a Domain cookie) → name → value. */
    private final Map<String, Map<String, String>> jar = new ConcurrentHashMap<>();
    private volatile boolean accept = true;

    protected CookieManager() { }

    public static CookieManager getInstance() {
        return INSTANCE;
    }

    public void setAcceptCookie(boolean accept) { this.accept = accept; }
    public boolean acceptCookie() { return accept; }
    public void setAcceptThirdPartyCookies(WebView webview, boolean accept) { }
    public boolean acceptThirdPartyCookies(WebView webview) { return true; }

    public void setCookie(String url, String value) {
        if (!accept || url == null || value == null) return;
        String host = hostOf(url);
        if (host == null) return;
        String[] parts = value.split(";");
        String[] pair = parts[0].split("=", 2);
        String name = pair[0].trim();
        if (name.isEmpty()) return;
        String key = host;
        boolean expired = false;
        for (int i = 1; i < parts.length; i++) {
            String[] attribute = parts[i].trim().split("=", 2);
            String attr = attribute[0].trim().toLowerCase(Locale.ROOT);
            if (attr.equals("domain") && attribute.length > 1) {
                key = "." + attribute[1].trim().replaceFirst("^\\.", "").toLowerCase(Locale.ROOT);
            } else if (attr.equals("max-age") && attribute.length > 1) {
                String age = attribute[1].trim();
                expired = age.startsWith("-") || age.equals("0");
            }
        }
        Map<String, String> cookies = jar.computeIfAbsent(key, k -> new LinkedHashMap<>());
        synchronized (cookies) {
            if (expired) cookies.remove(name);
            else cookies.put(name, pair.length > 1 ? pair[1].trim() : "");
        }
    }

    public void setCookie(String url, String value, ValueCallback<Boolean> callback) {
        setCookie(url, value);
        if (callback != null) callback.onReceiveValue(accept);
    }

    /** {@code name=value; name2=value2} for the URL's host and its parent domains, or {@code null}. */
    public String getCookie(String url) {
        String host = hostOf(url);
        if (host == null) return null;
        Map<String, String> merged = new LinkedHashMap<>();
        for (Map.Entry<String, Map<String, String>> entry : jar.entrySet()) {
            String key = entry.getKey();
            boolean applies = key.equals(host)
                    || (key.startsWith(".") && (host.equals(key.substring(1)) || host.endsWith(key)));
            if (!applies) continue;
            synchronized (entry.getValue()) {
                merged.putAll(entry.getValue());
            }
        }
        if (merged.isEmpty()) return null;
        StringBuilder header = new StringBuilder();
        for (Map.Entry<String, String> cookie : merged.entrySet()) {
            if (header.length() > 0) header.append("; ");
            header.append(cookie.getKey()).append('=').append(cookie.getValue());
        }
        return header.toString();
    }

    public boolean hasCookies() { return !jar.isEmpty(); }

    public void removeAllCookies(ValueCallback<Boolean> callback) {
        boolean had = !jar.isEmpty();
        jar.clear();
        if (callback != null) callback.onReceiveValue(had);
    }

    /** Session and persistent cookies are not told apart in memory; both go. */
    public void removeSessionCookies(ValueCallback<Boolean> callback) {
        removeAllCookies(callback);
    }

    public void removeAllCookie() { jar.clear(); }
    public void removeSessionCookie() { jar.clear(); }
    public void flush() { }

    private static String hostOf(String url) {
        try {
            String host = URI.create(url.trim().contains("://") ? url.trim() : "https://" + url.trim()).getHost();
            return host == null ? null : host.toLowerCase(Locale.ROOT);
        } catch (IllegalArgumentException e) {
            return null;
        }
    }
}
