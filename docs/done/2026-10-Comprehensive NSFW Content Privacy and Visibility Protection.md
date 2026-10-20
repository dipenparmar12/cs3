> **Filed 2026-10-20: Done.** Built; the main modules exist in the code (full line-by-line check not done). See [docs-audit-2026-10-20](../roadmap/docs-audit-2026-10-20.md).

# PRD: Comprehensive NSFW Content Privacy and Visibility Protection

## 1. Objective

Implement a consistent, application-wide privacy mechanism for NSFW content in CS3 Desktop.

When NSFW content is disabled in Settings, all content identified as NSFW must be hidden across the entire application, not just in search results, posters, or the player. This includes History, Downloads, Library, saved items, and every other screen or component that can expose adult-content metadata.

The current behavior creates a privacy risk: a user can enable NSFW content, watch or download adult content, and subsequently disable NSFW content while titles, posters, metadata, or saved records remain visible elsewhere in the application.

CS3 may be used on shared computers by family members, children, friends, or other users. Disabling NSFW content must therefore provide a meaningful privacy boundary that prevents adult-content exposure through the application's normal interface.

**Core principle: When NSFW content is disabled, NSFW content must not be visible anywhere in the application, regardless of when it was accessed, downloaded, saved, or added to history.**

## 2. Global NSFW Visibility Policy

Establish one consistent visibility policy based on the application's existing NSFW settings and content-classification mechanisms.

When NSFW content is disabled:

- Hide all items classified or flagged as NSFW.
- Hide associated titles, posters, thumbnails, descriptions, episode information, and other identifying metadata.
- Apply the policy across every screen, not only the search interface.
- Prevent hidden content from appearing through filters, sorting, grouping, recommendations, or alternate navigation paths.
- Ensure that disabling NSFW content immediately updates all relevant views.
- Prevent cached results or previously loaded data from restoring hidden content to the interface.
- Preserve underlying records unless the user explicitly chooses to delete them.

When NSFW content is enabled, allow NSFW items to appear according to the application's existing access, blur, and adult-content confirmation rules.

Disabling NSFW content must not be treated as deleting history, downloads, or library records. It changes their visibility, not their existence.

## 3. Application-Wide Coverage

Audit every screen, data source, and reusable component that can display media metadata.

### 3.1 Search and Search Results

- Hide NSFW results when NSFW content is disabled.
- Apply the rule to progressively arriving results as well as already-rendered results.
- Ensure filtering occurs before titles, posters, or identifying metadata are rendered.
- Prevent stale search responses from reintroducing hidden results.

### 3.2 History and Recently Watched

- Hide NSFW entries from viewing history when NSFW content is disabled.
- Apply the rule to titles, posters, episode names, timestamps associated with identifiable entries, and detail previews.
- Prevent adult-content entries from appearing in recent activity, continue-watching sections, or similar lists.
- Restore visibility when NSFW content is enabled again, subject to the application's other privacy rules.

### 3.3 Downloads

- Hide NSFW downloads from the visible download list when NSFW content is disabled.
- Hide their identifying metadata, including titles, posters, filenames when displayed as content labels, and download details.
- Prevent completed, active, paused, failed, or queued downloads from exposing adult-content information.
- Ensure download progress notifications, error messages, and contextual menus do not reveal hidden titles.
- Do not delete downloaded files or cancel downloads solely because NSFW visibility has been disabled, unless a separate explicit policy requires it.

### 3.4 Library and Saved Content

- Hide NSFW items from library collections, watchlists, bookmarks, favorites, and other saved-content views.
- Prevent hidden entries from appearing in collection counts, preview cards, recommendations, or related-content sections in ways that reveal adult activity.
- Apply the same policy to saved metadata and content loaded from persistent storage.

### 3.5 Details and Navigation

- Prevent direct navigation to a hidden NSFW item's details page from exposing its metadata.
- Handle deep links, previously open detail pages, browser history, and restored application state.
- If the currently displayed item becomes restricted, remove its identifying metadata from the visible interface and navigate to a safe screen or show a neutral restricted-content state.
- Ensure back navigation cannot restore previously visible NSFW details while the setting remains disabled.

### 3.6 Notifications and Other UI Surfaces

Audit all other potential exposure points, including:

- Search suggestions and autocomplete.
- Home-screen sections and recommendations.
- Player overlays and playback controls.
- Mini-player and picture-in-picture surfaces.
- Tooltips, dialogs, context menus, and selection panels.
- System notifications and media-session metadata.
- Recently opened items and application-level activity summaries.
- Empty-state messages, error messages, and status indicators.
- Any additional screen that renders media titles, artwork, or identifying metadata.

The policy must apply to newly discovered surfaces as well as the currently known screens.

## 4. Immediate Behavior When NSFW Is Disabled

When the user disables NSFW content in Settings, the application must propagate the setting change throughout the UI and relevant data flows.

Required behavior:

