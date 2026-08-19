package android.view;

import android.content.Context;
import android.content.UnsupportedAndroidApiException;

/**
 * {@code android.view.ViewGroup} — present for the same linking reason as
 * {@link View}: it is the container parameter of {@code onCreateView}, so a
 * fragment subclass cannot be defined without it.
 *
 * <p>{@link LayoutParams} is nested and must stay nested. Extensions write
 * {@code ViewGroup.LayoutParams(MATCH_PARENT, WRAP_CONTENT)} constantly, and a
 * top-level class of that name resolves to a different type.
 */
public class ViewGroup extends View {

    public ViewGroup() {
        super();
    }

    public ViewGroup(Context context) {
        super(context);
    }

    public static class LayoutParams {
        public static final int MATCH_PARENT = -1;
        public static final int WRAP_CONTENT = -2;
        /** Pre-API-8 spelling; still present in older extension code. */
        public static final int FILL_PARENT = -1;

        public int width;
        public int height;

        public LayoutParams() {
        }

        public LayoutParams(int width, int height) {
            this.width = width;
            this.height = height;
        }

        public LayoutParams(LayoutParams source) {
            if (source != null) {
                this.width = source.width;
                this.height = source.height;
            }
        }
    }

    public static class MarginLayoutParams extends LayoutParams {
        public int leftMargin;
        public int topMargin;
        public int rightMargin;
        public int bottomMargin;

        public MarginLayoutParams() {
            super();
        }

        public MarginLayoutParams(int width, int height) {
            super(width, height);
        }

        public MarginLayoutParams(LayoutParams source) {
            super(source);
        }

        public void setMargins(int left, int top, int right, int bottom) {
            this.leftMargin = left;
            this.topMargin = top;
            this.rightMargin = right;
            this.bottomMargin = bottom;
        }
    }

    public void addView(View child) {
        throw new UnsupportedAndroidApiException("android.view.ViewGroup.addView");
    }

    public void addView(View child, LayoutParams params) {
        throw new UnsupportedAndroidApiException("android.view.ViewGroup.addView");
    }

    public void addView(View child, int index) {
        throw new UnsupportedAndroidApiException("android.view.ViewGroup.addView");
    }

    public void removeView(View child) {
        throw new UnsupportedAndroidApiException("android.view.ViewGroup.removeView");
    }

    public void removeAllViews() {
        throw new UnsupportedAndroidApiException("android.view.ViewGroup.removeAllViews");
    }

    public int getChildCount() {
        throw new UnsupportedAndroidApiException("android.view.ViewGroup.getChildCount");
    }

    public View getChildAt(int index) {
        throw new UnsupportedAndroidApiException("android.view.ViewGroup.getChildAt");
    }

    public void setLayoutParams(LayoutParams params) {
        throw new UnsupportedAndroidApiException("android.view.ViewGroup.setLayoutParams");
    }

    public LayoutParams getLayoutParams() {
        throw new UnsupportedAndroidApiException("android.view.ViewGroup.getLayoutParams");
    }
}
