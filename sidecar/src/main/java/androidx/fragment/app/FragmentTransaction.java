package androidx.fragment.app;

import android.content.UnsupportedAndroidApiException;

/**
 * {@code androidx.fragment.app.FragmentTransaction} — the return type of
 * {@code FragmentManager.beginTransaction}, present so that call resolves.
 *
 * <p>The builder methods return {@code this} in Android and extensions chain
 * them, so they are declared with the same fluent return type here even though
 * none of them is reachable: {@code beginTransaction} throws before any of them
 * can be called.
 */
public abstract class FragmentTransaction {

    protected FragmentTransaction() {
    }

    public FragmentTransaction add(int containerViewId, Fragment fragment) {
        throw new UnsupportedAndroidApiException("androidx.fragment.app.FragmentTransaction.add");
    }

    public FragmentTransaction add(int containerViewId, Fragment fragment, String tag) {
        throw new UnsupportedAndroidApiException("androidx.fragment.app.FragmentTransaction.add");
    }

    public FragmentTransaction replace(int containerViewId, Fragment fragment) {
        throw new UnsupportedAndroidApiException("androidx.fragment.app.FragmentTransaction.replace");
    }

    public FragmentTransaction remove(Fragment fragment) {
        throw new UnsupportedAndroidApiException("androidx.fragment.app.FragmentTransaction.remove");
    }

    public FragmentTransaction addToBackStack(String name) {
        throw new UnsupportedAndroidApiException(
                "androidx.fragment.app.FragmentTransaction.addToBackStack");
    }

    public int commit() {
        throw new UnsupportedAndroidApiException("androidx.fragment.app.FragmentTransaction.commit");
    }

    public int commitAllowingStateLoss() {
        throw new UnsupportedAndroidApiException(
                "androidx.fragment.app.FragmentTransaction.commitAllowingStateLoss");
    }

    public void commitNow() {
        throw new UnsupportedAndroidApiException(
                "androidx.fragment.app.FragmentTransaction.commitNow");
    }
}
