package android.net;

import java.io.File;
import java.io.UnsupportedEncodingException;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * {@code android.net.Uri} shim — and unlike most of this package, a real
 * implementation rather than a type that exists only to link.
 *
 * <p>Providers use this for actual work: pulling an embed id out of a player
 * URL with {@code getQueryParameter}, checking a host before choosing an
 * extractor, rebuilding a request with {@code buildUpon}. Sixteen load failures
 * in the corpus named it, and the plugins behind them were scraping plugins, not
 * settings dialogs. Throwing here would move the failure from load time to the
 * middle of link resolution, which is worse — the provider would search fine and
 * die on play.
 *
 * <h2>Why this does not delegate to {@link java.net.URI}</h2>
 * {@code java.net.URI} is a validating parser and Android's is not.
 * {@code Uri.parse} performs no validation at all; it stores the string and
 * splits components on demand. Scraped URLs routinely carry spaces, {@code |},
 * braces and stray percent signs — every one of which makes
 * {@code new URI(...)} throw {@link java.net.URISyntaxException}. Delegating
 * would turn "this provider returns slightly untidy URLs", which Android
 * tolerates, into a hard failure the extension has no way to anticipate.
 *
 * <p>Component splitting therefore uses the RFC 3986 Appendix B expression,
 * which is total: every possible input matches, so parsing cannot fail.
 */
public class Uri implements Comparable<Uri> {

    /**
     * RFC 3986 Appendix B. Every group is optional and the trailing groups are
     * greedy-safe, so this matches any string whatsoever — which is the property
     * that makes {@link #parse} unable to throw.
     */
    private static final Pattern RFC3986 = Pattern.compile(
            "^(?:([^:/?#]+):)?(?://([^/?#]*))?([^?#]*)(?:\\?([^#]*))?(?:#(.*))?");

    /** Android exposes a shared empty instance and extensions compare against it. */
    public static final Uri EMPTY = new Uri("");

    private final String uri;
    private final String scheme;
    private final String authority;
    private final String path;
    private final String query;
    private final String fragment;

    private Uri(String uri) {
        this.uri = uri == null ? "" : uri;
        Matcher m = RFC3986.matcher(this.uri);
        // Always true — the expression is total — but the call is required
        // before group() may be read.
        boolean ignored = m.find();
        this.scheme = m.group(1);
        this.authority = m.group(2);
        this.path = m.group(3);
        this.query = m.group(4);
        this.fragment = m.group(5);
    }

    // --- factories -----------------------------------------------------------

    public static Uri parse(String uriString) {
        return new Uri(uriString);
    }

    public static Uri fromFile(File file) {
        if (file == null) return EMPTY;
        String p = file.getAbsolutePath().replace('\\', '/');
        if (!p.startsWith("/")) p = "/" + p;
        return new Uri("file://" + p);
    }

    public static Uri withAppendedPath(Uri base, String pathSegment) {
        if (base == null) return EMPTY;
        return base.buildUpon().appendEncodedPath(pathSegment).build();
    }

    // --- components ----------------------------------------------------------

    public String getScheme() {
        return scheme;
    }

    public String getAuthority() {
        return authority;
    }

    /** Host without userinfo or port, matching Android. */
    public String getHost() {
        if (authority == null) return null;
        String a = authority;
        int at = a.lastIndexOf('@');
        if (at >= 0) a = a.substring(at + 1);
        // An IPv6 literal keeps its brackets and its colons are not a port.
        if (a.startsWith("[")) {
            int close = a.indexOf(']');
            return close >= 0 ? a.substring(0, close + 1) : a;
        }
        int colon = a.indexOf(':');
        return colon >= 0 ? a.substring(0, colon) : a;
    }

    /** -1 when absent or unparseable, matching Android. */
    public int getPort() {
        if (authority == null) return -1;
        String a = authority;
        int at = a.lastIndexOf('@');
        if (at >= 0) a = a.substring(at + 1);
        int close = a.startsWith("[") ? a.indexOf(']') : -1;
        int colon = a.indexOf(':', close + 1);
        if (colon < 0) return -1;
        try {
            return Integer.parseInt(a.substring(colon + 1));
        } catch (NumberFormatException e) {
            return -1;
        }
    }

