package android.content.res;

/**
 * {@code android.content.res.ColorStateList} — a value object: colours keyed by
 * view state. Implemented rather than refused because building one touches no
 * platform at all; extensions construct them for a {@code RippleDrawable} in
 * settings code that shares an archive with their scraper. Counted: BingeCloud.
 */
public class ColorStateList {

    private final int[][] states;
    private final int[] colors;

    public ColorStateList(int[][] states, int[] colors) {
        this.states = states;
        this.colors = colors;
    }

    public static ColorStateList valueOf(int color) {
        return new ColorStateList(new int[][] {new int[0]}, new int[] {color});
    }

    public int getDefaultColor() {
        return colors.length > 0 ? colors[colors.length - 1] : 0;
    }

    /** The first entry whose states are all present, as Android matches. */
    public int getColorForState(int[] stateSet, int defaultColor) {
        for (int i = 0; i < states.length; i++) {
            if (containsAll(stateSet, states[i])) return colors[i];
        }
        return defaultColor;
    }

    public boolean isStateful() {
        return states.length > 1 || (states.length == 1 && states[0].length > 0);
    }

    /** A positive state must be present; a negative one must be absent. */
    private static boolean containsAll(int[] haystack, int[] needles) {
        for (int needle : needles) {
            boolean present = stateSet(haystack, Math.abs(needle));
            if (needle > 0 ? !present : present) return false;
        }
        return true;
    }

    private static boolean stateSet(int[] set, int state) {
        if (set == null) return false;
        for (int s : set) if (s == state) return true;
        return false;
    }
}
