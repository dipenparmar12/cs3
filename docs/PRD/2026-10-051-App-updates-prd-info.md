# CS3 Desktop Application: Media Sources, Discovery, Navigation, Search UX, Trailer Playback, and Provider Verification Improvements

## 1. Purpose

The following requirements consolidate the issues and improvements identified for the current desktop application.

The objective is to improve the overall media discovery and playback experience while making the desktop implementation more reliable, responsive, and consistent across the entire application.

The work covers the following major areas:

1. Persistent and intelligent media-source caching
2. Incremental source discovery and source refresh
3. "More Like This" pagination and infinite scrolling
4. Global "Scroll to Top" behavior
5. Shareable deep-link detection and direct navigation
6. Search-history item removal visibility
7. Search-source bulk selection controls
8. Trailer playback synchronization and seeking
9. Trailer mini-player support
10. Provider security and human-verification handling
11. Desktop user-assisted verification and cookie/session persistence
12. Common architecture, state management, caching, error handling, and UX consistency

The objective is not to modify the code as part of this document. This document defines the required behavior, architecture, UX expectations, implementation considerations, and acceptance criteria.

---

# 2. Media Details Screen: Persistent Source Discovery

## 2.1 Current Problem

On:

```text
Media Details Screen
    → View Sources
        → Select a Source
```

the application currently appears to restart source discovery whenever the source-selection dialog is opened or refreshed.

Previously discovered sources are not reliably retained.

For example:

```text
User opens Select a Source
    ↓
Provider A finds Source 1
Provider B finds Source 2
Provider C finds Source 3
    ↓
User closes dialog
    ↓
User opens Select a Source again
    ↓
Application starts searching again
    ↓
Previously discovered sources are temporarily unavailable
```

This creates several problems:

- Unnecessary network requests
- Increased provider load
- Slower source selection
- Repeated scraping
- Repeated Cloudflare/security challenges
- Previously working sources disappearing temporarily
- Poor user experience
- Unnecessary waiting every time the user opens the source selector
- Loss of valuable provider/source discovery information

The application should instead maintain a persistent, intelligent source cache.

---

# 3. Persistent Source Cache

## 3.1 Core Requirement

Once a source has been successfully discovered and validated, it should remain available for the associated media item until there is a good reason to invalidate it.

The system should not automatically clear previously discovered sources simply because the user reopened the source-selection dialog.

The basic behavior should be:

```text
First source discovery
        ↓
Source found
        ↓
Source validated
        ↓
Store source
        ↓
User opens Select a Source again
        ↓
Immediately display cached source
        ↓
Background validation / refresh if required
```

The source-selection UI should therefore be able to display previously known sources immediately while new sources are discovered in the background.

---

# 4. Source Cache Lifecycle

Each cached source should have enough metadata to determine whether it is still useful.

A source record should conceptually contain information such as:

```text
Media ID
Provider
Repository
Source URL
Playback URL
Quality
Resolution
Language
Audio information
Subtitle information
Stream type
Headers
Cookies/session requirements
Discovered timestamp
Last validated timestamp
Last successful playback timestamp
Expiration timestamp, if known
Validation status
Failure count
Last HTTP status
Source priority
```

The exact implementation can follow the existing source model, but the cache needs enough information to distinguish a healthy source from an expired or invalid source.

---

# 5. Source Retention Rules

A previously discovered source should remain cached when:

- The source has not expired
- The source has previously worked
- The provider has not reported it as invalid
- The source does not return a definitive failure
- The source has not been explicitly removed
- Its authentication/session information remains valid

A source should be considered for removal or invalidation when:

- The source URL has expired
- The provider explicitly reports the source as unavailable
- The source repeatedly returns a definitive HTTP failure
- Authentication is permanently invalid
- The source is no longer playable after validation
- The provider indicates that the resource no longer exists
- The source has exceeded the configured failure threshold

Temporary failures should **not** immediately delete a source.

For example:

```text
HTTP 500
HTTP 502
HTTP 503
Network timeout
Temporary DNS failure
Temporary CDN failure
Temporary connection reset
```

should normally cause the system to mark the source as temporarily unhealthy rather than immediately deleting it.

---

# 6. Source Validation Strategy

The source system should distinguish between:

### Healthy

The source is known to work.

```text
VALID
```

### Unknown

The source exists but has not recently been validated.

```text
STALE
```

### Temporarily unavailable

The source failed recently but may become available again.

```text
TEMPORARILY_UNAVAILABLE
```

### Expired

The source has a known expiration time that has passed.

```text
EXPIRED
```

### Permanently invalid

The source has been confirmed as unusable.

```text
INVALID
```

This prevents the system from treating every failure as a reason to delete the source.

---

# 7. Cached Sources Must Be Displayed Immediately

When the user opens:

```text
Select a Source
```

the application should not wait for a complete fresh provider search.

Instead:

```text
Open dialog
    ↓
Load cached sources immediately
    ↓
Display available sources
    ↓
Start background refresh
    ↓
Add newly discovered sources progressively
    ↓
Update/remove sources only when validation requires it
```

This should make the source selector feel instant even when providers are slow.

---

# 8. Background Source Refresh

If cached sources exist, the application should perform background discovery rather than blocking the user.

For example:

```text
Cached:
Provider A → 1080p
Provider B → 720p
Provider C → 480p

Background refresh:
Provider D → 1080p
Provider E → 4K
Provider B → updated URL
```

The UI should progressively add newly discovered sources.

It should never replace the existing source list with an empty state while refreshing.

---

# 9. Source Deduplication

The source cache must prevent duplicate entries.

Two sources should not appear as separate entries merely because:

- Their URL has a different temporary token
- The provider returned the same source multiple times
- The source was discovered in multiple searches
- The provider was queried again
- The same source was returned through multiple repository paths

A stable source identity should be derived from available metadata such as:

```text
Provider
Media identity
Source identity
Quality
Language
Audio variant
Stream type
```

Temporary URL changes should update an existing source where possible instead of creating an unnecessary duplicate.

---

# 10. Source Refresh Must Be Non-Destructive

Refreshing sources should be additive and corrective rather than destructive.

Bad behavior:

