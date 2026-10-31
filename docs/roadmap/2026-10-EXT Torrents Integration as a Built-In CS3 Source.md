# PRD: EXT Torrents Integration as a Built-In CS3 Source

**Status:** Proposed  
**Priority:** High  
**Platform:** CS3 Desktop  
**Integration type:** Built-in torrent indexer and metadata source  
**Default state:** Enabled, with an option to disable  
**Primary objective:** Search EXT Torrents directly from CS3 and resolve usable torrent references without forcing users to navigate the website manually.

## 1. Overview

Integrate [EXT Torrents](https://ext.to/) into CS3 as a built-in source available through the existing Extensions and Providers interface.

The integration should allow users to discover torrent results alongside results from existing providers. It should extract the available titles, posters, years, IMDb IDs, descriptions, torrent metadata, magnet URIs, and downloadable `.torrent` files where available.

The previous integration attempt resulted in a browser-based implementation instead of a proper in-app indexer. The new implementation should use CS3's existing provider architecture to perform searches, parse results, resolve torrent references, and pass valid results into the existing torrent engine.

EXT Torrents uses Cloudflare protection in some access scenarios. CS3 must therefore provide a user-mediated verification flow, preserve the resulting session where permitted, and handle subsequent verification requests gracefully.

The integration must not depend on bypassing website security controls. If the site requires additional verification, the application should let the user complete it through the official website interface or temporarily mark the source as unavailable.

## 2. Goals

- Add EXT Torrents as a built-in source that users can enable or disable.
- Include EXT Torrents in relevant searches when the source is enabled.
- Extract actual torrent references rather than displaying only website pages.
- Support magnet links and downloadable `.torrent` files.
- Extract available metadata and enrich incomplete results through existing CS3 metadata services.
- Handle Cloudflare verification and session expiry through a user-mediated workflow.
- Reuse verified session state where permitted instead of repeatedly asking the user to verify.
- Integrate with the existing torrent manager, playback, download, history, and source-recovery systems.
- Keep the integration isolated so that website changes or failures do not disrupt other providers.

## 3. Provider Management

### 3.1 Built-in source registration

Register EXT Torrents through the existing built-in source and provider-management architecture.

The Extensions and Providers interface should display:

- Name: EXT Torrents
- Website: `https://ext.to/`
- Source type: Torrent indexer
- Status: Enabled, disabled, verification required, or temporarily unavailable
- Last successful search, where available
- A manual verification or retry action when required

The source should be enabled by default for new installations, subject to the application's existing defaults and user settings.

Users must be able to disable it without uninstalling the application. When disabled, it must not receive search requests or initiate background website requests.

### 3.2 Search integration

When EXT Torrents is enabled, relevant CS3 searches should include it using the existing search orchestration and request-priority system.

The integration must respect the current search scope. If the user has selected a strict provider scope, EXT Torrents must only be queried when it belongs to that scope.

Search requests should support:

- Title searches.
- Original and alternate titles where available.
- IMDb ID searches where supported.
- Movie and series searches.
- Filename-oriented searches.
- Relevant category and quality filters supported by the website.

The indexer must not silently replace the user's query with an unrelated trending or popular-results page when the requested search fails.

## 4. Website Analysis and Result Extraction

### 4.1 Supported information

Extract the following fields when they are present and reliably available:

| Field | Purpose |
|---|---|
| Title | Display name of the torrent result |
| Original or alternate title | Matching and metadata enrichment |
| Release year | Distinguish remakes and similarly named works |
| IMDb ID | Match against existing CS3 metadata |
| Poster or thumbnail | Result-card artwork |
| Detail-page URL | Reopen the original result |
| Description | Additional context when available |
| Category and media type | Search filtering |
| File or release name | Identify the actual torrent release |
| File size | Help users compare candidates |
| Seeder and peer counts | Indicate reported torrent availability |
| Upload or publication date | Identify release freshness |
| Magnet URI | Start torrent resolution |
| `.torrent` download URL | Retrieve torrent metadata when available |
| File list | Identify playable media where the source exposes it |

Fields must remain optional. Do not fabricate values when the website does not provide them.

### 4.2 Search-result extraction

Implement a dedicated EXT Torrents adapter using the existing indexer and provider conventions.

The adapter should:

1. Build a search request from the user's query and supported filters.
2. Retrieve the response through the approved network or browser-session path.
3. Detect whether the response contains search results, a verification challenge, an access error, or an unexpected page.
4. Parse result entries into a normalized internal model.
5. Extract the detail-page URL and torrent references where available.
6. Validate and normalize extracted magnet URIs and download links.
7. Return results progressively through the existing search pipeline.
8. Record parsing errors without causing unrelated providers to fail.

Prefer documented or otherwise authorized interfaces when available. If HTML parsing is necessary, isolate selectors and parsing rules in the EXT Torrents adapter so that website layout changes can be fixed without changing the shared search system.

### 4.3 Detail-page resolution

A search result may expose only a detail-page URL rather than a working magnet URI.

When this occurs, CS3 should retrieve the detail page through the same permitted session and extract the actual torrent reference.

Do not assume that clicking a result's magnet-related control will necessarily produce a magnet URI. The website has documented historical issues in which search-result magnet actions led users to the detail page instead of directly providing the magnet link.

The adapter must validate the final reference before returning it to the torrent engine.

If the page contains no magnet URI or downloadable torrent, return a meaningful `no-torrent-reference` outcome instead of presenting the page URL as though it were a usable torrent.

## 5. Cloudflare Verification and Session Management

### 5.1 Verification flow

When CS3 encounters a Cloudflare challenge or another website verification requirement:

1. Detect the challenge response instead of attempting to parse it as search results.
2. Pause the affected EXT Torrents operation.
3. Display a discreet prompt explaining that website verification is required.
4. Offer the user an action to open the official website in an appropriate in-app browser window.
5. Let the user complete the verification themselves.
6. Detect whether the page has reached a usable website state.
7. If successful, reuse the resulting session for subsequent requests where permitted.
8. Retry the interrupted search once the session is ready.
9. If verification fails or times out, show the source as requiring verification or temporarily unavailable.

The application must not repeatedly open verification windows, create infinite retry loops, or block searches from other providers while waiting for the user.

### 5.2 Session persistence

Reuse the session and cookies established through the user-mediated verification flow when the website permits it.

Requirements:

- Use a dedicated session partition or equivalent isolation mechanism.
- Keep session data separate from unrelated providers and application accounts.
- Preserve cookies according to the website's expected session behavior and the user's privacy settings.
- Avoid copying cookies into renderer state, general application logs, analytics, or exported diagnostics.
- Detect expired or rejected sessions and request verification again when needed.
- Provide a way to clear the stored session.
- Respect Incognito mode and its non-persistence rules.
- Do not treat the presence of cookies as proof that verification is still valid.

Do not implement automated challenge solving, stealth fingerprint manipulation, CAPTCHA circumvention, or other techniques designed to defeat the site's access controls. If the website refuses automated access after user verification, stop automated requests and offer the official website as a fallback.

### 5.3 Verification preferences

If verification occurs repeatedly, let the user choose whether CS3 should remember the preference to offer the verification workflow for future searches or leave EXT Torrents unavailable until they explicitly retry.

This preference controls the application's prompt behavior. It must not suppress a challenge that prevents access or imply that verification can be skipped.

### 5.4 Session expiry and failure handling

Distinguish between:

- Verification required.
- Verification completed.
- Session expired.
- Access denied.
- Website temporarily unavailable.
- Network timeout.
- Unexpected page structure.
- Search returned no results.
- Results found but no usable torrent references extracted.

A challenge response must never be counted as a successful empty search, since that would mislead the user and corrupt provider performance statistics.

## 6. Torrent Reference Validation and Resolution

### 6.1 Magnet URI validation

Before passing a reference to the torrent engine:

- Confirm that it is a valid magnet URI.
- Extract the info hash when available.
- Preserve valid tracker parameters without blindly rewriting the URI.
- Reject malformed or unsafe schemes.
- Avoid logging complete URIs when they contain sensitive or unnecessary parameters.

A title and poster are not evidence that the magnet URI was extracted successfully.

### 6.2 `.torrent` file support

When a downloadable torrent file is available:

1. Retrieve it through the permitted website session.
2. Validate the HTTP response and file format.
3. Reject HTML verification pages returned in place of the file.
4. Parse the torrent metadata using the existing torrent engine.
5. Enumerate the contained files.
6. Pass the resulting torrent reference into the standard torrent resolution pipeline.

Do not save an error page with a `.torrent` extension and report it as a valid torrent file.

### 6.3 Integration with the torrent engine

The EXT Torrents adapter should return normalized torrent references to CS3's existing torrent manager.

It must not implement its own parallel torrent downloader, media streaming engine, or history system.

The shared torrent pipeline remains responsible for:

- Metadata retrieval.
- Peer discovery.
- File enumeration.
- Multi-file torrent selection.
- Streamable file resolution.
- Playback and downloads.
- Resume state and history.
- Recovery from expired or unusable source references.

If the torrent cannot be resolved, return a specific error category that identifies the failing stage.

## 7. Metadata Enrichment and Matching

### 7.1 Use available source metadata first

EXT Torrents may expose an IMDb ID or a title without complete descriptive metadata.

Use the available fields in this order:

1. Extract the website's title, release information, IMDb ID, and poster where available.
2. Match the IMDb ID against CS3's existing metadata records.
3. If no usable ID exists, match using normalized title, year, and media type.
4. Use existing metadata services to retrieve missing posters, original titles, years, and descriptions.
5. Preserve the original torrent release name independently from the canonical display title.

### 7.2 Prevent incorrect matches

Do not use a title-only match to overwrite the metadata of an unrelated movie or series.

Apply the existing CS3 title-matching and identity-verification rules. Where the match is uncertain, retain the torrent result with its original release name and mark the metadata as uncertain.

Metadata enrichment must not alter the magnet URI, torrent info hash, or underlying torrent identity.

## 8. Caching and Performance

Cache website-derived data to reduce repeated requests and unnecessary page loads.

Suggested cache categories:

- Search-result metadata.
- Detail-page metadata.
- Resolved magnet URIs.
- Downloadable torrent references.
- Session and verification status.
- Parsing failures and short-lived negative results.

Apply different expiration rules to descriptive metadata and session-bound references.

A cached magnet URI may remain useful longer than a session-bound download URL, but its validity must not be assumed indefinitely. Refresh stale references when needed.

Requirements:

- Reuse existing CS3 cache infrastructure.
- Use bounded storage and expiry.
- Prevent duplicate concurrent requests for the same search or detail page.
- Respect foreground playback and search priority.
- Apply rate limits and backoff to avoid excessive website requests.
- Cancel requests when the search is cancelled or the user changes context.
- Never let a slow EXT Torrents request delay results already returned by other providers.

## 9. Provider Status and User Interface

### 9.1 Search results

EXT Torrents results should use the existing result-card design and support the standard source attribution and filtering behavior.

Where the source exposes them, show useful distinctions such as release name, year, size, and seeder count.

Do not create a separate search screen solely for EXT Torrents unless the existing provider architecture cannot represent its results.

### 9.2 Source status

Expose compact statuses for:

- Enabled and ready.
- Searching.
- Verification required.
- Results found.
- No results.
- No usable torrent reference.
- Temporarily unavailable.
- Disabled by the user.

Avoid permanent success badges that clutter the interface. Keep errors and required actions visible while making routine successful searches unobtrusive.

### 9.3 Recovery actions

When the source cannot return usable results, offer the relevant next action:

- Complete website verification.
- Retry the search.
- Open the result on the official website.
- Re-enable the source if disabled.
- Continue using other providers.

The failure of EXT Torrents must not prevent CS3 from displaying results from other enabled sources.

## 10. Diagnostics and Observability

Record enough information to identify integration failures without collecting unnecessary personal data.

Measure:

- Search request duration.
- Challenge detection rate.
- Verification success and failure.
- Session reuse and expiry.
- Search parsing success rate.
- Detail-page resolution success rate.
- Magnet extraction success rate.
- `.torrent` download and validation success rate.
- Metadata enrichment success rate.
- Cache hit rate.
- Invalid or missing torrent references.
- Errors grouped by pipeline stage.

Do not record session cookies, authentication headers, or full sensitive URLs.

Provider reliability statistics must distinguish website access failure from a successful search that genuinely returned no matching torrent.

## 11. Implementation Plan

### Phase 0: Inspect the existing implementation

- Locate the previous EXT Torrents browser-based integration.
- Determine whether any parsing logic, selectors, or metadata mappings can be reused.
- Trace the existing built-in provider registration and settings flow.
- Confirm how the current network layer handles cookies, redirects, and HTML responses.
- Verify how torrent references enter the torrent manager.
- Check the existing cache, source ranking, and error-classification mechanisms.
- Test representative searches and detail pages, including cases where the website requests verification.

**Exit criteria:** A code-backed implementation map and a set of reproducible failures are documented.

### Phase 1: Build the indexer adapter

- Register EXT Torrents as a built-in source.
- Implement query construction and search-result parsing.
- Extract result metadata and detail-page URLs.
- Resolve magnet URIs and downloadable torrent files where available.
- Normalize the results into the existing CS3 source model.
- Add parser tests using representative saved responses.

**Exit criteria:** The source returns valid, correctly attributed results without requiring a separate browser-based search experience.

### Phase 2: Implement user-mediated verification

- Detect verification challenges.
- Open the official website in an isolated in-app browser.
- Let users complete verification.
- Reuse permitted session state.
- Handle session expiry, failure, and retry.
- Respect Incognito mode and session clearing.

**Exit criteria:** Verification is handled explicitly and safely, without challenge-bypass automation or infinite retries.

### Phase 3: Complete torrent resolution

- Validate magnet URIs.
- Retrieve and validate `.torrent` files.
- Integrate references with the existing torrent manager.
- Support multi-file torrents and nested folders.
- Ensure the application distinguishes metadata success from playable-media success.

**Exit criteria:** Valid torrent references resolve into the existing torrent playback or download workflow.

### Phase 4: Metadata, cache, and ranking

- Enrich incomplete metadata through existing services.
- Apply title identity checks.
- Add appropriate cache and expiry behavior.
- Record provider outcomes separately by failure category.
- Integrate the source into existing ranking and search orchestration.

**Exit criteria:** Results are correctly matched, efficiently reused, and ranked using meaningful outcomes.

### Phase 5: UI polish and regression testing

- Add provider status indicators and recovery actions.
- Verify enable/disable behavior.
- Test search cancellation and background contention.
- Test session expiry and website layout changes.
- Confirm that other providers, playback, torrent history, and downloads remain unaffected.

**Exit criteria:** EXT Torrents behaves like a first-class built-in source rather than a fragile external browser workflow.

## 12. Acceptance Criteria

1. EXT Torrents appears in the built-in Providers interface and can be disabled.
2. When enabled, relevant searches include EXT Torrents within the active search scope.
3. Search results include all reliably extractable metadata and valid torrent references.
4. Detail-page resolution retrieves actual magnet URIs or `.torrent` files when available.
5. Cloudflare verification is handled through a user-mediated official website flow.
6. Session state is reused where permitted and cleared according to user privacy settings.
7. Verification failures are distinguishable from genuine no-result searches.
8. Valid torrent references enter the existing torrent manager without a parallel playback implementation.
9. Metadata enrichment does not silently assign the wrong title or poster.
10. Search failures remain isolated to EXT Torrents and do not block other providers.
11. Caching, retries, cancellation, and rate limits prevent excessive requests.
12. Diagnostics contain enough information to investigate failures without exposing sensitive session data.

## 13. Important Implementation Principle

Treat EXT Torrents as a torrent indexer, not as a video-streaming provider.

Its responsibility is to discover torrent releases, extract their metadata, and supply valid torrent references. CS3's existing torrent manager is responsible for resolving those references into files and playable media.

This separation keeps the integration maintainable, allows torrent handling to improve independently, and prevents website-specific behavior from leaking into the application's core playback architecture.