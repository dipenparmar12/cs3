package android.widget;

import android.content.Context;
import android.view.ViewGroup;

/**
 * {@code android.widget.LinearLayout} — part of the UI closure, for the same
 * reason as {@link FrameLayout}: an extension's settings screen and its scraper
 * ship in one archive, so the layout has to resolve for the scraper to load.
 * Layout operations refuse, as every view in the shim does. Counted: BingeCloud,
 * which failed at {@code load()} on this class once {@code GradientDrawable}
 * existed.
 */
public class LinearLayout extends ViewGroup {

    public static final int HORIZONTAL = 0;
    public static final int VERTICAL = 1;

    private int orientation = HORIZONTAL;

    public LinearLayout(Context context) {
        super(context);
    }

    /** Stored, not acted on: it describes a layout nothing will draw. */
    public void setOrientation(int orientation) {
        this.orientation = orientation;
    }

    public int getOrientation() {
        return orientation;
    }

    public static class LayoutParams extends ViewGroup.MarginLayoutParams {
        public float weight;
        /** {@code Gravity} constants; -1 is Android's "unspecified". */
        public int gravity = -1;

        public LayoutParams(int width, int height) {
            super(width, height);
        }

        public LayoutParams(int width, int height, float weight) {
            super(width, height);
            this.weight = weight;
        }

        public LayoutParams(ViewGroup.LayoutParams source) {
            super(source);
        }
    }
}