    public String getUserInfo() {
        if (authority == null) return null;
        int at = authority.lastIndexOf('@');
        return at >= 0 ? authority.substring(0, at) : null;
    }

    public String getPath() {
        return path;
    }

    public String getEncodedPath() {
        return path;
    }

    public String getQuery() {
        return query;
    }

    public String getEncodedQuery() {
        return query;
    }

    public String getFragment() {
        return fragment;
    }

    public String getEncodedFragment() {
        return fragment;
    }

    public String getSchemeSpecificPart() {
        StringBuilder sb = new StringBuilder();
        if (authority != null) sb.append("//").append(authority);
        if (path != null) sb.append(path);
        if (query != null) sb.append('?').append(query);
        return sb.toString();
    }

    public boolean isAbsolute() {
        return scheme != null;
    }

    public boolean isRelative() {
        return scheme == null;
    }

    /** Opaque when the scheme is not followed by a slash, e.g. {@code mailto:}. */
    public boolean isOpaque() {
        return scheme != null && authority == null && path != null && !path.startsWith("/");
    }

    public boolean isHierarchical() {
        return !isOpaque();
    }

    // --- path segments -------------------------------------------------------

    public List<String> getPathSegments() {
        List<String> out = new ArrayList<>();
        if (path == null || path.isEmpty()) return out;
        for (String segment : path.split("/")) {
            if (!segment.isEmpty()) out.add(decode(segment));
        }
        return out;
    }

    public String getLastPathSegment() {
        List<String> segments = getPathSegments();
        return segments.isEmpty() ? null : segments.get(segments.size() - 1);
    }

    // --- query parameters ----------------------------------------------------

    /**
     * First value for {@code key}, percent-decoded, or null.
     *
     * <p>Decodes {@code +} as a space, which {@link #decode(String)} deliberately
     * does not — that asymmetry is Android's, and providers depend on it for
     * search URLs built from form encoding.
     */
    public String getQueryParameter(String key) {
        List<String> values = getQueryParameters(key);
        return values.isEmpty() ? null : values.get(0);
    }

    public List<String> getQueryParameters(String key) {
        List<String> out = new ArrayList<>();
        if (query == null || key == null) return out;
        for (String pair : query.split("&")) {
            if (pair.isEmpty()) continue;
            int eq = pair.indexOf('=');
            String name = eq < 0 ? pair : pair.substring(0, eq);
            if (!decode(name).equals(key)) continue;
            out.add(eq < 0 ? "" : decodePlus(pair.substring(eq + 1)));
        }
        return out;
    }

    public Set<String> getQueryParameterNames() {
        Set<String> out = new LinkedHashSet<>();
        if (query == null) return out;
        for (String pair : query.split("&")) {
            if (pair.isEmpty()) continue;
            int eq = pair.indexOf('=');
            out.add(decode(eq < 0 ? pair : pair.substring(0, eq)));
        }
        return out;
    }

    public boolean getBooleanQueryParameter(String key, boolean defaultValue) {
        String value = getQueryParameter(key);
        if (value == null) return defaultValue;
        return !"false".equalsIgnoreCase(value) && !"0".equals(value);
    }

    // --- encoding ------------------------------------------------------------

    public static String encode(String s) {
        return encode(s, null);
    }

    /**
     * Percent-encodes everything outside the RFC 3986 unreserved set, minus any
     * character named in {@code allow}.
     *
     * <p>Hand-rolled rather than delegating to {@code URLEncoder}, which is
     * {@code application/x-www-form-urlencoded} and writes a space as {@code +}.
     * Inside a path segment that {@code +} is a literal plus, so a title
     * containing a space would address the wrong page.
     */
    public static String encode(String s, String allow) {
        if (s == null) return null;
        StringBuilder out = new StringBuilder(s.length());
        byte[] bytes = s.getBytes(StandardCharsets.UTF_8);
        for (byte b : bytes) {
            char c = (char) (b & 0xFF);
            boolean unreserved = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')
                    || (c >= '0' && c <= '9')
                    || c == '_' || c == '-' || c == '!' || c == '.'
                    || c == '~' || c == '\'' || c == '(' || c == ')' || c == '*';
            if (unreserved || (allow != null && allow.indexOf(c) >= 0)) {
                out.append(c);
            } else {
                out.append('%')
                        .append(Character.toUpperCase(Character.forDigit((b >> 4) & 0xF, 16)))
                        .append(Character.toUpperCase(Character.forDigit(b & 0xF, 16)));
            }
        }
        return out.toString();
    }

