package android.os;

import java.io.Serializable;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;

/**
 * {@code android.os.Bundle} — a map, and implemented as one.
 *
 * <p>Present because it appears in the descriptor of nearly every fragment
 * lifecycle method ({@code onCreate}, {@code onCreateView}, {@code onSaveInstanceState}),
 * so a plugin class that overrides any of them cannot link without it. 47 files
 * in the corpus name it directly.
 *
 * <p>Given it has to exist, backing it with a real map costs nothing and is
 * strictly better than throwing: extensions use a Bundle to pass arguments to
 * their own settings fragment, and that is ordinary data movement with no
 * Android in it. Parcelling is not implemented — nothing crosses a process
 * boundary here — so the type is {@link Serializable} rather than
 * {@code Parcelable}.
 */
public class Bundle implements Serializable {

    private static final long serialVersionUID = 1L;

    private final Map<String, Object> values = new LinkedHashMap<>();

    public Bundle() {
    }

    public Bundle(Bundle from) {
        if (from != null) values.putAll(from.values);
    }

    public void putString(String key, String value) {
        values.put(key, value);
    }

    public void putInt(String key, int value) {
        values.put(key, value);
    }

    public void putLong(String key, long value) {
        values.put(key, value);
    }

    public void putFloat(String key, float value) {
        values.put(key, value);
    }

    public void putDouble(String key, double value) {
        values.put(key, value);
    }

    public void putBoolean(String key, boolean value) {
        values.put(key, value);
    }

    public void putSerializable(String key, Serializable value) {
        values.put(key, value);
    }

    public void putStringArray(String key, String[] value) {
        values.put(key, value);
    }

    public void putBundle(String key, Bundle value) {
        values.put(key, value);
    }

    public String getString(String key) {
        return getString(key, null);
    }

    public String getString(String key, String defaultValue) {
        Object v = values.get(key);
        return v instanceof String ? (String) v : defaultValue;
    }

    public int getInt(String key) {
        return getInt(key, 0);
    }

    public int getInt(String key, int defaultValue) {
        Object v = values.get(key);
        return v instanceof Number ? ((Number) v).intValue() : defaultValue;
    }

    public long getLong(String key) {
        return getLong(key, 0L);
    }

    public long getLong(String key, long defaultValue) {
        Object v = values.get(key);
        return v instanceof Number ? ((Number) v).longValue() : defaultValue;
    }

    public float getFloat(String key) {
        return getFloat(key, 0f);
    }

    public float getFloat(String key, float defaultValue) {
        Object v = values.get(key);
        return v instanceof Number ? ((Number) v).floatValue() : defaultValue;
    }

    public double getDouble(String key) {
        return getDouble(key, 0d);
    }

    public double getDouble(String key, double defaultValue) {
        Object v = values.get(key);
        return v instanceof Number ? ((Number) v).doubleValue() : defaultValue;
    }

    public boolean getBoolean(String key) {
        return getBoolean(key, false);
    }

    public boolean getBoolean(String key, boolean defaultValue) {
        Object v = values.get(key);
        return v instanceof Boolean ? (Boolean) v : defaultValue;
    }

    public Serializable getSerializable(String key) {
        Object v = values.get(key);
        return v instanceof Serializable ? (Serializable) v : null;
    }

    public String[] getStringArray(String key) {
        Object v = values.get(key);
        return v instanceof String[] ? (String[]) v : null;
    }

    public Bundle getBundle(String key) {
        Object v = values.get(key);
        return v instanceof Bundle ? (Bundle) v : null;
    }

    public boolean containsKey(String key) {
        return values.containsKey(key);
    }

    public void remove(String key) {
        values.remove(key);
    }

    public Set<String> keySet() {
        return values.keySet();
    }

    public int size() {
        return values.size();
    }

    public boolean isEmpty() {
        return values.isEmpty();
    }

    public void clear() {
        values.clear();
    }

    public void putAll(Bundle other) {
        if (other != null) values.putAll(other.values);
    }

    @Override
    public String toString() {
        return "Bundle" + values;
    }
}
