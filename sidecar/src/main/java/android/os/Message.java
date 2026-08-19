package android.os;

/**
 * What a {@link Handler} carries.
 *
 * Android exposes these as public fields, and plugin code reads {@code what}
 * and {@code obj} directly — so they are fields here too, with the same names.
 * Accessors would compile against a different descriptor and fail at the call
 * site with {@code NoSuchFieldError}.
 */
public final class Message {

    public int what;
    public int arg1;
    public int arg2;
    public Object obj;

    /** Set by {@code Handler.post}; dispatched in preference to handleMessage. */
    Runnable callback;

    public static Message obtain() {
        return new Message();
    }

    public static Message obtain(Handler h, int what) {
        Message m = new Message();
        m.what = what;
        return m;
    }

    /** Pooling is Android's allocation optimisation; there is nothing to reuse. */
    public void recycle() { }

    public void sendToTarget() { }

    @Override
    public String toString() {
        return "Message(what=" + what + ")";
    }
}
