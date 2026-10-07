package android.widget;

import android.content.Context;
import android.view.ViewGroup;

/**
 * {@code android.widget.FrameLayout} — part of the UI closure, so the classes
 * that build a settings screen around one can load. Behaves as every view in
 * the shim does: the type exists, the layout operations refuse (see
 * {@code android.view.View}). Counted: AniSnatch, BingeCloud, MovieLinkBDProvider.
 */
public class FrameLayout extends ViewGroup {

    public FrameLayout(Context context) {
        super(context);
    }

    public static class LayoutParams extends ViewGroup.MarginLayoutParams {
        /** {@code Gravity} constants; -1 is Android's "unspecified". */
        public int gravity = -1;

        public LayoutParams(int width, int height) {
            super(width, height);
        }

        public LayoutParams(int width, int height, int gravity) {
            super(width, height);
            this.gravity = gravity;
        }

        public LayoutParams(ViewGroup.LayoutParams source) {
            super(source);
        }
    }
}