```text
Clear everything
    ↓
Search providers
    ↓
Rebuild source list
```

Preferred behavior:

```text
Existing sources
    ↓
Keep existing sources
    ↓
Search providers
    ↓
Add new sources
    ↓
Update changed sources
    ↓
Invalidate confirmed dead sources
```

This is especially important when only some providers respond during a refresh.

A slow or temporarily unavailable provider must not cause previously discovered sources from other providers to disappear.

---

# 11. Source Cache Expiration

The cache should support multiple levels of expiration.

### Known-expiration sources

If the provider gives an expiration time:

```text
expiresAt = known timestamp
```

the application should respect that information.

### Unknown-expiration sources

If no expiration information is available, the source should remain cached and be validated when appropriate.

### Recently validated sources

Recently successful sources should receive higher confidence and should not be unnecessarily revalidated.

---

# 12. Playback Failure and Cache Recovery

If a user selects a cached source and playback fails:

```text
Cached source
    ↓
Playback attempt
    ↓
Failure
```

the application should determine the reason.

If the failure indicates that the source is expired:

```text
Mark source stale/expired
    ↓
Request fresh source
    ↓
Replace/update cached source
    ↓
Retry playback
```

If the failure appears temporary:

```text
Keep source
    ↓
Mark temporarily unavailable
    ↓
Try another source
```

This should integrate with the existing source-refresh and playback-recovery mechanisms rather than creating a separate unrelated system.

---

# 13. "More Like This" Media Section

## 13.1 Current Problem

The Media Details screen currently contains a:

```text
More Like This
```

section.

At present, it behaves primarily as a horizontal list with a fixed number of results from the first request.

This limits discovery and creates an inconsistent experience compared with other areas of the application.

---

# 14. More Like This: Show All

The section should provide:

```text
More Like This                         Show All >
```

The user should be able to click **Show All** and navigate to a dedicated results page.

Example:

```text
Media Details
    ↓
More Like This
    ↓
Show All
    ↓
More Like This Results
```

The dedicated page should support the same discovery patterns used elsewhere in the application.

---

# 15. Progressive Pagination

The Show All page should not load every related item at once.

Instead:

```text
Initial request
    ↓
Display first page
    ↓
User scrolls
    ↓
Load next page
    ↓
Append results
    ↓
User continues scrolling
    ↓
Load next page
```

This should continue until the provider indicates that there are no more results.

---

# 16. Infinite Scroll Requirements

The system should:

- Load content progressively
- Avoid loading hundreds or thousands of items immediately
- Display results as soon as they are available
- Prevent duplicate requests
- Prevent duplicate media items
- Show loading state near the end of the list
- Prevent multiple simultaneous page requests
- Recover gracefully from failed page requests
- Allow retrying a failed page
- Preserve already loaded results
- Stop requesting pages when the provider has no more results

---

# 17. Consistency Across the Application

The same pagination architecture should eventually be reusable for:

- Home
- Categories
- Streaming services
- Search results
- More Like This
- Provider catalogs
- Repository catalogs
- Genre pages
- Related content
- Recommendations
- Other expandable media collections

We should avoid implementing a separate pagination mechanism for every screen.

---

# 18. Global "Scroll to Top" Control

## 18.1 Problem

Across the application, when the user scrolls deep into a page, there is currently no convenient way to return to the top.

This occurs in areas such as:

- Home
- Streaming service pages
- Catalog pages
- Search results
- More Like This
- Settings
- Extension pages
- Repository pages
- Long media lists
- Other scrollable screens

The application should provide a consistent global "Scroll to Top" interaction.

---

# 19. Scroll-to-Top Button

A small Chevron Up button should appear when the user has scrolled sufficiently away from the top.

Example:

```text
                         Content
                         Content
                         Content

                                      ↑
                                  Chevron
```

Clicking it should smoothly return the active scroll container to:

```text
scrollTop = 0
```

---

# 20. Visibility Rules

The control should not be visible when the user is already near the top.

It should appear only after the user has scrolled beyond a meaningful threshold.

The threshold should be based on viewport/content movement rather than literally requiring the user to reach the absolute bottom of the page.

For example:

```text
At top
    → Hidden

User scrolls sufficiently
    → Appears

User continues scrolling
    → Remains visible

User clicks
    → Scrolls to top

Returns to top
    → Hidden
```

The exact threshold should be configurable and standardized across the application.

---

# 21. Scroll-to-Top Visual Design

The button should be intentionally subtle.

It should:

- Have a compact size
- Use a simple Chevron Up icon
- Have sufficient contrast
- Use a slightly translucent/ambient appearance
- Avoid covering important content
- Avoid attracting unnecessary attention
- Maintain accessibility
- Become visually prominent enough on hover/focus
- Remain above the content layer
- Work correctly over cards, grids, lists, and media pages

The goal is:

> Visible when needed, almost invisible when not needed.

---

# 22. Multiple Scroll Containers

The implementation must correctly identify the active scroll container.

Some screens may contain:

```text
Application viewport
    └── Page
         └── Scroll container
              └── Content
```

Other screens may have nested scrollable areas.

The button must scroll the correct primary page container rather than:

- Scrolling the wrong element
- Scrolling the body instead of the application container
- Moving a nested list unexpectedly
- Doing nothing because the wrong container is being targeted

---

# 23. Shareable Link Detection in Search

## 23.1 Current Problem

The application supports custom shareable media links.

These are application-specific deep links rather than conventional public media URLs.

Currently, when a user pastes one into the search bar, the application may treat it as ordinary search text.

This creates an unnecessary workflow:

```text
Copy shareable link
    ↓
Open browser
    ↓
Paste link
    ↓
Open application/link
```

The application should handle these links directly.

---

# 24. Smart Search Input Routing

When the user enters a supported CS3 shareable link into the search input, the application should recognize it before performing a normal search.

Conceptually:

```text
User enters text
       ↓
Input classifier
       ↓
Is this a supported CS3 shareable link?
       │
       ├── Yes → Open/decode shared media
       │
       └── No → Normal search
```

---

# 25. Supported Shareable Links

The detection system should recognize the application's supported custom deep-link format.

It should not assume that every URL is a shareable media link.

The system should distinguish between:

