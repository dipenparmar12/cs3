package android.content;

import java.util.Map;
import java.util.Set;

/**
 * {@code android.content.SharedPreferences} shim — referenced by 112 of 392
 * surveyed plugins, with {@code Editor} referenced by 101.
 *
 * <p><b>An interface, because Android's is.</b> This was a concrete class, and
 * that is a shape mismatch the compiler cannot warn about but the JVM enforces
 * absolutely: a plugin compiled against Android emits {@code invokeinterface}
 * for every call on it, and {@code invokeinterface} against a class fails with
 *
 * <pre>
 *   IncompatibleClassChangeError: Found class android.content.SharedPreferences,
 *   but interface was expected
 * </pre>
 *
 * The error arrives at the first *use*, not at load, so an extension would
 * register its providers, answer a search, and then die the moment it tried to
 * read a setting. With 112 of the corpus touching this type, that is a large
 * class of "works until it suddenly doesn't" failures with one cause.
 *
 * {@code Editor} and {@code OnSharedPreferenceChangeListener} are nested
 * interfaces for the same reason. The implementation lives in
 * {@link JsonSharedPreferences}.
 */
public interface SharedPreferences {

    Map<String, ?> getAll();

    String getString(String key, String defValue);

    Set<String> getStringSet(String key, Set<String> defValues);

    int getInt(String key, int defValue);

    long getLong(String key, long defValue);

    float getFloat(String key, float defValue);

    boolean getBoolean(String key, boolean defValue);

    boolean contains(String key);

    Editor edit();

    void registerOnSharedPreferenceChangeListener(OnSharedPreferenceChangeListener listener);

    void unregisterOnSharedPreferenceChangeListener(OnSharedPreferenceChangeListener listener);

    /** Android's listener interface; referenced by 3 surveyed plugins. */
    interface OnSharedPreferenceChangeListener {
        void onSharedPreferenceChanged(SharedPreferences prefs, String key);
    }

    /**
     * The staged-write builder.
     *
     * Every mutator returns {@code Editor} rather than a concrete type, matching
     * Android — extensions chain these calls and the JVM resolves the chain by
     * exact descriptor.
     */
    interface Editor {
        Editor putString(String key, String value);

        Editor putStringSet(String key, Set<String> values);

        Editor putInt(String key, int value);

        Editor putLong(String key, long value);

        Editor putFloat(String key, float value);

        Editor putBoolean(String key, boolean value);

        Editor remove(String key);

        Editor clear();

        boolean commit();

        void apply();
    }
}
