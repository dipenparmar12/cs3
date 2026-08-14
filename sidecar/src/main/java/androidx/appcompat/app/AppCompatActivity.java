package androidx.appcompat.app;

import androidx.fragment.app.FragmentActivity;

/**
 * {@code androidx.appcompat.app.AppCompatActivity} — 23 load failures named this
 * class, the second-largest cause in the corpus after
 * {@code cloudstream3.utils.DataStore}.
 *
 * <p>The shape of every one was the same. An extension assigns its settings
 * hook during {@code load()}:
 *
 * <pre>
 *     openSettings = { ctx -&gt; SomeSettings(this).show((ctx as AppCompatActivity)
 *             .supportFragmentManager, "settings") }
 * </pre>
 *
 * The cast is inside a lambda that is merely *constructed* during load, never
 * invoked — but constructing it loads the lambda class, and that resolves the
 * type it casts to. So an extension lost all of its providers over a settings
 * screen the host was never going to open.
 *
 * <p>Empty on purpose: everything it needs to inherit is on
 * {@link FragmentActivity} and {@code android.app.Activity}. What matters is
 * only that the name resolves and sits on the same chain as
 * {@code android.content.Context}, so the cast links. It still throws when
 * executed, which is honest — the Context a plugin is handed is a storage token,
 * not an Activity — and by then the provider is registered and searchable.
 */
public class AppCompatActivity extends FragmentActivity {

    protected AppCompatActivity(String pluginId, java.nio.file.Path scopedDir) {
        super(pluginId, scopedDir);
    }
}