```text
Normal search text
Official website URL
Repository URL
External URL
CS3 shareable media link
Supported application deep link
```

Only recognized application-specific links should trigger direct media navigation.

---

# 26. Direct Navigation

When a valid shareable media link is entered:

```text
Search bar
    ↓
Recognized shareable link
    ↓
Decode / validate
    ↓
Resolve media information
    ↓
Open Media Details
```

The user should not need to press search multiple times or manually navigate through another interface.

---

# 27. Invalid Shareable Links

Invalid or corrupted links should not crash the application.

The application should provide a clear error such as:

```text
This shared link is invalid or has expired.
```

Normal search functionality should remain available.

---

# 28. Search History Delete Icon

## 28.1 Current Problem

The search-history dropdown contains a control for removing individual history entries.

However, the delete/cross icon is currently difficult or impossible to see.

The likely cause appears to be a visual contrast issue where:

```text
Icon color ≈ Background color
```

or the hover/focus state is not correctly applied.

This needs to be investigated rather than simply changing the icon blindly.

---

# 29. Search History Hover/Focus Behavior

When the user moves the mouse over a search-history item:

```text
History item
    ↓
Hover/focus state
    ↓
Delete icon becomes visible
```

The delete control should be:

- Clearly visible
- Visually associated with that history item
- Accessible by keyboard focus
- Clickable without selecting/searching the item accidentally
- Hidden or subtle when the item is inactive
- Clearly visible on hover
- Clearly visible on keyboard focus

The existing icon should be retained if it is the intended delete control. The issue should be investigated at the styling and interaction level.

---

# 30. Search History Event Handling

Clicking the delete icon should:

```text
Delete icon
    ↓
Remove that history item
    ↓
Update history state
    ↓
Update UI immediately
```

It must not:

- Trigger the search
- Open the history item
- Close the wrong menu
- Trigger parent click handlers
- Cause duplicate events

---

# 31. Search Sources: Bulk Selection Controls

## 31.1 Current Problem

The Search Sources modal currently provides source selection, but there is no convenient way to:

- Select all
- Select none
- Invert/reverse the current selection

This becomes increasingly inconvenient as the number of sources grows.

---

# 32. Required Selection Actions

The Search Sources interface should provide lightweight controls for:

```text
Select All
Select None
Invert Selection
```

The exact presentation can be optimized based on the current UI.

The controls should not dominate the modal.

---

# 33. Ambient Selection UI

The current Search Sources UI is already relatively clean.

The new controls should preserve that quality.

They should:

- Occupy minimal space
- Avoid large buttons
- Avoid unnecessary labels
- Use familiar icons where appropriate
- Provide tooltips
- Have clear hover/focus states
- Remain accessible
- Not compete visually with the source list

Possible conceptual layout:

```text
Search Sources

[ Select All ] [ None ] [ Invert ]

Filters change what this list shows.
Ticking a source is what narrows the search.

☑ Provider A
☑ Provider B
☐ Provider C
...
```

The final visual implementation should follow the application's existing design language.

---

# 34. Selection State Consistency

Bulk actions must correctly update:

- Visible sources
- Filtered sources
- Selected source state
- Search execution state
- Persisted selection preferences where applicable

If the list is filtered, the system must clearly define whether "Select All" applies to:

1. All available sources, or
2. Only currently visible/filtered sources.

The behavior should be explicit and consistent.

---

# 35. Trailer Playback Improvements

## 35.1 Current Problem

Trailers and other promotional videos opened from the Media Details screen have playback synchronization issues.

For example:

```text
Media Details
    ↓
Official Trailer
    ↓
Trailer Player
```

The audio and video can become out of sync.

The problem may become more noticeable when the user:

- Seeks forward
- Seeks backward
- Repeatedly seeks
- Pauses/resumes
- Changes playback position quickly

This needs to be investigated at the player and media pipeline level rather than patched only at the UI level.

---

# 36. Trailer Audio/Video Synchronization

The trailer player must maintain synchronization between:

```text
Video timestamp
Audio timestamp
Playback clock
Seek position
Buffer state
```

After seeking:

```text
Seek requested
    ↓
Cancel/replace previous seek if required
    ↓
Synchronize media tracks
    ↓
Update playback clock
    ↓
Resume playback from requested position
```

The implementation must avoid stale asynchronous seek operations overriding newer ones.

---

# 37. Investigate Root Cause

The implementation should first identify the actual source of synchronization problems.

Investigate:

- Player engine
- Media element behavior
- Source format
- HLS/DASH/progressive playback
- Trailer source redirects
- Audio track handling
- Video track handling
- Timestamp discontinuities
- Codec/container compatibility
- Seeking implementation
- Multiple simultaneous seek requests
- Buffer flushing
- Source replacement
- Player recreation
- Playback-rate changes
- Event ordering
- `timeupdate`
- `seeking`
- `seeked`
- `canplay`
- `playing`
- `waiting`
- `stalled`
- `ended`

Do not assume the issue is purely a CSS/UI problem.

---

# 38. Trailer Seeking

Trailer seeking should use the same robust seeking architecture as the main player where possible.

Requirements:

- Forward seeking works correctly
- Backward seeking works correctly
- Repeated seeks accumulate correctly
- Seeking does not restart the trailer
- Audio and video remain synchronized
- Rapid seeking does not create race conditions
- Seeking near the beginning clamps to zero
- Seeking near the end clamps to the available duration
- Seeking during buffering behaves correctly

---

# 39. Trailer Mini Player

## 39.1 Current Problem

The trailer player currently provides a close action, but there is no way to minimize the player.

This forces the user to completely close the trailer before navigating elsewhere.

---

# 40. Required Trailer Mini-Player Behavior

The trailer player should support:

```text
Open Trailer
    ↓
Full Trailer Player
    ↓
Minimize
    ↓
Mini Player
    ↓
User continues navigating application
```

The user should be able to continue browsing while the trailer remains available.

---

# 41. Mini-Player Requirements

The mini-player should:

- Continue playback
- Preserve playback position
- Preserve audio/video synchronization
- Remain visible above normal application content
- Be movable or positioned consistently according to the application design
- Provide Play/Pause
- Provide Close
- Provide Expand/Restore
- Show basic trailer information
- Avoid blocking important content
- Respect fullscreen state
- Respect application navigation

