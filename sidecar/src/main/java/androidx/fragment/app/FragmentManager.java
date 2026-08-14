package androidx.fragment.app;

import android.content.UnsupportedAndroidApiException;

/**
 * {@code androidx.fragment.app.FragmentManager} — named by 4 load failures in
 * the corpus, always as the first argument of
 * {@code DialogFragment.show(manager, tag)}.
 *
 * <p>Reached only through {@code activity.supportFragmentManager}, which throws
 * first, so in practice nothing here executes. It exists because the descriptor
 * of {@code show} names it, and an extension that calls {@code show} anywhere in
 * its {@code load()} needs the type present for that method to resolve.
 */
public abstract class FragmentManager {

    protected FragmentManager() {
    }

    public FragmentTransaction beginTransaction() {
        throw new UnsupportedAndroidApiException(
                "androidx.fragment.app.FragmentManager.beginTransaction");
    }

    public Fragment findFragmentByTag(String tag) {
        return null;
    }

    public Fragment findFragmentById(int id) {
        return null;
    }

    public boolean popBackStackImmediate() {
        return false;
    }

    public void popBackStack() {
        throw new UnsupportedAndroidApiException(
                "androidx.fragment.app.FragmentManager.popBackStack");
    }

    public int getBackStackEntryCount() {
        return 0;
    }

    public void executePendingTransactions() {
        throw new UnsupportedAndroidApiException(
                "androidx.fragment.app.FragmentManager.executePendingTransactions");
    }
}
