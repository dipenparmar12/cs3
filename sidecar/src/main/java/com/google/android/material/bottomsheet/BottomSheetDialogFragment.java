package com.google.android.material.bottomsheet;

import androidx.fragment.app.DialogFragment;

/**
 * {@code com.google.android.material.bottomsheet.BottomSheetDialogFragment}.
 *
 * <p>Counted, not guessed. A user's session log held 36 {@code
 * NoClassDefFoundError} records and <b>every one of them named this class</b> —
 * it was the entire remaining class problem, with no tail behind it. It had
 * been noted as outstanding at a single occurrence and left alone under the
 * count-first rule; the count moved.
 *
 * <p>Same shape as every other UI closure in this shim, and it exists for the
 * same reason: an extension's settings screen and its scraper ship in one
 * archive. Verification resolves a class's whole ancestry before it can be
 * defined, so a settings class extending this made {@code defineClass1} reject
 * it — and the extension lost every provider it was about to register, over a
 * dialog no desktop user was ever going to see.
 *
 * <p>Nothing here is functional and nothing pretends to be. It extends {@link
 * DialogFragment}, which supplies the inherited members an override calls
 * {@code super} on, and inherits that class's refusals — {@code show} throws
 * rather than silently no-oping, so a viewer is never left waiting for a sheet
 * that is not coming. Material adds no member to this class that the corpus
 * calls; it is the *type* that has to resolve.
 *
 * <p>Note the package: this must be built into the android-shim jar, never into
 * {@code cs3-sidecar.jar}. Its supertype chain runs through {@code
 * androidx.fragment.app.DialogFragment} to {@code android.content.Context},
 * both of which are excluded from the sidecar jar — so a stray copy there would
 * win parent-first delegation and then fail to link, naming this class for a
 * problem that is entirely about where it was packaged. See the exclusion
 * comments in {@code sidecar/pom.xml}.
 */
public class BottomSheetDialogFragment extends DialogFragment {
}
