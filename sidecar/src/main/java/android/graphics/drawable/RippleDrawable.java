package android.graphics.drawable;

import android.content.res.ColorStateList;

/**
 * {@code android.graphics.drawable.RippleDrawable} — an inert value, like
 * {@link GradientDrawable}: extensions build one for a button background in
 * settings code that shares an archive with their scraper, and constructing it
 * needs no platform. Drawing would; nothing here draws. Counted: BingeCloud.
 */
public class RippleDrawable extends Drawable {

    private ColorStateList color;
    private final Drawable content;
    private final Drawable mask;

    public RippleDrawable(ColorStateList color, Drawable content, Drawable mask) {
        this.color = color;
        this.content = content;
        this.mask = mask;
    }

    public void setColor(ColorStateList color) {
        this.color = color;
    }

    public ColorStateList getColor() {
        return color;
    }

    public Drawable getContent() {
        return content;
    }

    public Drawable getMask() {
        return mask;
    }
}