---

# 42. Trailer Player State

The application should distinguish between:

```text
Closed
Full Player
Minimized
```

Example:

```text
Trailer closed
     ↓
Open trailer
     ↓
Full player
     ↓
Minimize
     ↓
Mini player
     ↓
Restore
     ↓
Full player
     ↓
Close
     ↓
Trailer closed
```

Navigation between application screens should not unexpectedly destroy the trailer session.

---

# 43. Provider Security and Human Verification

## 43.1 Current Problem

Some providers and extensions use security systems designed to prevent automated scraping.

These may include:

- Cloud-based bot protection
- Browser verification
- CAPTCHA challenges
- JavaScript/browser challenges
- Cookie-based verification
- Temporary access tokens
- Other anti-automation mechanisms

When a provider requires human verification, the current desktop experience may simply fail to retrieve sources.

The Android CloudStream ecosystem has workflows where users can interact with the provider through a browser/WebView-like environment, complete required verification, and retain the resulting session information so subsequent requests can work.

We need to investigate the existing Android implementation and determine how this behavior can be represented appropriately in the desktop architecture.

---

# 44. Important Security Principle

The desktop application should **not attempt to automatically defeat, bypass, or circumvent provider security mechanisms**.

Instead, when a provider legitimately requires human verification, the application should provide a first-class user-assisted verification flow.

The goal is:

```text
Provider requires human verification
        ↓
Application detects challenge
        ↓
Application informs user
        ↓
Open provider verification page
        ↓
User completes required verification
        ↓
Session/cookies are stored securely where permitted
        ↓
Retry provider request
        ↓
Continue source discovery
```

This provides a good user experience without attempting to automate CAPTCHA solving or circumvent security protections.

---

# 45. Desktop Verification Flow

The desktop application should provide a centralized verification mechanism.

The user should not need to understand:

- Which extension failed
- Which provider is responsible
- Where cookies are stored
- Which browser needs to be opened
- How the extension internally works
- Which technical request failed

Instead:

```text
Source discovery
      ↓
Provider requires verification
      ↓
CS3 detects challenge
      ↓
Verification Required
      ↓
[ Verify Provider ]
      ↓
Provider verification window
      ↓
User completes verification
      ↓
Session saved
      ↓
[ Continue ]
      ↓
Source discovery resumes
```

---

# 46. Verification Window

The verification experience should be integrated into the desktop application as much as technically and legally appropriate.

It should clearly show:

```text
Provider Verification Required

This provider requires a browser verification step
before CS3 can retrieve its sources.

[ Open Verification ]

After completing verification:
[ Continue ]
```

The interface should explain that the user is interacting with the provider's own verification system.

---

# 47. Session and Cookie Persistence

When the provider permits it, the application should securely retain the session state required to avoid repeatedly asking the user to verify.

The stored information may include:

- Cookies
- Session identifiers
- Provider-specific authentication state
- Relevant local storage/session state where required and permitted

The information must be:

- Stored securely
- Scoped to the appropriate provider/domain
- Protected from unrelated providers
- Excluded from normal debug logs
- Excluded from exported diagnostics unless explicitly required and approved
- Included in backup only if the application's privacy/security architecture explicitly permits it

Sensitive authentication information must never be printed into normal application logs.

---

# 48. Provider-Specific Session Isolation

Provider sessions must remain isolated.

For example:

```text
Provider A
    └── Cookies A

Provider B
    └── Cookies B

Provider C
    └── Cookies C
```

The application must not accidentally share cookies or authentication state between unrelated domains.

---

# 49. Challenge Detection

The provider/network layer should detect likely verification requirements based on appropriate signals such as:

- Known challenge responses
- HTTP status
- Response headers
- Response content
- Provider-specific error information
- Browser-required navigation
- Authentication state

The system should not classify every HTTP error as a security challenge.

For example:

```text
404 → Source may be gone
403 → Could require verification, authorization, or may be permanently blocked
429 → Rate limiting
500 → Provider/server failure
Timeout → Network/provider issue
Challenge page → Human verification required
```

Each condition should have appropriate handling.

---

# 50. Resume Provider Discovery After Verification

After the user completes verification, the application should not force them to manually restart everything.

Preferred behavior:

```text
Provider search
    ↓
Verification required
    ↓
User completes verification
    ↓
Session stored
    ↓
Retry failed provider
    ↓
Continue source discovery
    ↓
New source appears in Select a Source
```

Previously discovered sources must remain visible throughout this process.

---

# 51. Verification State

The application should maintain a provider verification state such as:

```text
UNKNOWN
VERIFICATION_REQUIRED
VERIFYING
VERIFIED
EXPIRED
FAILED
```

This state should be independent from source validity.

A provider may be:

```text
Verified
```

while an individual source is:

```text
Expired
```

These concepts must not be conflated.

---

# 52. Verification Expiration

Provider verification may expire.

When this happens:

```text
Previously verified
      ↓
Session expires
      ↓
Provider requests verification
      ↓
Show verification UI
      ↓
User verifies again
      ↓
Update session
```

The application should avoid repeatedly opening verification windows for every source request.

---

# 53. Centralized Provider Verification Service

Instead of implementing verification logic separately inside every extension, the desktop application should provide a reusable provider verification/session service where possible.

Conceptually:

```text
Extension
   ↓
Provider Request
   ↓
Provider Session Manager
   ↓
HTTP / Browser Request
   ↓
Response
```

If a verification challenge is detected:

```text
Provider Session Manager
   ↓
Verification Coordinator
   ↓
Desktop Verification UI
   ↓
Updated Session
   ↓
Retry Request
```

This allows the desktop application to provide a consistent experience across extensions.

---

# 54. Extension Integration

Existing Android extensions should not need to be heavily modified simply to provide desktop verification UI.

The desktop compatibility layer should translate the Android/provider behavior into the desktop environment wherever practical.

The goal is:

```text
Android Extension
       ↓
Desktop Compatibility Layer
       ↓
Desktop Provider Runtime
       ↓
Desktop Session / Verification Manager
```

