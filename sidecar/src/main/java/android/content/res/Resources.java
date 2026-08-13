package android.content.res;

import android.content.UnsupportedAndroidApiException;

/**
 * Stub for {@code android.content.res.Resources}.
 *
 * Exists because {@code Plugin} declares a {@code resources} field of this type.
 * A plugin that only carries providers never touches it, but the field's type
 * has to resolve for the class to link at all — so its absence blocked every
 * extension, including the overwhelming majority that have no resources.
 *
 * Every accessor throws. A plugin built with {@code requiresResources} is
 * shipping an Android resource table (layouts, drawables, string arrays) that
 * has no meaning on desktop, and there is no honest value to return for it.
 * Failing loudly at the point of use names the real limitation; returning a
 * placeholder string would surface as mysteriously wrong UI text instead.
 */
public class Resources {

    private static UnsupportedAndroidApiException unsupported(String member) {
        return new UnsupportedAndroidApiException(
                "Resources." + member + " is not available on desktop. This extension ships an "
                        + "Android resource table, which has no desktop equivalent.");
    }

    public String getString(int id) {
        throw unsupported("getString");
    }

    public String getString(int id, Object... formatArgs) {
        throw unsupported("getString");
    }

    public String[] getStringArray(int id) {
        throw unsupported("getStringArray");
    }

    public int getIdentifier(String name, String defType, String defPackage) {
        // Documented to return 0 for "no such resource", which is a truthful
        // answer here and lets a caller that checks take its own fallback.
        return 0;
    }

    public int getColor(int id) {
        throw unsupported("getColor");
    }

    public int getInteger(int id) {
        throw unsupported("getInteger");
    }

    public boolean getBoolean(int id) {
        throw unsupported("getBoolean");
    }
}
