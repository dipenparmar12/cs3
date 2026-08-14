package androidx.fragment.app;

import android.content.Context;
import android.content.UnsupportedAndroidApiException;
import android.os.Bundle;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;

/**
 * {@code androidx.fragment.app.Fragment} — the superclass extensions extend to
 * build a settings screen.
 *
 * <p>Concrete, non-final, with a public no-argument constructor, because that is
 * what {@code defineClass} requires of a superclass: the corpus failure was
 * {@code defineClass1} rejecting an extension's own settings class before any of
 * its code ran.
 *
 * <h2>Why the lifecycle callbacks do not throw</h2>
 * They are overridden, not called. An extension's {@code onCreateView} is invoked
 * by the framework, and there is no framework here, so nothing reaches them —
 * but a subclass that calls {@code super.onCreateView(...)} as its first
 * statement, which is the conventional shape, would be broken by a throw. The
 * accessors an extension calls *itself* ({@code requireContext},
 * {@code getParentFragmentManager}) do throw, because those return something and
 * a fabricated answer would be a lie about the platform.
 */
public class Fragment {

    /**
     * Android stores fragment arguments here and extensions read them in
     * {@code onCreate}. Held honestly: a fragment that sets its own arguments and
     * reads them back gets what it wrote.
     */
    private Bundle arguments;

    public Fragment() {
    }

    public Fragment(int contentLayoutId) {
    }

    public void setArguments(Bundle args) {
        this.arguments = args;
    }

    public Bundle getArguments() {
        return arguments;
    }

    public Bundle requireArguments() {
        if (arguments == null) {
            throw new IllegalStateException("Fragment " + this + " does not have any arguments.");
        }
        return arguments;
    }

    // --- lifecycle: overridden by extensions, never invoked here --------------

    public void onCreate(Bundle savedInstanceState) {
    }

    public View onCreateView(LayoutInflater inflater, ViewGroup container, Bundle savedInstanceState) {
        return null;
    }

    public void onViewCreated(View view, Bundle savedInstanceState) {
    }

    public void onStart() {
    }

    public void onResume() {
    }

    public void onPause() {
    }

    public void onStop() {
    }

    public void onDestroyView() {
    }

    public void onDestroy() {
    }

    public void onAttach(Context context) {
    }

    public void onDetach() {
    }

    public void onSaveInstanceState(Bundle outState) {
    }

    // --- accessors: called by extensions, so they must not fabricate ---------

    public Context getContext() {
        return null;
    }

    public Context requireContext() {
        throw new UnsupportedAndroidApiException(
                "androidx.fragment.app.Fragment.requireContext — a fragment is never attached on desktop");
    }

    public FragmentActivity getActivity() {
        return null;
    }

    public FragmentActivity requireActivity() {
        throw new UnsupportedAndroidApiException(
                "androidx.fragment.app.Fragment.requireActivity — there is no Activity on desktop");
    }

    public View getView() {
        return null;
    }

    public View requireView() {
        throw new UnsupportedAndroidApiException("androidx.fragment.app.Fragment.requireView");
    }

    public FragmentManager getParentFragmentManager() {
        throw new UnsupportedAndroidApiException(
                "androidx.fragment.app.Fragment.getParentFragmentManager");
    }

    public FragmentManager getChildFragmentManager() {
        throw new UnsupportedAndroidApiException(
                "androidx.fragment.app.Fragment.getChildFragmentManager");
    }

    public boolean isAdded() {
        return false;
    }

    public boolean isVisible() {
        return false;
    }

    public boolean isDetached() {
        return true;
    }

    public String getTag() {
        return null;
    }

    public Object getResources() {
        throw new UnsupportedAndroidApiException("androidx.fragment.app.Fragment.getResources");
    }

    public String getString(int resId) {
        throw new UnsupportedAndroidApiException(
                "androidx.fragment.app.Fragment.getString(int) — desktop has no compiled resource table");
    }
}