rather than requiring every extension to implement its own desktop-specific challenge interface.

---

# 55. Error Handling

Provider errors should be classified instead of displaying generic failures.

Examples:

```text
Source unavailable
Provider temporarily unavailable
Network timeout
Rate limited
Human verification required
Authentication expired
Source expired
Unsupported stream
Provider returned no sources
```

The user should receive an actionable message whenever possible.

For example:

```text
This provider requires verification before sources can be retrieved.

[ Verify Now ]
```

instead of:

```text
Failed to fetch sources.
```

---

# 56. Source Discovery + Verification Integration

The final architecture should connect source caching and verification.

Example:

```text
Open Select a Source
        ↓
Display cached sources immediately
        ↓
Start background provider discovery
        ↓
Provider A → Sources found
Provider B → Verification required
Provider C → Sources found
        ↓
Display A + C
        ↓
Show non-blocking verification notification
        ↓
User verifies Provider B
        ↓
Retry Provider B
        ↓
New sources discovered
        ↓
Append Provider B sources
```

The user should never lose the sources already discovered simply because another provider requires verification.

---

# 57. Unified Source Discovery State

The source-selection UI should be capable of representing multiple states simultaneously.

For example:

```text
Provider A
✓ 1080p
✓ 720p

Provider B
● Verification required

Provider C
⟳ Searching...

Provider D
✓ 720p
```

This is substantially better than showing a single global loading state.

---

# 58. Do Not Block Successful Providers

If one provider is slow or blocked, other providers must continue operating.

Bad:

```text
Provider A blocked
    ↓
Entire source search blocked
```

Preferred:

```text
Provider A → Verification required
Provider B → Searching
Provider C → Sources found
Provider D → Sources found
```

The user can already select sources from Providers C and D while Provider A is waiting for verification.

---

# 59. Cross-Feature Architecture

The following systems should share common infrastructure instead of implementing separate solutions:

```text
                    ┌── Source Cache
                    │
                    ├── Source Validation
                    │
Provider Runtime ───┼── Provider Session Manager
                    │
                    ├── Verification Manager
                    │
                    ├── Source Discovery
                    │
                    └── Error Classification
```

This will reduce duplicated logic and make the system easier to maintain.

---

# 60. Performance Requirements

The implementation should avoid unnecessary network activity.

The application should:

- Reuse valid cached sources
- Avoid repeated provider requests
- Avoid duplicate concurrent searches
- Deduplicate sources
- Cache provider state where appropriate
- Perform refreshes asynchronously
- Keep UI responsive
- Avoid blocking the renderer
- Cancel obsolete requests
- Avoid unnecessary re-rendering
- Avoid repeatedly rebuilding large source lists

---

# 61. Concurrency and Race Conditions

The source system must be designed carefully around asynchronous operations.

Potential race condition:

```text
Request A starts
Request B starts
Request B completes first
Request A completes later
Request A clears/replaces B's results
```

This must not happen.

Results should be merged into a stable source state.

Likewise:

```text
Refresh 1
Refresh 2
Playback validation
Provider retry
```

must not allow an older operation to overwrite newer information.

---

# 62. Cancellation

When the user closes the source-selection dialog, the application should decide whether discovery continues in the background.

The preferred behavior is:

- Keep useful discovery running where it provides value
- Cancel unnecessary UI-bound work
- Preserve already discovered results
- Never delete cached sources because a UI request was cancelled

A cancelled search should not be treated as a failed source.

---

# 63. Persistent State Across Application Restarts

Where appropriate, healthy source metadata should survive application restarts.

For example:

```text
Day 1
Provider A → Source discovered

Application closed

Day 2
Open Media Details
    ↓
Source still available from cache
    ↓
Background validation
```

Temporary URLs should be refreshed when necessary, while the source identity and provider relationship should remain available.

---

# 64. Observability and Diagnostics

The application should log enough information to diagnose source problems without exposing sensitive information.

Useful diagnostics include:

- Provider
- Source type
- Source state
- Discovery timestamp
- Validation result
- HTTP status
- Failure classification
- Retry count
- Verification-required state
- Cache state

Sensitive information such as:

- Cookies
- Authentication tokens
- Session secrets
- Signed URLs where sensitive

must be redacted.

---

# 65. Acceptance Criteria: Source System

The implementation is successful when:

- Opening Select a Source does not clear previously discovered sources.
- Cached valid sources appear immediately.
- New sources are added progressively.
- Duplicate sources are not created.
- Temporary failures do not immediately delete sources.
- Confirmed expired/invalid sources can be removed or replaced.
- Expired URLs can trigger source refresh.
- Background refresh does not block the source-selection UI.
- One provider failing does not remove sources from other providers.
- Provider verification does not block already discovered sources.
- Source state survives application restart where appropriate.
- Race conditions do not cause newer results to disappear.
- The system does not repeatedly fetch the same sources unnecessarily.

---

# 66. Acceptance Criteria: More Like This

- More Like This has a Show All action.
- Show All opens a dedicated results view.
- The first page loads quickly.
- Additional results load as the user scrolls.
- Results are appended rather than replacing existing items.
- Duplicate media items are removed.
- Pagination does not trigger duplicate requests.
- Failed pagination requests can be retried.
- The system stops requesting when no more results exist.
- The same reusable pagination mechanism can be used elsewhere.

---

# 67. Acceptance Criteria: Scroll to Top

- The control is hidden when the user is at the top.
- It appears after the user scrolls sufficiently.
- It remains unobtrusive.
- Clicking it returns the primary page to position `0`.
- The correct scroll container is targeted.
- It works across major application screens.
- It does not interfere with other controls.
- It supports mouse and keyboard accessibility.
- It disappears again after returning to the top.

---

# 68. Acceptance Criteria: Shareable Links

- Supported CS3 shareable links are detected automatically.
- They are not treated as normal search queries.
- Valid links open the appropriate media page.
- Invalid links fail gracefully.
- Normal URLs continue behaving normally.
- Normal search text continues behaving normally.
- No browser copy/paste workflow is required.
- The same detection logic can be reused wherever search input exists.

---

# 69. Acceptance Criteria: Search History