1. Update the authoritative NSFW setting.
2. Notify relevant application services and UI components.
3. Re-evaluate visible content against the current classification metadata.
4. Immediately remove restricted items from rendered lists, open details pages, and other active surfaces.
5. Invalidate or update derived collections and cached view models that contain restricted entries.
6. Prevent pending asynchronous requests from reintroducing restricted content.
7. Apply the same rule when restoring the application from a previous session.

Do not require the user to restart the application, refresh each page manually, or revisit Settings before the privacy policy takes effect.

## 5. Content Classification and Unknown Metadata

The visibility policy depends on reliable classification.

Requirements:
- Reuse the application's existing NSFW metadata and classification mechanisms wherever possible.
- Apply the policy to records identified as adult content by provider metadata, tags, saved classification fields, or existing classification logic.
- Preserve NSFW classification when records are stored in history, downloads, and library data.
- Do not assume content is safe merely because a record was created before NSFW classification was added.
- Ensure classification is consistent between search results, playback sessions, and persisted records.
- Prevent a missing or failed metadata lookup from automatically exposing content that is already known to be NSFW.

For records with missing or ambiguous classification, define an explicit fallback policy. Where reliable classification cannot be established, avoid making unsupported claims that the item is safe. Use a conservative, privacy-preserving approach for potentially sensitive records, balanced against the risk of incorrectly hiding ordinary content.

Manual URLs, incomplete provider metadata, and older saved records must be considered during the classification audit.

## 6. Data Persistence and Privacy Boundaries

NSFW visibility must remain consistent across application restarts and data restoration.

Requirements:
- Preserve relevant classification metadata in persisted records when available.
- Ensure history, download, and library repositories expose enough information for the visibility policy to be applied.
- Prevent cached or reconstructed records from bypassing the current setting.
- Ensure restored UI state respects the current NSFW setting rather than the setting that was active when the state was saved.
- Avoid copying sensitive titles and metadata into unnecessary caches or secondary stores.
- Keep visibility filtering separate from permanent deletion.

This feature is primarily a UI and application-data privacy safeguard. Hiding items does not encrypt stored files or protect data from someone with direct access to the application's database, download directory, logs, or filesystem. Do not describe this feature as complete device-level security.

## 7. Architecture and Implementation Guidance

Inspect the existing NSFW setting, adult-content state, classification utilities, history and download repositories, library data flows, caching mechanisms, and reusable media-card components before implementation.

Requirements:
- Use a single authoritative visibility policy rather than implementing unrelated filtering logic on each screen.
- Apply the policy at appropriate shared data-access or view-model boundaries, with defensive checks at sensitive rendering and navigation boundaries.
- Keep classification and visibility decisions separate from permanent record deletion.
- Ensure reactive setting changes invalidate affected derived state.
- Ensure asynchronous updates and cached responses cannot bypass the policy.
- Avoid maintaining duplicated NSFW state in individual components.
- Add regression tests for every existing screen and newly identified exposure surface.

Do not rely solely on CSS hiding, poster blurring, or filtering in one screen. Restricted metadata must not be rendered through alternate components or navigation paths.

## 8. Acceptance Criteria

1. After NSFW content is disabled, NSFW items disappear from search results, History, Downloads, Library, and saved-content views.
2. Existing records remain stored unless the user explicitly deletes them.
3. Re-enabling NSFW content restores eligible records according to the existing application rules.
4. The change takes effect immediately without restarting the application.
5. Open details pages and active UI surfaces do not continue exposing restricted metadata.
6. Pending provider responses and asynchronous updates cannot reintroduce hidden items.
7. Application restart and state restoration preserve the correct visibility policy.
8. Download status, filenames displayed as labels, notifications, and contextual UI do not reveal restricted titles while NSFW is disabled.
9. Direct navigation and back navigation cannot bypass the visibility policy.
10. Saved records retain sufficient classification metadata for consistent filtering.
11. Missing or ambiguous classification is handled according to the defined privacy-preserving fallback policy.
12. Regression tests cover all relevant repositories, screens, caches, navigation paths, and asynchronous updates.
13. Disabling NSFW visibility does not unexpectedly delete files, erase history, or cancel downloads.
14. The implementation does not claim filesystem-level confidentiality or encryption unless those protections are implemented separately.

## 9. Implementation Priority

1. Audit NSFW classification and setting propagation.
2. Identify every screen and repository that exposes media metadata.
3. Implement the shared visibility policy and integrate it with history, downloads, and library.
4. Handle active screens, caches, asynchronous updates, and navigation.
5. Audit notifications, mini-player, media-session metadata, and other secondary exposure surfaces.
6. Add regression tests for disabling, re-enabling, application restart, and incomplete classification.
7. Verify the behavior across the complete application.

## 10. Definition of Done

NSFW content is consistently hidden across the application whenever NSFW content is disabled. Previously accessed or saved adult content cannot reappear through history, downloads, library, cached data, navigation, or secondary UI surfaces. Existing records remain intact, and visibility changes correctly when the setting changes.

The final implementation must provide a consistent, privacy-conscious experience for people sharing the same application, without confusing content visibility with permanent deletion or device-level security.