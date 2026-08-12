package android.util;

import java.nio.charset.StandardCharsets;

/**
 * {@code android.util.Base64} shim — referenced by 50 of 392 surveyed plugins.
 *
 * Android's Base64 differs from {@code java.util.Base64} in ways providers rely
 * on, so the flag semantics are reproduced rather than approximated:
 *
 * <ul>
 *   <li>{@link #DEFAULT} wraps encoded output at 76 characters. Providers that
 *       feed the result into a URL depend on {@link #NO_WRAP} suppressing that,
 *       and get visibly wrong output if wrapping is silently dropped.</li>
 *   <li>Decoding is lenient: unpadded input, embedded whitespace and both the
 *       standard and URL-safe alphabets are all accepted, matching Android.
 *       {@code java.util.Base64}'s strict decoder rejects input that works on
 *       Android, which would fail the plugin rather than the payload.</li>
 * </ul>
 */
public final class Base64 {

    public static final int DEFAULT = 0;
    public static final int NO_PADDING = 1;
    public static final int NO_WRAP = 2;
    public static final int CRLF = 4;
    public static final int URL_SAFE = 8;
    public static final int NO_CLOSE = 16;

    private static final String STD = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    private static final String URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

    private Base64() { }

    public static byte[] encode(byte[] input, int flags) {
        return encodeToString(input, flags).getBytes(StandardCharsets.US_ASCII);
    }

    public static byte[] encode(byte[] input, int offset, int len, int flags) {
        byte[] slice = new byte[len];
        System.arraycopy(input, offset, slice, 0, len);
        return encode(slice, flags);
    }

    public static String encodeToString(byte[] input, int flags) {
        if (input == null) return null;
        String alphabet = (flags & URL_SAFE) != 0 ? URL : STD;
        boolean pad = (flags & NO_PADDING) == 0;

        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < input.length; i += 3) {
            int remaining = input.length - i;
            int b0 = input[i] & 0xff;
            int b1 = remaining > 1 ? input[i + 1] & 0xff : 0;
            int b2 = remaining > 2 ? input[i + 2] & 0xff : 0;
            int triple = (b0 << 16) | (b1 << 8) | b2;

            sb.append(alphabet.charAt((triple >>> 18) & 0x3f));
            sb.append(alphabet.charAt((triple >>> 12) & 0x3f));
            if (remaining > 1) sb.append(alphabet.charAt((triple >>> 6) & 0x3f));
            else if (pad) sb.append('=');
            if (remaining > 2) sb.append(alphabet.charAt(triple & 0x3f));
            else if (pad) sb.append('=');
        }

        if ((flags & NO_WRAP) != 0) return sb.toString();

        String sep = (flags & CRLF) != 0 ? "\r\n" : "\n";
        StringBuilder wrapped = new StringBuilder();
        for (int i = 0; i < sb.length(); i += 76) {
            wrapped.append(sb, i, Math.min(i + 76, sb.length())).append(sep);
        }
        return wrapped.toString();
    }

    public static String encodeToString(byte[] input, int offset, int len, int flags) {
        byte[] slice = new byte[len];
        System.arraycopy(input, offset, slice, 0, len);
        return encodeToString(slice, flags);
    }

    public static byte[] decode(String str, int flags) {
        return str == null ? null : decode(str.getBytes(StandardCharsets.US_ASCII), flags);
    }

    public static byte[] decode(byte[] input, int flags) {
        return decode(input, 0, input.length, flags);
    }

    public static byte[] decode(byte[] input, int offset, int len, int flags) {
        if (input == null) return null;

        int[] lookup = new int[128];
        java.util.Arrays.fill(lookup, -1);
        // Both alphabets are accepted regardless of the URL_SAFE flag: '-'/'_'
        // and '+'/'/' never collide, and Android's decoder is equally tolerant.
        for (int i = 0; i < 64; i++) lookup[STD.charAt(i)] = i;
        lookup['-'] = 62;
        lookup['_'] = 63;

        java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
        int buffer = 0;
        int bits = 0;
        for (int i = offset; i < offset + len; i++) {
            char c = (char) (input[i] & 0xff);
            if (c == '=') break;
            if (c >= 128) continue;
            int v = lookup[c];
            if (v < 0) continue; // whitespace, newlines, stray characters
            buffer = (buffer << 6) | v;
            bits += 6;
            if (bits >= 8) {
                bits -= 8;
                out.write((buffer >>> bits) & 0xff);
            }
        }
        return out.toByteArray();
    }
}
