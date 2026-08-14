package androidx.fragment.app;

import android.app.Activity;
import android.content.UnsupportedAndroidApiException;

/**
 * {@code androidx.fragment.app.FragmentActivity} — the real supertype of
 * {@code AppCompatActivity} and where {@code getSupportFragmentManager} is
 * declared.
 *
 * <p>The hierarchy is reproduced rather than flattened because extensions cast
 * along it. Declaring {@code getSupportFragmentManager} on
 * {@code AppCompatActivity} instead would work for most of the corpus and break
 * the extensions that type their variable as {@code FragmentActivity} — the
 * cheaper shortcut has a failure mode that only shows up on some archives.
 */
public class FragmentActivity extends Activity {

    protected FragmentActivity(String pluginId, java.nio.file.Path scopedDir) {
        super(pluginId, scopedDir);
    }

    /**
     * The single most-called member of this hierarchy: 23 files reach
     * {@code activity.supportFragmentManager} to show a settings dialog.
     */
    public FragmentManager getSupportFragmentManager() {
        throw new UnsupportedAndroidApiException(
                "androidx.fragment.app.FragmentActivity.getSupportFragmentManager"
                        + " — desktop has no Activity to host fragments in");
    }

    public void supportFinishAfterTransition() {
        throw new UnsupportedAndroidApiException(
                "androidx.fragment.app.FragmentActivity.supportFinishAfterTransition");
    }
}