- The delete icon is visible on hover.
- The delete icon is visible on keyboard focus.
- The icon has sufficient contrast.
- The icon does not blend into the background.
- Clicking it removes only the selected history entry.
- Clicking delete does not trigger the search.
- The UI updates immediately after deletion.

---

# 70. Acceptance Criteria: Search Sources

- Select All is available.
- Select None is available.
- Invert Selection is available.
- Controls are visually subtle.
- Controls do not dominate the modal.
- Selection state updates immediately.
- Bulk operations do not cause duplicate searches.
- Filtered and unfiltered states behave predictably.

---

# 71. Acceptance Criteria: Trailer Player

- Trailer playback remains audio/video synchronized.
- Forward seeking works.
- Backward seeking works.
- Repeated seeking works correctly.
- Seeking does not restart playback.
- Player state remains stable during rapid seeking.
- Trailer playback can be minimized.
- Mini-player continues playback.
- User can navigate other screens while the trailer continues.
- Trailer can be restored to full view.
- Trailer can be closed completely.
- Fullscreen and minimized states do not corrupt playback state.

---

# 72. Acceptance Criteria: Provider Verification

- Provider security challenges are detected where possible.
- The application clearly informs the user when human verification is required.
- The user can open the provider's verification flow without navigating manually through individual extensions.
- User verification can establish the provider session where technically and legally permitted.
- Relevant cookies/session information is securely retained where appropriate.
- Sensitive session information is never exposed in logs.
- Provider sessions are isolated.
- Verification can expire and be renewed.
- Successful verification automatically retries the affected provider.
- Existing sources remain visible during verification.
- One blocked provider does not block all other providers.
- The application does not attempt to automatically solve CAPTCHA or bypass provider security protections.

---

# 73. Overall UX Goal

The application should move away from a model where every interaction starts from a clean state and instead behave like a mature, stateful media platform.

The desired experience is:

```text
User opens media
        ↓
Previously discovered sources appear immediately
        ↓
Background discovery finds additional sources
        ↓
Healthy sources remain available
        ↓
Expired sources are refreshed intelligently
        ↓
Blocked providers request user verification
        ↓
Verification resumes discovery automatically
        ↓
User can select a source without waiting
```

For media discovery:

```text
More Like This
        ↓
Show All
        ↓
Initial results
        ↓
Scroll
        ↓
More results
        ↓
Scroll
        ↓
More results
```

For navigation:

```text
User scrolls deeply
        ↓
Subtle ↑ button appears
        ↓
User clicks
        ↓
Smoothly returns to top
```

For shared content:

```text
Paste CS3 shareable link
        ↓
Application recognizes it
        ↓
Resolve shared content
        ↓
Open media page
```

For trailers:

```text
Open Trailer
        ↓
Play
        ↓
Seek reliably
        ↓
Audio/video remain synchronized
        ↓
Minimize
        ↓
Continue browsing
        ↓
Restore or close
```

For provider protection:

```text
Provider requires human verification
        ↓
CS3 detects it
        ↓
User receives clear verification prompt
        ↓
User verifies through the provider
        ↓
Session is securely retained
        ↓
Provider request resumes
        ↓
Sources appear without restarting the entire workflow
```

The overall objective is to make these systems **persistent, incremental, non-destructive, asynchronous, reusable, and resilient** rather than repeatedly clearing state, refetching everything, blocking the UI, or forcing users to repeat actions they have already completed.

---

# 31. Media Player: Buffer Ahead & Cache Duration Indicator

## 31.1 Problem & Motivation
In both the native mpv engine and the built-in HTML5 player, media streams buffer network packets ahead into memory. While the progress bar renders a background buffer line, users cannot accurately gauge **how much usable time is safely banked in cache**.
- Users fast-forwarding or scrubbing blindly encounter sudden network stalls when seeking beyond the cached boundary.
- Users on unstable network connections or high-bitrate releases cannot tell whether pausing has accumulated enough buffer to resume smooth playback.

## 31.2 Core Requirement: Real-Time Buffer Ahead Readout
The player UI must provide an explicit, human-readable indicator showing the duration of media currently cached ahead of the playhead:

```text
Playhead Position: 12:45
Buffer Boundary:   15:15
Buffer Ahead:      +2m 30s
```

### 31.3 Multi-Unit Adaptive Time Formatting
The buffer ahead indicator must automatically adapt its formatting based on magnitude:
- **Seconds ($< 60\text{s}$):** Displayed as `+45s buffered` or `Buffer: 45s`.
- **Minutes ($1\text{m} - 59\text{m}$):** Displayed as `+2m 30s buffered` or `Buffer: 2m 30s`.
- **Hours ($\ge 60\text{m}$):** Displayed as `+1h 15m buffered` or `Buffer: 1h 15m`.

### 31.4 Visual Placement & UX Integration
1. **Primary Control Bar Readout:** Positioned adjacent to the playback timecode or integrated into the seekbar HUD.
2. **Timeline Scrubber Feedback:** Displayed when hovering over the buffer track on the seekbar, informing the user of the exact maximum instantaneous seek point without network wait.
3. **Buffering State Indicator:** When playback pauses for cache, the readout dynamically highlights the accumulating buffer ahead until the target playback threshold is reached.
4. **Subtle Enterprise Aesthetic:** Rendered with lightweight typography, non-intrusive muted coloring, and high contrast against dark video backdrops.

### 31.5 Dual-Engine Synchronization
- **Native Engine (`mpv`):** Sourced from mpv's demuxer cache duration properties (`demuxer-cache-time` / `demuxer-cache-state`), representing the active memory buffer maintained by mpv's internal readahead engine.
- **Web Engine (`HTML5 <video>`):** Sourced from the active `TimeRanges` buffer collection of the video element (`video.buffered`), calculating the delta between current position and the contiguous buffer segment end.

---

# 32. Timeline Time Display Toggle: Elapsed vs. Remaining Time

## 32.1 Problem & Industry Standard
Traditional players often lock the time display to a static `Current / Total` readout. Leading desktop media software (such as VLC Media Player, MPC-HC, and modern streaming interfaces) provide an interactive time display that allows users to seamlessly switch between elapsed time and remaining time.

