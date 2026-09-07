package android.widget;

import android.content.Context;

/**
 * {@code android.widget.CheckBox} — the most frequently missing Android class
 * in the CNC Verse repository.
 *
 * <p>Counted rather than guessed: a `--plugins 20` run of
 * `tools/e2e/provider-e2e.mjs` against that repository produced 18 load
 * failures, and seven of them were this one type — the largest single cause.
 * The call site is always the same shape, an extension's settings dialog
 * inflating a layout and reading a tick box, and it costs the archive every
 * provider it was about to register because the scraper and the settings screen
 * ship together.
 */
public class CheckBox extends CompoundButton {

    public CheckBox() {
    }

    public CheckBox(Context context) {
        super(context);
    }
}
