package android.text;

/**
 * {@code android.text.Editable} — the type {@code EditText.getText()} returns.
 * Only the identity is needed: extensions name it in the settings code that
 * shares an archive with their scraper, so it has to resolve for the scraper to
 * load. Android's interface also extends {@code Spannable} and {@code GetChars};
 * nothing in the counted corpus reaches either. Counted: BingeCloud.
 */
public interface Editable extends CharSequence, Appendable {

    Editable replace(int st, int en, CharSequence text);

    void clear();
}
