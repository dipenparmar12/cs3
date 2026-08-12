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

    /** The {@code Class#method} that was reached, for aggregation. */
    public String api() {
        return api;
    }
}