## 32.2 Core Requirement: Click-to-Toggle Time Modes
The timecode container in the player toolbar must be an interactive control that cycles through time display representations upon clicking:

```text
Mode 1 (Standard):
12:45 / 1:45:00  (Elapsed Time / Total Duration)

     [User Clicks Timecode]
              ↓

Mode 2 (Remaining Time):
12:45 / -1:32:15 (Elapsed Time / Time Remaining with Negative Indicator)

     [User Clicks Timecode]
              ↓

Mode 3 (Compact Remaining):
-1:32:15         (Time Remaining Focused View)
```

### 32.3 Accessibility & Hover Feedback
- **Cursor Affordance:** The time display must present a pointer cursor on hover with a subtle background highlight indicating interactivity.
- **Tooltip Hint:** A tooltip must clearly communicate the action: `"Click to toggle remaining time"` or `"Click to switch time format"`.
- **Keyboard Shortcut Support:** Optional keybinding (e.g. `t` or clicking) to toggle time modes without mouse interaction.

### 32.4 State Persistence Across Sessions
- The user's preferred time display mode (Elapsed vs Remaining) must be persisted in user preferences.
- When navigating to another episode or starting a new movie, the player must remember the chosen mode rather than resetting to default.
- Both the main player toolbar (`.player__time`) and the floating mini-player bar (`.player-mini__time`) must respect and synchronize with this preference.

---

# 33. File Reference Directory & Module Responsibilities

The following directory maps the buffer ahead indicator and timeline toggle requirements to their exact files and components in the codebase. No source code modifications or implementation snippets are included; this directory provides immediate orientation for implementation.

| Component / Requirement | File Path | Line Range of Interest | Responsibility / Architectural Role |
|---|---|---|---|
| **Player Timeline & Time Readouts** | `cs3_windows/src/components/VideoPlayer.tsx` | `L4645–L4660`, `L4520–L4560` | Primary timecode display (`player__time`), seekbar buffer track, click toggle interaction, and buffer-ahead calculations. |
| **Mini-Player Time Display** | `cs3_windows/src/components/VideoPlayer.tsx` | `L3730–L3745` | Floating and mini-player timecode container (`player-mini__time`) and synchronized time toggle handling. |
| **Time & Duration Formatting Utilities** | `cs3_windows/src/utils/format.ts` | `L1–L80` | Formatting functions for timecodes (`formatTimecode`), remaining time format (`-hh:mm:ss`), and adaptive buffer strings. |
| **Player Toolbar & Seekbar Styles** | `cs3_windows/src/sources.css` | `L2810–L2840`, `L4500–L4550` | Styling for `.player__time`, interactive cursor states, tooltip feedback, and buffer ahead badge typography. |
| **Native mpv Cache & Buffer Observation** | `cs3_windows/electron/media/mpvEngine.ts` | `L70–L92`, `L1005–L1030` | mpv property observation (`demuxer-cache-time`, `time-pos`), snapshot assembly, and buffer duration reporting over IPC. |
| **Native Playback Snapshot Types** | `cs3_windows/src/types/mpv.ts` | `L1–L60` | Type definitions for `MpvSnapshot` including `positionSeconds`, `durationSeconds`, and `bufferedSeconds`. |
| **Player Preferences Store** | `cs3_windows/src/types/player.ts` | `L1–L80` | Configuration schema for persisting user time display mode (`elapsed_total` vs `elapsed_remaining`). |
| **Native Engine React Stage** | `cs3_windows/src/components/player/NativeEngineStage.tsx` | `L35–L65`, `L90–L120` | Native playback state consumption, progress synchronization, and bridge to player control bar. |

---

# 34. Chronological Movie Series, Franchises, and Cinematic Universes

## 34.1 Problem & Motivation
Many major film franchises do not use simple numerical titles. Instead, each installment carries a distinct subtitle:
- **Harry Potter:** *Philosopher's Stone (2001)* $\to$ *Chamber of Secrets (2002)* $\to$ *Prisoner of Azkaban (2004)* $\to$ *Goblet of Fire (2005)* $\to$ *Order of the Phoenix (2007)* $\to$ *Half-Blood Prince (2009)* $\to$ *Deathly Hallows: Part 1 (2010)* $\to$ *Deathly Hallows: Part 2 (2011)*.
- **Batman / The Dark Knight:** *Batman Begins (2005)* $\to$ *The Dark Knight (2008)* $\to$ *The Dark Knight Rises (2012)*.
- **X-Men:** *X-Men (2000)* $\to$ *X2 (2003)* $\to$ *The Last Stand (2006)* $\to$ *First Class (2011)* $\to$ *Days of Future Past (2014)* $\to$ *Apocalypse (2016)* $\to$ *Logan (2017)* $\to$ *Dark Phoenix (2019)*.
- **Spider-Man:** *Spider-Man (2002)* $\to$ *Spider-Man 2 (2004)* $\to$ *Spider-Man 3 (2007)* / *Homecoming (2017)* $\to$ *Far From Home (2019)* $\to$ *No Way Home (2021)*.
- **Star Wars:** *A New Hope (1977)* $\to$ *The Empire Strikes Back (1980)* $\to$ *Return of the Jedi (1983)* / Prequels / Sequels.
- **Marvel Cinematic Universe (MCU):** Character arcs such as *Iron Man (1, 2, 3)*, *Captain America*, *Thor*, and crossover films.

When a viewer searches for or opens a specific title (e.g. *Harry Potter and the Chamber of Secrets*), they currently only see unrelated genre recommendations in "More like this". They have no quick way to identify:
1. Which part of the series they are currently looking at.
2. Which movie immediately preceded it (the prequel).
3. Which movie immediately follows it (the sequel).
4. The complete chronological timeline of the franchise from beginning to end.

## 34.2 Core Requirement: Franchise Collection Rail
On the media Details screen, when the active title belongs to a known movie franchise, collection, or cinematic universe, a dedicated **Chronological Series & Universe** rail must be displayed:

