package android.content;

import androidx.appcompat.app.AppCompatActivity;

import java.nio.file.Path;

/**
 * The object a plugin actually receives as its {@code Context} — which is an
 * {@link AppCompatActivity}, deliberately.
 *
 * <h2>The measured problem</h2>
 * Supplying {@code AppCompatActivity} as a type fixed the load-time
 * {@code NoClassDefFoundError}, and immediately exposed the failure underneath
 * it. The dominant shape in the corpus is not a lambda; it is the first
 * statement of {@code load()}:
 *
 * <pre>
 *     override fun load(context: Context) {
 *         activity = context as AppCompatActivity   // ← here
 *         registerMainAPI(DesiXFlix(this))          // ← never reached
 *     }
 * </pre>
 *
 * 25 files in the corpus do exactly that, and with a plain Context every one of
 * them threw {@code ClassCastException} before registering a single provider.
 * Verified: `Aniworld` failed precisely this way. The error changed and the
 * outcome did not — the extension was still lost in full.
 *
 * <h2>Why this is the right trade</h2>
 * The reference is almost always just *stored*. The plugin keeps it to open a
 * settings dialog later, and the host never asks it to. So satisfying the cast
 * converts a total loss of every provider in the archive into an extension that
 * scrapes normally and has no settings screen — which is what
 * {@code T3_DEGRADED} exists to describe.
 *
 * <p>Nothing is faked to achieve it. Every inherited Activity operation still
 * throws {@link UnsupportedAndroidApiException}: there is no window, no fragment
 * manager, no resource table, and asking for one says so. This is the same
 * bargain already struck for {@code Context.getPackageManager}, which returns a
 * real {@code PackageManager} whose every method throws — the type is what lets
 * the code link, and the behaviour is what stays honest (DROP-9).
 *
 * <p><b>The one cost, stated plainly.</b> {@code context is AppCompatActivity}
 * now answers true where no activity exists, so an extension that *branches* on
 * it takes the UI path and fails a step later instead of taking its headless
 * path. One file in the corpus does that, against 25 that cast. The ratio decides
 * it, and the failure it produces is the same one the branch was avoiding.
 */
public final class PluginHostContext extends AppCompatActivity {

    PluginHostContext(String pluginId, Path scopedDir) {
        super(pluginId, scopedDir);
    }
}
