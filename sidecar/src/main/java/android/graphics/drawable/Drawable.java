package android.graphics.drawable;

import android.content.UnsupportedAndroidApiException;

/**
 * {@code android.graphics.drawable.Drawable} — eight of eighteen load failures
 * in the CNC Verse repository, and the class that surfaced once
 * {@link android.widget.CheckBox} stopped being the first one to fail.
 *
 * <p>Deliberately <em>not</em> abstract, and deliberately without
 * {@code draw(Canvas)}. Android's is abstract with four abstract members, and
 * declaring them here would drag {@code Canvas}, {@code ColorFilter} and
 * {@code PixelFormat} into the shim to satisfy signatures nothing in this
 * corpus calls. Every counted occurrence uses {@code Drawable} as a *type* — an
 * icon field, a {@code getDrawable()} return — never as a base class to extend.
 *
 * <p>If an extension ever does subclass it, its own {@code draw(Canvas)}
 * override will fail to resolve {@code Canvas} and show up in the next count,
 * which is the right way to learn that rather than by pre-building a graphics
 * stack nobody asked for.
 */
public class Drawable {

    public Drawable() {
    }

    public void setAlpha(int alpha) {
        throw new UnsupportedAndroidApiException("android.graphics.drawable.Drawable.setAlpha");
    }

    public int getIntrinsicWidth() {
        return -1;
    }

    public int getIntrinsicHeight() {
        return -1;
    }

    public void setBounds(int left, int top, int right, int bottom) {
        throw new UnsupportedAndroidApiException("android.graphics.drawable.Drawable.setBounds");
    }

    public Drawable mutate() {
        return this;
    }
}
