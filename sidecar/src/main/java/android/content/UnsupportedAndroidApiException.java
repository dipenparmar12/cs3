package android.content;

/**
 * Thrown when a plugin reaches an {@code android.*} API the shim does not
 * implement (DROP-7).
 *
 * The point of this type is that it is <em>named and specific</em>. A plugin
 * that calls an unimplemented API must produce a message identifying the exact
 * class and method, so the Supervisor can record a compatibility finding, the
 * user is told what is missing rather than shown a stack trace, and the
 * aggregate decides which stub gets built next (DROP-8, AC-D5).
 */
public class UnsupportedAndroidApiException extends UnsupportedOperationException {

    private final String api;

    public UnsupportedAndroidApiException(String api) {
        super(api + " is not implemented by the CloudStream Desktop Android shim. "
                + "The provider works on Android but this code path cannot run on desktop.");
        this.api = api;
    }

    /**
     * Names the API and explains it separately.
     *
     * <p>Some shims want to say more than the default sentence —
     * {@code Resources} explains that the extension ships an Android resource
     * table, {@code ContentResolver} that content providers address other apps'
     * data. Written with the single-argument constructor, that explanation
     * became the {@link #api()} value: a whole sentence where the aggregation
     * key belongs, so every occurrence of one refusal grouped under a string
     * that reads like prose and no two shims grouped alike.
     *
     * <p>Keeping them apart is the difference between a tally that says
     * "{@code Resources.getString} × 48" and one with 48 rows in it — which is
     * the same argument {@code failureTaxonomy.groupingForm} makes on the host
     * side, and the reason this class exists at all rather than a bare
     * {@code UnsupportedOperationException}.
     *
     * @param api    the {@code Class.method} reached, and nothing else
     * @param detail why it cannot be served here, in a sentence
     */
    public UnsupportedAndroidApiException(String api, String detail) {
        super(api + " is not implemented by the CloudStream Desktop Android shim. " + detail);
        this.api = api;
    }

    /** The {@code Class.method} that was reached, for aggregation. */
    public String api() {
        return api;
    }
}
