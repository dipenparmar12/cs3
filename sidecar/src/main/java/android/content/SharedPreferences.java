package android.content;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;

/**
 * {@code android.content.SharedPreferences} shim — referenced by 112 of 392
 * surveyed plugins, with {@code Editor} referenced by 101.
 *
 * Backed by a per-plugin JSON file inside the plugin's scoped directory, so one
 * plugin can neither read nor overwrite another's settings (DROP-12).
 *
 * <p>{@code apply()} and {@code commit()} both write. Android distinguishes them
 * by whether the caller waits for the write, not by whether it happens, and a
 * plugin that calls {@code apply()} and is then unloaded must not lose settings.
 */
public class SharedPreferences {

    private final Path file;
    private final Map<String, Object> values = new LinkedHashMap<>();

    SharedPreferences(Path file) {
        this.file = file;
        load();
    }

    private void load() {
        if (!Files.isRegularFile(file)) return;
        try {
            String json = Files.readString(file, StandardCharsets.UTF_8);
            Object parsed = MiniJson.parse(json);
            if (parsed instanceof Map<?, ?> m) {
                for (Map.Entry<?, ?> e : m.entrySet()) {
                    values.put(String.valueOf(e.getKey()), e.getValue());
                }
            }
        } catch (IOException | RuntimeException e) {
            // A corrupt preferences file must not stop the plugin loading; it
            // starts from defaults, exactly as Android does.
        }
    }

    private synchronized void persist() {
        try {
            Files.createDirectories(file.getParent());
            Files.writeString(file, MiniJson.write(values), StandardCharsets.UTF_8);
        } catch (IOException e) {
            // Best effort: a plugin cannot usefully recover from this.
        }
    }

    public synchronized Map<String, ?> getAll() {
        return Collections.unmodifiableMap(new LinkedHashMap<>(values));
    }

    public synchronized String getString(String key, String def) {
        Object v = values.get(key);
        return v instanceof String s ? s : def;
    }

    @SuppressWarnings("unchecked")
    public synchronized Set<String> getStringSet(String key, Set<String> def) {
        Object v = values.get(key);
        if (v instanceof Iterable<?> it) {
            Set<String> out = new java.util.LinkedHashSet<>();
            for (Object o : it) out.add(String.valueOf(o));
            return out;
        }
        return def;
    }

    public synchronized int getInt(String key, int def) {
        Object v = values.get(key);
        return v instanceof Number n ? n.intValue() : def;
    }

    public synchronized long getLong(String key, long def) {
        Object v = values.get(key);
        return v instanceof Number n ? n.longValue() : def;
    }

    public synchronized float getFloat(String key, float def) {
        Object v = values.get(key);
        return v instanceof Number n ? n.floatValue() : def;
    }

    public synchronized boolean getBoolean(String key, boolean def) {
        Object v = values.get(key);
        return v instanceof Boolean b ? b : def;
    }

    public synchronized boolean contains(String key) {
        return values.containsKey(key);
    }

    public Editor edit() {
        return new Editor();
    }

    public void registerOnSharedPreferenceChangeListener(OnSharedPreferenceChangeListener l) { }

    public void unregisterOnSharedPreferenceChangeListener(OnSharedPreferenceChangeListener l) { }

    /** Android's listener interface; referenced by 3 surveyed plugins. */
    public interface OnSharedPreferenceChangeListener {
        void onSharedPreferenceChanged(SharedPreferences prefs, String key);
    }

    public final class Editor {
        private final Map<String, Object> staged = new LinkedHashMap<>();
        private boolean clear;

        public Editor putString(String key, String value) { staged.put(key, value); return this; }
        public Editor putStringSet(String key, Set<String> value) { staged.put(key, value); return this; }
        public Editor putInt(String key, int value) { staged.put(key, value); return this; }
        public Editor putLong(String key, long value) { staged.put(key, value); return this; }
        public Editor putFloat(String key, float value) { staged.put(key, value); return this; }
        public Editor putBoolean(String key, boolean value) { staged.put(key, value); return this; }

        public Editor remove(String key) { staged.put(key, REMOVE); return this; }

        public Editor clear() { clear = true; return this; }

        public boolean commit() { write(); return true; }

        public void apply() { write(); }

        private void write() {
            synchronized (SharedPreferences.this) {
                if (clear) values.clear();
                for (Map.Entry<String, Object> e : staged.entrySet()) {
                    if (e.getValue() == REMOVE) values.remove(e.getKey());
                    else values.put(e.getKey(), e.getValue());
                }
            }
            persist();
        }
    }

    private static final Object REMOVE = new Object();
}
