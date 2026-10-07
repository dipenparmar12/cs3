package android.graphics.drawable;

/**
 * {@code android.graphics.drawable.GradientDrawable} — a shape description,
 * kept as one.
 *
 * <p>Built by extension settings screens (a rounded button, a gradient
 * header), and named in classes the provider half of the same archive needs to
 * load. Like {@code Intent} and {@code AlertDialog.Builder}, building one
 * touches no platform on Android either, so every setter stores and nothing
 * throws; drawing it would need a {@code View}, and that is where the shim
 * refuses. Counted: BingeCloud, MovieLinkBDProvider, StreamPlay and AniSnatch
 * reference it.
 */
public class GradientDrawable extends Drawable {

    public static final int RECTANGLE = 0;
    public static final int OVAL = 1;
    public static final int LINE = 2;
    public static final int RING = 3;
    public static final int LINEAR_GRADIENT = 0;
    public static final int RADIAL_GRADIENT = 1;
    public static final int SWEEP_GRADIENT = 2;

    public enum Orientation {
        TOP_BOTTOM, TR_BL, RIGHT_LEFT, BR_TL, BOTTOM_TOP, BL_TR, LEFT_RIGHT, TL_BR
    }

    private Orientation orientation = Orientation.TOP_BOTTOM;
    private int[] colors;
    private int color;
    private int shape = RECTANGLE;
    private int gradientType = LINEAR_GRADIENT;
    private float cornerRadius;
    private float[] cornerRadii;
    private int strokeWidth;
    private int strokeColor;
    private int alpha = 255;

    public GradientDrawable() { }

    public GradientDrawable(Orientation orientation, int[] colors) {
        this.orientation = orientation;
        this.colors = colors;
    }

    public void setColor(int argb) { color = argb; }
    public void setColors(int[] colors) { this.colors = colors; }
    public int[] getColors() { return colors; }
    public void setOrientation(Orientation orientation) { this.orientation = orientation; }
    public Orientation getOrientation() { return orientation; }
    public void setShape(int shape) { this.shape = shape; }
    public int getShape() { return shape; }
    public void setGradientType(int gradient) { gradientType = gradient; }
    public int getGradientType() { return gradientType; }
    public void setCornerRadius(float radius) { cornerRadius = radius; }
    public float getCornerRadius() { return cornerRadius; }
    public void setCornerRadii(float[] radii) { cornerRadii = radii; }
    public float[] getCornerRadii() { return cornerRadii; }
    public void setStroke(int width, int color) {
        strokeWidth = width;
        strokeColor = color;
    }
    public void setSize(int width, int height) { }

    /** Stored, unlike {@link Drawable#setAlpha}: the value is part of the description. */
    @Override
    public void setAlpha(int alpha) { this.alpha = alpha; }
    public int getAlpha() { return alpha; }
}
