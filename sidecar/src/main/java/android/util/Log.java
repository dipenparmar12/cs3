package android.util;

/**
 * {@code android.util.Log} shim — referenced by 91 of 392 surveyed plugins.
 *
 * Output is written to stderr with the plugin tag preserved. The sidecar's
 * stdout carries the JSON-RPC frames, so anything a plugin logs must go to
 * stderr or it corrupts the control channel.
 */
public final class Log {

    public static final int VERBOSE = 2;
    public static final int DEBUG = 3;
    public static final int INFO = 4;
    public static final int WARN = 5;
    public static final int ERROR = 6;
    public static final int ASSERT = 7;

    private Log() { }

    public static int v(String tag, String msg) { return emit("V", tag, msg, null); }
    public static int v(String tag, String msg, Throwable tr) { return emit("V", tag, msg, tr); }
    public static int d(String tag, String msg) { return emit("D", tag, msg, null); }
    public static int d(String tag, String msg, Throwable tr) { return emit("D", tag, msg, tr); }
    public static int i(String tag, String msg) { return emit("I", tag, msg, null); }
    public static int i(String tag, String msg, Throwable tr) { return emit("I", tag, msg, tr); }
    public static int w(String tag, String msg) { return emit("W", tag, msg, null); }
    public static int w(String tag, String msg, Throwable tr) { return emit("W", tag, msg, tr); }
    public static int w(String tag, Throwable tr) { return emit("W", tag, "", tr); }
    public static int e(String tag, String msg) { return emit("E", tag, msg, null); }
    public static int e(String tag, String msg, Throwable tr) { return emit("E", tag, msg, tr); }
    public static int wtf(String tag, String msg) { return emit("A", tag, msg, null); }
    public static int wtf(String tag, String msg, Throwable tr) { return emit("A", tag, msg, tr); }

    public static boolean isLoggable(String tag, int level) {
        return true;
    }

    public static String getStackTraceString(Throwable tr) {
        if (tr == null) return "";
        java.io.StringWriter sw = new java.io.StringWriter();
        tr.printStackTrace(new java.io.PrintWriter(sw));
        return sw.toString();
    }

    public static int println(int priority, String tag, String msg) {
        return emit(String.valueOf(priority), tag, msg, null);
    }

    private static int emit(String level, String tag, String msg, Throwable tr) {
        String line = "[plugin " + level + "/" + tag + "] " + msg;
        System.err.println(line);
        if (tr != null) tr.printStackTrace(System.err);
        return line.length();
    }
}
