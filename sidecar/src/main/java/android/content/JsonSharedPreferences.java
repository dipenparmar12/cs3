package android.content;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Set;

/**
 * The desktop implementation of {@link SharedPreferences}.
 *
 * Backed by a per-plugin JSON file inside the plugin's scoped directory, so one
 * plugin can neither read nor overwrite another's settings (DROP-12).
 *
 * <p>{@code apply()} and {@code commit()} both write. Android distinguishes them
 * by whether the caller waits for the write, not by whether it happens, and a
 * plugin that calls {@code apply()} and is then unloaded must not lose settings.
 *
 * <p>Split out of the shim type when {@code SharedPreferences} became an
 * interface to match Android — see that file for why the shape matters.
 */
public class JsonSharedPreferences implements SharedPreferences {

    private static final Object REMOVE = new Object();

    private final Path file;
    private final Map<String, Object> values = new LinkedHashMap<>();

    JsonSharedPreferences(Path file) {
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

    @Override
    public synchronized Map<String, ?> getAll() {
        return Collections.unmodifiableMap(new LinkedHashMap<>(values));
    }

    @Override
    public synchronized String getString(String key, String defValue) {
        Object v = values.get(key);
        return v instanceof String s ? s : defValue;
    }

    @Override
    public synchronized Set<String> getStringSet(String key, Set<String> defValues) {
        Object v = values.get(key);
        if (v instanceof Iterable<?> it) {
            Set<String> out = new LinkedHashSet<>();
            for (Object o : it) out.add(String.valueOf(o));
            return out;
        }
        return defValues;
    }

    @Override
    public synchronized int getInt(String key, int defValue) {
        Object v = values.get(key);
        return v instanceof Number n ? n.intValue() : defValue;
    }

    @Override
    public synchronized long getLong(String key, long defValue) {
        Object v = values.get(key);
        return v instanceof Number n ? n.longValue() : defValue;
    }

    @Override
    public synchronized float getFloat(String key, float defValue) {
        Object v = values.get(key);
        return v instanceof Number n ? n.floatValue() : defValue;
    }

    @Override
    public synchronized boolean getBoolean(String key, boolean defValue) {
        Object v = values.get(key);
        return v instanceof Boolean b ? b : defValue;
    }

    @Override
    public synchronized boolean contains(String key) {
        return values.containsKey(key);
    }

    @Override
    public Editor edit() {
        return new JsonEditor();
    }

    @Override
    public void registerOnSharedPreferenceChangeListener(OnSharedPreferenceChangeListener l) {
    }

    @Override
    public void unregisterOnSharedPreferenceChangeListener(OnSharedPreferenceChangeListener l) {
    }

    private final class JsonEditor implements Editor {
        private final Map<String, Object> staged = new LinkedHashMap<>();
        private boolean clear;

        @Override
        public Editor putString(String key, String value) { staged.put(key, value); return this; }

        @Override
        public Editor putStringSet(String key, Set<String> values) { staged.put(key, values); return this; }

        @Override
        public Editor putInt(String key, int value) { staged.put(key, value); return this; }

        @Override
        public Editor putLong(String key, long value) { staged.put(key, value); return this; }

        @Override
        public Editor putFloat(String key, float value) { staged.put(key, value); return this; }

        @Override
        public Editor putBoolean(String key, boolean value) { staged.put(key, value); return this; }

        @Override
        public Editor remove(String key) { staged.put(key, REMOVE); return this; }

        @Override
        public Editor clear() { clear = true; return this; }

        @Override
        public boolean commit() { write(); return true; }

        @Override
        public void apply() { write(); }

        private void write() {
            synchronized (JsonSharedPreferences.this) {
                if (clear) values.clear();
                for (Map.Entry<String, Object> e : staged.entrySet()) {
                    if (e.getValue() == REMOVE) values.remove(e.getKey());
                    else values.put(e.getKey(), e.getValue());
                }
            }
            persist();
        }
    }
}
