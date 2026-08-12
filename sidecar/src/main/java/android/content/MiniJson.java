package android.content;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Minimal JSON used to persist {@link SharedPreferences}.
 *
 * The shim ships as a standalone jar on the plugin classpath, so it deliberately
 * carries no dependencies — not on the sidecar's own JSON helper, which plugin
 * code must not be able to reach, and not on Jackson or Gson, which plugins also
 * load and could reconfigure.
 */
final class MiniJson {

    private MiniJson() { }

    static String write(Object v) {
        StringBuilder sb = new StringBuilder();
        writeValue(sb, v);
        return sb.toString();
    }

    private static void writeValue(StringBuilder sb, Object v) {
        if (v == null) { sb.append("null"); return; }
        if (v instanceof String s) { writeString(sb, s); return; }
        if (v instanceof Boolean || v instanceof Number) { sb.append(v); return; }
        if (v instanceof Map<?, ?> m) {
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
            return;
        }
        if (v instanceof Iterable<?> it) {
            sb.append('[');
            boolean first = true;
            for (Object o : it) {
                if (!first) sb.append(',');
                first = false;
                writeValue(sb, o);
            }
            sb.append(']');
            return;
        }
        writeString(sb, String.valueOf(v));
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
                default -> {
                    if (c < 0x20) sb.append(String.format("\\u%04x", (int) c));
                    else sb.append(c);
                }
            }
        }
        sb.append('"');
    }

    static Object parse(String s) {
        int[] pos = {0};
        Object v = parseValue(s, pos);
        return v;
    }

    private static Object parseValue(String s, int[] p) {
        skipWs(s, p);
        char c = s.charAt(p[0]);
        return switch (c) {
            case '{' -> parseObject(s, p);
            case '[' -> parseArray(s, p);
            case '"' -> parseString(s, p);
            case 't' -> { p[0] += 4; yield Boolean.TRUE; }
            case 'f' -> { p[0] += 5; yield Boolean.FALSE; }
            case 'n' -> { p[0] += 4; yield null; }
            default -> parseNumber(s, p);
        };
    }

    private static Map<String, Object> parseObject(String s, int[] p) {
        Map<String, Object> m = new LinkedHashMap<>();
        p[0]++; // '{'
        skipWs(s, p);
        if (s.charAt(p[0]) == '}') { p[0]++; return m; }
        while (true) {
            skipWs(s, p);
            String k = parseString(s, p);
            skipWs(s, p);
            p[0]++; // ':'
            m.put(k, parseValue(s, p));
            skipWs(s, p);
            char c = s.charAt(p[0]++);
            if (c == '}') return m;
            if (c != ',') throw new IllegalArgumentException("bad object at " + p[0]);
        }
    }

    private static List<Object> parseArray(String s, int[] p) {
        List<Object> l = new ArrayList<>();
        p[0]++; // '['
        skipWs(s, p);
        if (s.charAt(p[0]) == ']') { p[0]++; return l; }
        while (true) {
            l.add(parseValue(s, p));
            skipWs(s, p);
            char c = s.charAt(p[0]++);
            if (c == ']') return l;
            if (c != ',') throw new IllegalArgumentException("bad array at " + p[0]);
        }
    }

    private static String parseString(String s, int[] p) {
        if (s.charAt(p[0]) != '"') throw new IllegalArgumentException("expected string at " + p[0]);
        p[0]++;
        StringBuilder sb = new StringBuilder();
        while (true) {
            char c = s.charAt(p[0]++);
            if (c == '"') return sb.toString();
            if (c != '\\') { sb.append(c); continue; }
            char e = s.charAt(p[0]++);
            switch (e) {
                case 'n' -> sb.append('\n');
                case 'r' -> sb.append('\r');
                case 't' -> sb.append('\t');
                case 'b' -> sb.append('\b');
                case 'f' -> sb.append('\f');
                case 'u' -> { sb.append((char) Integer.parseInt(s.substring(p[0], p[0] + 4), 16)); p[0] += 4; }
                default -> sb.append(e);
            }
        }
    }

    private static Object parseNumber(String s, int[] p) {
        int start = p[0];
        while (p[0] < s.length() && "+-.eE0123456789".indexOf(s.charAt(p[0])) >= 0) p[0]++;
        String t = s.substring(start, p[0]);
        if (t.contains(".") || t.contains("e") || t.contains("E")) return Double.parseDouble(t);
        return Long.parseLong(t);
    }

    private static void skipWs(String s, int[] p) {
        while (p[0] < s.length() && Character.isWhitespace(s.charAt(p[0]))) p[0]++;
    }
}