```text
Harry Potter and the Chamber of Secrets
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Part of the Harry Potter Series (2 of 8)

┌────────────┐  ┌────────────┐  ┌────────────┐  ┌────────────┐
│   Part 1   │  │   Part 2   │  │   Part 3   │  │   Part 4   │
│  (Prequel) │  │  CURRENT   │  │  (Sequel)  │  │            │
│ Philosopher│  │  Chamber   │  │  Prisoner  │  │   Goblet   │
│   (2001)   │  │   (2002)   │  │   (2004)   │  │   (2005)   │
└────────────┘  └────────────┘  └────────────┘  └────────────┘
```

The user must be able to click any installment in the collection to immediately navigate to its Details screen, view its metadata, trailers, and stream or download it with one click.

---

# 35. Public Keyless Metadata Sourcing Strategy

To adhere strictly to CS3's architectural principles (no user API keys, no bundled proprietary tokens, no license violations):

### 35.1 Primary Source: Wikidata SPARQL Endpoint (100% Keyless, CC0)
Wikidata models film series, franchises, prequels, and sequels as first-class semantic statements:
- **`wdt:P179` (Part of the Series):** Connects an individual movie (e.g. *Chamber of Secrets*) to its overarching franchise entity (e.g. *Harry Potter film series*).
- **`pq:P1545` (Series Ordinal):** Identifies the exact chronological sequence number (`1`, `2`, `3`...).
- **`wdt:P155` (Follows / Preceded By):** Explicitly names the immediate prequel film.
- **`wdt:P156` (Followed By / Sequel):** Explicitly names the immediate sequel film.
- **`wdt:P577` (Publication Date):** Provides the official release date, enabling reliable chronological sorting by release timestamp.
- **`wdt:P345` (IMDb ID):** Provides the universal identifier (`tt...`) to cross-reference poster artwork and media sources in CS3.

Because CS3's metadata pipeline already utilizes Wikidata (`electron/metadata/wikidata.ts`), franchise queries leverage existing transport infrastructure with zero new external dependencies.

### 35.2 Poster Artwork & Item Resolution via Cinemeta
Once a franchise query produces the chronological sequence of IMDb IDs:
- The items are cross-referenced with Cinemeta (`https://v3-cinemeta.strem.io/`) to obtain high-resolution poster art, display titles, and release years.
- Each item is assigned its native `cs3meta://cinemeta/movie/{imdbId}` address so it integrates seamlessly with the existing navigation and playback system.

### 35.3 TMDB Collection Integration (`belongs_to_collection`)
For environments where TMDB data is available:
- TMDB's `belongs_to_collection` object links directly to a collection ID (e.g. `1241` for Harry Potter).
- The collection endpoint returns all `parts`, which are sorted by `release_date` ascending to guarantee chronological ordering.

### 35.4 Fallback: Lexical Franchise Clustering
If remote knowledge graphs have no collection entity for an obscure franchise:
- The system groups titles from installed providers and Cinemeta that share significant title prefixes (e.g. `"Iron Man"`, `"Ip Man"`, `"Twilight"`).
- Releases are ordered chronologically by release year.

---

# 36. Detail View UI/UX Specification for Chronological Collections

### 36.1 Visual Placement & Hierarchy
1. **Prominent Placement:** Positioned directly beneath media trailers/overview and above general "More like this" recommendations. Franchise installments are far more relevant to a viewer than generic recommendations.
2. **Clear Contextual Heading:** Displays the franchise name and position:
   - Example: `"Part of the Harry Potter Film Series (Part 2 of 8)"`
   - Example: `"The Dark Knight Trilogy (Part 2 of 3)"`
   - Example: `"Spider-Man Collection · Chronological Release Order"`

### 36.2 Card Presentation & Badging
Each movie card within the franchise rail features:
- **Card Artwork:** High-resolution vertical poster thumbnail.
- **Title & Year:** Film title and release year.
- **Status Badges:**
  - **Currently Viewing:** Highlighted border with an active indicator badge (`● Current`).
  - **Prequel / Preceding Part:** Visual cue indicating it directly preceded the current title.
  - **Sequel / Next Part:** Visual cue indicating it directly follows the current title.
  - **Chronological Ordinal:** `Part 1`, `Part 2`, `Part 3`...

### 36.3 Navigation & Interaction
- **One-Click Navigation:** Clicking any card invokes `onSelectMedia`, immediately navigating to that movie's Details page without requiring manual searching.
- **Horizontal Scroll Rail:** Smooth horizontal scrolling with mouse wheel, touch/drag, and keyboard arrow keys, matching CS3's standard media rails.

---

# 37. File Reference Directory & Module Responsibilities

The following directory maps the chronological movie series and franchise requirements to their exact files and components in the codebase. No source code modifications or implementation snippets are included; this directory provides immediate orientation for implementation.

| Component / Requirement | File Path | Line Range of Interest | Responsibility / Architectural Role |
|---|---|---|---|
| **Media Details Page View** | `cs3_windows/src/views/DetailView.tsx` | `L1930–L1960`, `L165–L175` | Renders the chronological franchise rail, cards, active movie badge, and installment navigation. |
| **Poster Card Component** | `cs3_windows/src/components/PosterCard.tsx` | `L1–L120` | Renders individual movie poster cards with custom franchise badges and chronological labels. |
| **Extended Metadata Types** | `cs3_windows/src/types/metadata.ts` | `L410–L460` | Type definitions for `ExtendedMetadata`, including `MovieCollection` and `CollectionPart` schemas. |
| **Wikidata Franchise Enrichment** | `cs3_windows/electron/metadata/wikidata.ts` | `L60–L120`, `L200–L250` | SPARQL query definitions for series entities (`P179`), ordinals (`P1545`), prequels (`P155`), and sequels (`P156`). |
| **Metadata Enrichment Service** | `cs3_windows/electron/metadata/enrichmentService.ts` | `L55–L110`, `L250–L310` | Coordinates franchise fetching, caching, and merging into the title's extended metadata record. |
| **Cinemeta Metadata & Artwork** | `cs3_windows/electron/cinemeta.ts` | `L55–L85`, `L160–L200` | Resolves posters, titles, and release years for franchise IMDb IDs without requiring API keys. |
| **Detail View Styles** | `cs3_windows/src/sources.css` | `L2800–L2850`, `L7150–L7190` | Layout, badges, and typography for `.detail-collection`, franchise headings, and active borders. |
