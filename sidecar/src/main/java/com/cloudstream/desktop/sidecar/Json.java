package com.cloudstream.desktop.sidecar;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * A small, dependency-free JSON reader/writer.
 *
 * The sidecar deliberately does not use Jackson for its own protocol even though
 * Jackson is on the plugin classpath. Sharing a JSON library with untrusted
 * plugin code would couple the control channel to whatever version the provider
 * ecosystem happens to need, and a plugin able to influence Jackson's global
 * configuration could corrupt the sidecar's own framing.
 */
public final class Json {

    private Json() { }

    // --- writing -------------------------------------------------------------

    public static String write(Object value) {
        StringBuilder sb = new StringBuilder();
        writeValue(sb, value);
        return sb.toString();
    }

    @SuppressWarnings("unchecked")
    private static void writeValue(StringBuilder sb, Object v) {
        switch (v) {
            case null -> sb.append("null");
            case String s -> writeString(sb, s);
            case Boolean b -> sb.append(b);
            case Number n -> sb.append(n);
            case Map<?, ?> m -> {
                sb.append('{');
                boolean first = true;
                for (Map.Entry<?, ?> e : m.entrySet()) {
                    if (!first) sb.append(',');
                    first = false;
                    writeString(sb, String.valueOf(e.getKey()));
                    sb.append(':');
                    writeValue(sb, e.getValue());
                }
                sb.append('}');
            }
            case Iterable<?> it -> {
                sb.append('[');
                boolean first = true;
                for (Object o : it) {
                    if (!first) sb.append(',');
                    first = false;
                    writeValue(sb, o);
                }
                sb.append(']');
            }
            default -> writeString(sb, String.valueOf(v));
        }
    }

    /**
     * Appends {@code s} as a quoted, escaped JSON string.
     *
     * <p>Public because {@link HostChannel} assembles one frame by hand: its
     * {@code params} is already a JSON document, so passing the whole frame
     * through {@link #write} would escape that document into a string literal
     * and the host would receive a quoted blob instead of an object. The fields
     * around it still have to be escaped by exactly these rules.
     */
    public static void writeTo(StringBuilder sb, String s) {
        writeString(sb, s);
    }

    private static void writeString(StringBuilder sb, String s) {
        sb.append('"');
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"' -> sb.append("\\\"");
                case '\\' -> sb.append("\\\\");
                case '\n' -> sb.append("\\n");
                case '\r' -> sb.append("\\r");
                case '\t' -> sb.append("\\t");
                case '\b' -> sb.append("\\b");
                case '\f' -> sb.append("\\f");
                default -> {
                    // Control characters and lone surrogates must be escaped or the
                    // receiving JSON parser rejects the whole frame.
                    if (c < 0x20 || Character.isSurrogate(c)) {
                        sb.append(String.format("\\u%04x", (int) c));
                    } else {
                        sb.append(c);
                    }
                }
            }
        }
        sb.append('"');
    }

    // --- reading -------------------------------------------------------------

    public static Object parse(String s) {
        Parser p = new Parser(s);
        p.skipWs();
        Object v = p.value();
        p.skipWs();
        if (p.i < p.src.length()) throw new IllegalArgumentException("trailing JSON at " + p.i);
        return v;
    }

    @SuppressWarnings("unchecked")
    public static Map<String, Object> parseObject(String s) {
        Object v = parse(s);
        if (!(v instanceof Map)) throw new IllegalArgumentException("expected a JSON object");
        return (Map<String, Object>) v;
    }

    /** Reads a top-level string field without fully parsing, for manifest use. */
    public static String string(String json, String key) {
        Object v = field(json, key);
        return v instanceof String s ? s : null;
    }

    public static Integer integer(String json, String key) {
        Object v = field(json, key);
        return v instanceof Number n ? n.intValue() : null;
    }

    public static Boolean bool(String json, String key) {
        Object v = field(json, key);
        return v instanceof Boolean b ? b : null;
    }

    private static Object field(String json, String key) {
        try {
            return parseObject(json).get(key);
        } catch (RuntimeException e) {
            return null;
        }
    }

    private static final class Parser {
        private final String src;
        private int i;

        Parser(String src) { this.src = src; }

        void skipWs() {
            while (i < src.length() && Character.isWhitespace(src.charAt(i))) i++;
        }

        Object value() {
            skipWs();
            if (i >= src.length()) throw new IllegalArgumentException("unexpected end of JSON");
            char c = src.charAt(i);
            return switch (c) {
                case '{' -> object();
                case '[' -> array();
                case '"' -> string();
                case 't' -> literal("true", Boolean.TRUE);
                case 'f' -> literal("false", Boolean.FALSE);
                case 'n' -> literal("null", null);
                default -> number();
            };
        }

        Map<String, Object> object() {
            Map<String, Object> m = new LinkedHashMap<>();
            expect('{');
            skipWs();
            if (peek() == '}') { i++; return m; }
            while (true) {
                skipWs();
                String k = string();
                skipWs();
                expect(':');
                m.put(k, value());
                skipWs();
                char c = next();
                if (c == '}') return m;
                if (c != ',') throw new IllegalArgumentException("expected , or } at " + i);
            }
        }

        List<Object> array() {
            List<Object> l = new ArrayList<>();
            expect('[');
            skipWs();
            if (peek() == ']') { i++; return l; }
            while (true) {
                l.add(value());
                skipWs();
                char c = next();
                if (c == ']') return l;
                if (c != ',') throw new IllegalArgumentException("expected , or ] at " + i);
            }
        }

        String string() {
            expect('"');
            StringBuilder sb = new StringBuilder();
            while (true) {
                char c = next();
                if (c == '"') return sb.toString();
                if (c != '\\') { sb.append(c); continue; }
                char e = next();
                switch (e) {
                    case '"' -> sb.append('"');
                    case '\\' -> sb.append('\\');
                    case '/' -> sb.append('/');
                    case 'b' -> sb.append('\b');
                    case 'f' -> sb.append('\f');
                    case 'n' -> sb.append('\n');
                    case 'r' -> sb.append('\r');
                    case 't' -> sb.append('\t');
                    case 'u' -> {
                        sb.append((char) Integer.parseInt(src.substring(i, i + 4), 16));
                        i += 4;
                    }
                    default -> throw new IllegalArgumentException("bad escape \\" + e);
                }
            }
        }

        Object number() {
            int start = i;
            while (i < src.length() && "+-.eE0123456789".indexOf(src.charAt(i)) >= 0) i++;
            String t = src.substring(start, i);
            if (t.isEmpty()) throw new IllegalArgumentException("bad JSON at " + start);
            if (t.contains(".") || t.contains("e") || t.contains("E")) return Double.parseDouble(t);
            try {
                return Long.parseLong(t);
            } catch (NumberFormatException e) {
                return Double.parseDouble(t);
            }
        }

        Object literal(String word, Object v) {
            if (!src.startsWith(word, i)) throw new IllegalArgumentException("bad literal at " + i);
            i += word.length();
            return v;
        }

        char peek() { return i < src.length() ? src.charAt(i) : '\0'; }

        char next() {
            if (i >= src.length()) throw new IllegalArgumentException("unexpected end of JSON");
            return src.charAt(i++);
        }

        void expect(char c) {
            if (next() != c) throw new IllegalArgumentException("expected " + c + " at " + (i - 1));
        }
    }
}