    /** Percent-decoding only; {@code +} is left alone, as on Android. */
    public static String decode(String s) {
        if (s == null) return null;
        if (s.indexOf('%') < 0) return s;
        // URLDecoder would also convert '+', so plus signs are hidden behind a
        // sentinel that cannot appear in a percent-encoded string.
        return decodePlus(s.replace("+", "%2B"));
    }

    private static String decodePlus(String s) {
        if (s == null) return null;
        try {
            return URLDecoder.decode(s, StandardCharsets.UTF_8.name());
        } catch (UnsupportedEncodingException | IllegalArgumentException e) {
            // A stray or truncated '%' is common in scraped URLs and Android
            // tolerates it. The raw text is a better answer than an exception.
            return s;
        }
    }

    // --- building ------------------------------------------------------------

    public Builder buildUpon() {
        return new Builder()
                .scheme(scheme)
                .encodedAuthority(authority)
                .encodedPath(path)
                .encodedQuery(query)
                .encodedFragment(fragment);
    }

    public static final class Builder {
        private String scheme;
        private String authority;
        private String path;
        private String query;
        private String fragment;

        public Builder scheme(String scheme) {
            this.scheme = scheme;
            return this;
        }

        public Builder authority(String authority) {
            this.authority = encode(authority, "@:[]");
            return this;
        }

        public Builder encodedAuthority(String authority) {
            this.authority = authority;
            return this;
        }

        public Builder path(String path) {
            this.path = path == null ? null : encode(path, "/");
            return this;
        }

        public Builder encodedPath(String path) {
            this.path = path;
            return this;
        }

        public Builder appendPath(String newSegment) {
            return appendEncodedPath(encode(newSegment));
        }

        public Builder appendEncodedPath(String newSegment) {
            if (newSegment == null || newSegment.isEmpty()) return this;
            String base = path == null ? "" : path;
            if (!base.isEmpty() && !base.endsWith("/")) base += "/";
            else if (base.isEmpty()) base = "/";
            this.path = base + (newSegment.startsWith("/") ? newSegment.substring(1) : newSegment);
            return this;
        }

        public Builder query(String query) {
            this.query = query;
            return this;
        }

        public Builder encodedQuery(String query) {
            this.query = query;
            return this;
        }

        public Builder appendQueryParameter(String key, String value) {
            String pair = encode(key) + "=" + encode(value == null ? "" : value);
            this.query = (query == null || query.isEmpty()) ? pair : query + "&" + pair;
            return this;
        }

        public Builder clearQuery() {
            this.query = null;
            return this;
        }

        public Builder fragment(String fragment) {
            this.fragment = fragment == null ? null : encode(fragment);
            return this;
        }

        public Builder encodedFragment(String fragment) {
            this.fragment = fragment;
            return this;
        }

        public Builder opaquePart(String opaquePart) {
            this.path = opaquePart;
            return this;
        }

        public Uri build() {
            StringBuilder sb = new StringBuilder();
            if (scheme != null) sb.append(scheme).append(':');
            if (authority != null) sb.append("//").append(authority);
            if (path != null) sb.append(path);
            if (query != null && !query.isEmpty()) sb.append('?').append(query);
            if (fragment != null && !fragment.isEmpty()) sb.append('#').append(fragment);
            return new Uri(sb.toString());
        }

        @Override
        public String toString() {
            return build().toString();
        }
    }

    // --- identity ------------------------------------------------------------

    @Override
    public String toString() {
        return uri;
    }

    @Override
    public boolean equals(Object other) {
        return other instanceof Uri && uri.equals(((Uri) other).uri);
    }

    @Override
    public int hashCode() {
        return uri.hashCode();
    }

    @Override
    public int compareTo(Uri other) {
        return uri.compareTo(other.uri);
    }
}
