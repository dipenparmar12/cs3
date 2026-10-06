We should not display repositories dedicated exclusively to NSFW/adult content when the user has disabled 18+ content in the app.

Repository visibility should be handled based on the type of content the repository provides:

- **NSFW/Adult-only repositories:** Completely hide these repositories from the Extensions/Repositories list when 18+ content is disabled.
- **Mixed-content repositories:** Do not hide the entire repository. Instead, filter out or hide only the NSFW/adult-related extensions, providers, catalogs, and content from that repository.
- **General repositories:** Keep them fully visible and unchanged.

When 18+ content is enabled, the relevant repositories and extensions should become available again according to the user's configuration.

The filtering should be applied consistently across the repository list, extension list, provider selection, search sources, catalogs, and other areas where repository or extension information is displayed.