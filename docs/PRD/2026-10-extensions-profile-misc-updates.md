Detail View UI/UX: Stable Layout and Consistent Loading Placeholders
Improve the media detail view to eliminate layout shifts, flickering, and vertical movement while fetching metadata from multiple external APIs and sources.
The detail view displays media information such as the poster, background artwork, ratings, title, description or plot, genres, cast, trailers, and other metadata. Since these elements may load asynchronously and at different times, the current layout can shift vertically when individual fields appear, update, or remain unavailable.
Requirements

1. Stable Layout: Establish a consistent layout for the detail view before asynchronous metadata requests complete. Loading, updating, or failing to retrieve individual fields must not cause the entire screen or main media information section to jump, resize unexpectedly, or flicker.
2. Consistent Placeholders: Provide appropriately sized skeletons, placeholders, or reserved spaces for metadata that has not yet loaded, including ratings, descriptions, genres, cast, and other relevant sections. Placeholders should match the expected content dimensions and visual hierarchy.
3. Progressive Rendering: Render each metadata field as soon as its data becomes available, without waiting for every external API to finish. Replace its corresponding placeholder smoothly while preserving the existing layout.
4. Protect the Main Media Banner: Keep the main poster or background, title, primary information, and essential actions in stable positions. Late-arriving metadata must not push these elements up or down or cause noticeable movement in the banner.
5. Handle Missing Data Gracefully: If a metadata request fails, returns empty data, or does not provide a particular field, avoid repeated loading animations, collapsing spaces that cause layout shifts, or displaying broken placeholders indefinitely. Use an appropriate empty state or omit optional content without destabilizing the rest of the layout.
6. Consistent Dimensions: Define predictable sizing, spacing, and alignment for metadata sections. Descriptions should use an intentional layout, and ratings, genres, cast lists, and trailers should not unexpectedly change the dimensions of unrelated sections when they load.
7. Asynchronous Request Management: Inspect how external API responses update the detail view. Prevent unnecessary re-renders, duplicate updates, race conditions, and repeated loading-state changes that contribute to flickering or layout instability.
8. Smooth Updates: Transition from placeholders to actual content without unnecessary animations, flashing, or abrupt layout changes. Avoid excessive skeleton animations or decorative loading effects.
9. Preserve Existing Functionality: Retain all current metadata sources, API integrations, ratings, descriptions, cast information, trailers, and other features. Focus on layout stability and rendering behavior rather than removing content or reducing functionality.
10. Consistent Experience: Apply the same layout stability principles to movies, series, and other supported media types, including when metadata arrives progressively or some sources are unavailable.

Implementation Guidelines
Inspect the existing detail view components, metadata fetching services, state management, CSS layout, and rendering lifecycle before making changes.
Identify the actual causes of vertical movement and flickering rather than simply adding more loading indicators. Prefer stable layout containers, reserved space for predictable content, appropriately sized skeleton placeholders, and isolated metadata section updates.
Do not reserve excessive blank space for optional content or force every section to occupy a fixed height regardless of its content. The objective is to balance stable positioning with responsive layouts and natural content flow.
Acceptance Criteria

* The detail view remains visually stable while multiple metadata APIs are loading.
* Ratings, descriptions, genres, cast, and other metadata can load independently.
* Late-arriving data does not cause noticeable vertical jumps in the main banner or essential media information.
* Missing or failed metadata does not leave broken placeholders or trigger repeated layout shifts.
* Placeholder dimensions and spacing remain consistent with the final content.
* Existing API integrations, metadata, and interactions continue to work.
* The layout remains responsive across supported window sizes.
* Regression testing covers slow responses, failed requests, partial metadata, out-of-order responses, and progressively loaded content.

Files / References (Optional)

* Detail view: `desktop/src/views/DetailView.tsx`
* Shared poster components: `desktop/src/components/Poster.tsx`, `desktop/src/components/PosterCard.tsx`
* Metadata and discovery services: Inspect the existing metadata fetching services and related API integrations.
* Styling: `desktop/src/sources.css` and any stylesheets or component-level styles used by the detail view.

Use the existing source code as the primary reference. Trace the metadata loading and rendering flow before implementing changes, and reuse shared components and established styling conventions wherever practical.
### Implementation Guidelines

Inspect the existing detail view components, metadata fetching services, state management, CSS layout, and rendering lifecycle before making changes.

Identify the actual causes of vertical movement and flickering rather than simply adding more loading indicators. Prefer stable layout containers, reserved space for predictable content, appropriately sized skeleton placeholders, and isolated metadata section updates.

Do not reserve excessive blank space for optional content or force every section to occupy a fixed height regardless of its content. The objective is to balance stable positioning with responsive layouts and natural content flow.

### Acceptance Criteria

- The detail view remains visually stable while multiple metadata APIs are loading.
- Ratings, descriptions, genres, cast, and other metadata can load independently.
- Late-arriving data does not cause noticeable vertical jumps in the main banner or essential media information.
- Missing or failed metadata does not leave broken placeholders or trigger repeated layout shifts.
- Placeholder dimensions and spacing remain consistent with the final content.
- Existing API integrations, metadata, and interactions continue to work.
- The layout remains responsive across supported window sizes.
- Regression testing covers slow responses, failed requests, partial metadata, out-of-order responses, and progressively loaded content.

### Files / References (Optional)

- **Detail view:** `desktop/src/views/DetailView.tsx`
- **Shared poster components:** `desktop/src/components/Poster.tsx`, `desktop/src/components/PosterCard.tsx`
- **Metadata and discovery services:** Inspect the existing metadata fetching services and related API integrations.
- **Styling:** `desktop/src/sources.css` and any stylesheets or component-level styles used by the detail view.

Use the existing source code as the primary reference. Trace the metadata loading and rendering flow before implementing changes, and reuse shared components and established styling conventions wherever practical.


---

### 4. Profiles and User Management

Build an **optional profile system** for CS3 inspired by the profile-management patterns used by modern streaming platforms such as Netflix, Prime Video, Disney+, and similar services.

The profile system must be an **optional feature**, not a requirement for using CS3.

The core principle is:

> **CS3 must always ship with a default profile and must always be usable without requiring profile setup, selection, login, PIN, or password.**

A user should be able to install CS3, launch it, and immediately use the application exactly as they can today. Profile management is an additional capability for users who want separate profiles.

### Default Profile and Zero-Friction Experience

Every CS3 installation must have a default profile.

On first launch:

```text
CS3 installed
    ↓
Default Profile automatically exists
    ↓
User enters the application immediately
```

Do not show a mandatory profile-selection screen.

Do not require the user to create a profile.

Do not require a profile name.

Do not require a PIN or password.

Do not block or delay access to the application because profile configuration has not been completed.

For a normal single-user installation, the default profile should behave naturally and require no additional interaction.

The profile system should become visible through the application's profile control, not by forcing the user through a setup flow.

### Profile Access from the Main UI

Place the active profile/avatar control in the **top-right area of the application**, following the common placement used by modern streaming platforms and applications for account/profile controls.

For example:

```text
┌─────────────────────────────────────────────────────────────┐
│  CS3                         Search        [Avatar ▼]       │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│                         Application                         │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

The default profile avatar should always be visible in this location.

Clicking the avatar should open the profile menu.

The profile control should clearly indicate which profile is currently active.

### Profile Menu

The profile menu should provide access to profile functionality without interrupting normal application usage.

For example:

```text
┌──────────────────────────────┐
│  [Avatar]  Default Profile   │
│                              │
│  Switch Profile              │
│  Manage Profiles             │
│  Add Profile                 │
│                              │
│  Profile Settings        >   │
└──────────────────────────────┘
```

The exact design should follow the existing CS3 UI and design system.

For a single-profile user, this menu should remain lightweight and should not make the application feel like a multi-user system.

### Profile Management

Users who want multiple profiles should be able to:

- Create a new profile.
- Edit an existing profile.
- Rename a profile.
- Change the profile avatar.
- Duplicate a profile where useful.
- Delete a profile.
- Switch between profiles.
- Optionally protect a profile with a PIN/password.

Profile creation should remain optional.

A profile should have a stable unique identifier independent of its display name.

### Profile Switching

Users should be able to switch profiles from the profile menu.

Switching should:

1. Change the active profile.
2. Persist the active profile.
3. Replace profile-specific in-memory state.
4. Load the selected profile's persisted state.
5. Refresh profile-dependent UI.
6. Update Continue Watching.
7. Update Library.
8. Update watch history and playback progress.
9. Update profile-specific preferences.
10. Ensure background operations use the newly active profile where applicable.

Switching profiles should not require restarting CS3.

### Profile Isolation

Each profile should have its own isolated context for user-specific data, including where supported:

- Library
- Continue Watching
- Watch history
- Playback progress
- Played-source history
- Saved/bookmarked titles
- Saved sources
- Recommendations
- Search/history state where applicable
- Preferences
- Playback preferences
- UI preferences
- Provider/source preferences where applicable
- Other user-specific application state

For example:

```text
Default Profile
    Library
    History
    Continue Watching
    Playback State
    Preferences

Profile 2
    Library
    History
    Continue Watching
    Playback State
    Preferences
```

Data must not unintentionally leak between profiles.

Profile isolation should exist at the persistence and service/state-management level, not only in the UI.

### Optional Profile Lock

Profile locking should also be **completely optional**.

A user may choose to protect any profile with a PIN or password.

Do not require a lock during profile creation.

A user should be able to use a profile indefinitely without setting any lock.

The profile lock should support:

- PIN
- Password
- Arbitrary user-selected input
- Any reasonable length supported by the implementation

There should be no unnecessary restriction such as requiring exactly 4 digits.

For convenience, recommend a simple PIN-style password by default, while still allowing users to choose a longer or more complex password if they prefer.

Example:

```text
Profile Lock

Protect this profile?
[ ] Enable profile lock

PIN or Password
[________________]

Confirm
[________________]

Recommendation:
A simple PIN is convenient for everyday profile switching.
```

The recommendation should not force a specific format.

### Profile Lock Behavior

When a profile is locked:

- The profile remains visible in the profile selector/menu.
- The profile identity/avatar can remain visible.
- Access to that profile's protected content requires authentication.
- The user should not be able to switch into the protected profile without entering the configured PIN/password.
- Other unlocked profiles should remain usable normally.

A locked profile must not expose protected profile-specific information unnecessarily.

For example, avoid displaying private Continue Watching or detailed history information for a locked profile where that would defeat the purpose of the lock.

### Lock Is Not Required for the Default Profile

The default profile must remain unlocked unless the user explicitly chooses to enable profile locking.

CS3 must never require a PIN/password simply because the profile system exists.

The default experience must remain:

```text
Install CS3
    ↓
Default Profile
    ↓
Use CS3
```

Optional:

```text
User wants multiple profiles
    ↓
Create profiles

User wants privacy
    ↓
Optionally enable profile lock
```

### Profile Duplication

Profile duplication should be optional and should have clearly defined behavior.

Only copy information that makes sense to duplicate.

For example, profile duplication may copy:

- Profile preferences
- UI preferences
- Playback preferences

It should not blindly copy personal viewing information such as:

- Watch history
- Continue Watching
- Playback progress
- Personal library
- Recommendations
- Played-source history

The final duplication behavior should be defined explicitly in the implementation.

### Profile Avatars

Provide a predefined set of profile avatars.

The avatar should be consistently displayed in:

- Top-right profile control
- Profile selector
- Profile management
- Profile settings
- Other relevant profile surfaces

Do not require users to upload an image just to create a profile.

### First Launch and Existing Installations

For a new installation:

```text
No profiles exist
    ↓
Automatically create Default Profile
    ↓
Set it as active
    ↓
Open CS3
```

For existing CS3 installations, migrate existing user-specific data into the automatically created default profile.

Existing data should not be lost because of the introduction of profiles.

Where applicable, migrate:

- Library
- Watch history
- Continue Watching
- Resume positions
- Played-source information
- Bookmarks
- Preferences
- Other existing user-specific state

Migration should be safe and idempotent.

### Single-User Experience

The majority of users may never need multiple profiles.

The profile system must therefore remain unobtrusive for single-user installations.

For a single-profile user:

- CS3 opens directly into the default profile.
- No profile-selection screen is shown.
- No setup wizard is required.
- No PIN/password is required.
- The profile avatar simply acts as the entry point to profile management.
- Existing application workflows remain unchanged.

### Profile Context

Introduce a single reliable concept of the active profile.

Profile-aware application services should use the active profile context rather than independently determining which profile is active.

The architecture should follow a model similar to:

```text
Active Profile
      ↓
Profile Context
      ↓
Library / History / Playback / Preferences
      ↓
Profile-scoped Persistence
```

This should make it difficult for future features to accidentally write data to another profile.

### Playback and Background Operations

Profile switching must be handled safely when playback or background operations are active.

Inspect the existing playback session, library, played-source, download, cache, and background-operation architecture.

A playback session must remain associated with the profile that initiated it.

Background operations must not accidentally write progress, history, or other state to whichever profile happens to be active later.

Define and implement safe behavior for switching profiles while media is actively playing.

### Security and Privacy

Profiles are primarily a personalization and data-isolation mechanism.

Do not represent profile locking as a strong operating-system security boundary unless the implementation actually provides that level of protection.

However, the implementation must prevent accidental profile data exposure through:

- UI state
- Persistence
- IPC
- Stores
- Caches
- Playback sessions
- Background operations
- Recommendations
- Library queries
- History queries

A locked profile should not expose its protected information to another profile.

### Architecture Review

Before implementation, inspect the existing CS3 architecture, especially:

- Persistence layer
- React/Zustand stores
- Library state
- Playback state
- Playback sessions
- Played-source tracking
- Source cache
- Bookmarks
- Preferences
- IPC APIs
- Electron main/renderer boundaries
- Settings
- Existing migration/versioning mechanisms

Identify which existing state should become profile-scoped.

Do not create a parallel persistence system if the existing architecture can be extended cleanly.

### Acceptance Criteria

The feature should be considered complete when:

1. CS3 always ships with an automatically created default profile.
2. Users can immediately use CS3 without seeing a mandatory profile setup or selection screen.
3. The default profile is displayed through an avatar/profile control in the top-right area of the application.
4. Users can optionally create additional profiles.
5. Users can optionally switch between profiles.
6. Users can optionally rename, edit, duplicate, and delete profiles.
7. Each profile has a stable unique identifier.
8. Profile-specific data is isolated.
9. Library is isolated by profile.
10. Watch history is isolated by profile.
11. Continue Watching is isolated by profile.
12. Playback progress is isolated by profile.
13. Played-source history is isolated by profile.
14. Saved/bookmarked content is isolated by profile.
15. Profile-specific preferences are isolated by profile.
16. Switching profiles does not leak stale state from the previous profile.
17. Users can optionally protect a profile with a PIN/password.
18. Profile locks support both simple PIN-style passwords and longer arbitrary passwords.
19. Profile locking is never mandatory.
20. The default profile remains unlocked unless the user explicitly enables locking.
21. Locked profiles require authentication before entering them.
22. Locked profile information is not unnecessarily exposed to other profiles.
23. Existing user data is migrated into the default profile without loss.
24. Profile-aware background operations cannot accidentally write data to the wrong profile.
25. Relevant persistence, IPC, store, migration, profile-switching, and UI tests are added or updated.
26. Single-profile users experience essentially the same frictionless workflow as before profiles were introduced.

### Product Principle

The profile system should be treated as an **optional enhancement to CS3, not a prerequisite for using CS3**.

The default experience must always remain:

```text
Install → Open CS3 → Default Profile → Use the App
```

Additional functionality is opt-in:

```text
Want multiple users?
    → Add profiles

Want separate viewing history?
    → Use separate profiles

Want privacy?
    → Optionally lock a profile

Want to remain a single user?
    → Continue using the default profile with no additional setup
```

The implementation should provide the convenience and familiar UX of modern streaming-platform profiles while keeping CS3's existing single-user experience simple, immediate, and frictionless.




---

## UI/UX Refinement: Minimal, Clean, and Enterprise-Grade Experience

Review and improve the overall UI/UX across the application to create a clean, modern, intuitive, and visually consistent experience inspired by well-designed applications such as VS Code and Chrome.

The goal is to make the application **feature-complete without feeling feature-bloated**. Preserve all existing features, functionality, and capabilities while reducing unnecessary visual complexity, excessive information, oversized components, redundant controls, and competing visual elements.

### Design Principles

1. **Minimal and Clean Interface:** Reduce visual clutter, excessive spacing, oversized elements, unnecessary borders, prominent containers, and redundant controls. Maintain a balanced visual hierarchy with consistent sizing, spacing, typography, and styling across the application.

2. **Progressive Disclosure:** Do not display all available information, instructions, settings, and controls at once. Show only what users need for the current context. Move secondary information, advanced options, detailed explanations, and less frequently used actions into tooltips, popovers, hover interactions, contextual menus, expandable sections, or other appropriate UI patterns.

3. **Intuitive Interactions:** Improve the design and usability of interactive components, especially enable/disable controls, toggles, buttons, selectors, settings, and configuration panels. Their purpose and current state should be immediately understandable without requiring users to study the interface.

4. **Concise and Clear Content:** Keep labels, descriptions, instructions, tooltips, and helper text short, simple, and easy to understand at a glance. Avoid lengthy explanations, verbose descriptions, redundant information, and unnecessary instructional text. Use plain, direct language that communicates the purpose of a feature without overwhelming the interface.

5. **Subtle but Accessible Controls:** Keep frequently used actions easy to discover and access without making them visually dominant. Make secondary actions visually quieter while ensuring essential actions remain discoverable and accessible. Use contextual visibility where appropriate, without making important functionality difficult to find.

6. **Consistent Component Design:** Review existing components and establish consistent interaction patterns, visual hierarchy, spacing, sizing, states, and styling. Similar components should behave and look consistent throughout the application rather than using different patterns for the same purpose.

7. **Reduce Cognitive Load:** Users should be able to understand the interface and complete common tasks without needing to learn the application beforehand. Make functionality self-explanatory through clear labels, familiar interaction patterns, sensible defaults, and contextual guidance only when necessary.

8. **Preserve Functionality:** Do not remove existing features, capabilities, actions, configuration options, or essential information simply to achieve a minimal appearance. Refine how they are presented, organized, and accessed instead. Avoid unnecessary changes to underlying business logic or behavior.

### Implementation Guidelines

Review the application as a whole, including individual screens, shared components, dialogs, forms, settings panels, toolbars, menus, and other interactive elements.

Identify areas where the interface feels bloated, crowded, repetitive, visually dominant, or unnecessarily complicated. Prioritize improvements that meaningfully simplify the experience without compromising functionality, discoverability, accessibility, or usability.

Prefer contextual help over permanently visible explanations. Use tooltips or popovers for supplementary information, concise descriptions for primary context, and expandable sections for advanced or optional details. Ensure that these patterns are accessible and work appropriately across supported interaction methods, including keyboard and touch where applicable.

Avoid introducing unnecessary components, decorative elements, extra containers, excessive animations, or new layers of navigation merely to make the interface appear modern. Reuse and improve existing shared components wherever practical.

Follow the application's established design system and technical conventions. Make reusable improvements at the component level when appropriate so that the same refinement is applied consistently across all relevant screens.

### Expected Outcome

The final interface should feel lightweight, polished, professional, and intuitive, with a clear visual hierarchy and minimal unnecessary information. Users should immediately understand what matters, find common actions easily, and access additional functionality when needed without being overwhelmed.

**Success criterion:** Retain the full functionality of the application while making its interface significantly cleaner, more consistent, less visually dominant, and easier to use. Every visible element should serve a clear purpose, and every secondary detail should appear only when it adds value to the current interaction.

## Detail View UI/UX: Stable Layout and Consistent Loading Placeholders

Improve the media detail view to eliminate layout shifts, flickering, and vertical movement while fetching metadata from multiple external APIs and sources.

The detail view displays media information such as the poster, background artwork, ratings, title, description or plot, genres, cast, trailers, and other metadata. Since these elements may load asynchronously and at different times, the current layout can shift vertically when individual fields appear, update, or remain unavailable.

### Requirements

1. **Stable Layout:** Establish a consistent layout for the detail view before asynchronous metadata requests complete. Loading, updating, or failing to retrieve individual fields must not cause the entire screen or main media information section to jump, resize unexpectedly, or flicker.

2. **Consistent Placeholders:** Provide appropriately sized skeletons, placeholders, or reserved spaces for metadata that has not yet loaded, including ratings, descriptions, genres, cast, and other relevant sections. Placeholders should match the expected content dimensions and visual hierarchy.

3. **Progressive Rendering:** Render each metadata field as soon as its data becomes available, without waiting for every external API to finish. Replace its corresponding placeholder smoothly while preserving the existing layout.

4. **Protect the Main Media Banner:** Keep the main poster or background, title, primary information, and essential actions in stable positions. Late-arriving metadata must not push these elements up or down or cause noticeable movement in the banner.

5. **Handle Missing Data Gracefully:** If a metadata request fails, returns empty data, or does not provide a particular field, avoid repeated loading animations, collapsing spaces that cause layout shifts, or displaying broken placeholders indefinitely. Use an appropriate empty state or omit optional content without destabilizing the rest of the layout.

6. **Consistent Dimensions:** Define predictable sizing, spacing, and alignment for metadata sections. Descriptions should use an intentional layout, and ratings, genres, cast lists, and trailers should not unexpectedly change the dimensions of unrelated sections when they load.

7. **Asynchronous Request Management:** Inspect how external API responses update the detail view. Prevent unnecessary re-renders, duplicate updates, race conditions, and repeated loading-state changes that contribute to flickering or layout instability.

8. **Smooth Updates:** Transition from placeholders to actual content without unnecessary animations, flashing, or abrupt layout changes. Avoid excessive skeleton animations or decorative loading effects.

9. **Preserve Existing Functionality:** Retain all current metadata sources, API integrations, ratings, descriptions, cast information, trailers, and other features. Focus on layout stability and rendering behavior rather than removing content or reducing functionality.

10. **Consistent Experience:** Apply the same layout stability principles to movies, series, and other supported media types, including when metadata arrives progressively or some sources are unavailable.


---
## Cross-Platform Release: macOS and Linux
The application is currently Windows-first, but it must be production-ready for **Windows, macOS, and Linux**.
- Ensure all core functionality works consistently across all three OSes.
- Audit OS-specific paths, binaries, permissions, native dependencies, packaging, and runtime behavior.
- Provide installers and portable/direct builds where supported.
- Configure GitHub Actions so every new version tag automatically:
    - Builds all supported OS targets.
    - Runs required validation/tests.
    - Creates a GitHub Release.
    - Uploads all installers and portable/direct distribution files.
- Release artifacts must be clearly named by OS, architecture, and package type.


### 1. Cross-Platform Release: Windows, macOS, and Linux

The application is currently Windows-first, but the release must be production-ready and fully supported on **Windows, macOS, and Linux**.

- Ensure all core functionality works consistently across all three operating systems.
- Audit and resolve OS-specific differences involving:
  - File and directory paths
  - Environment variables
  - Permissions and filesystem access
  - Native binaries and executables
  - Java sidecar/runtime dependencies
  - Native Node/Electron dependencies
  - Process spawning and management
  - Network behavior
  - Media playback and external processes
  - Application data and cache locations
  - Configuration and persistence
  - Installer and packaging behavior
- Ensure all bundled binaries and runtime dependencies are available for the correct OS and architecture.
- Avoid hard-coded Windows-specific paths, commands, executable names, or assumptions in shared code.
- Ensure platform-specific implementations are isolated cleanly where behavior genuinely differs.
- Verify application startup, installation, updates, playback, downloads, extensions, repositories, persistence, and other core workflows on each supported platform.
- Provide appropriate installers and portable/direct distribution packages for each supported OS and architecture where technically supported.

### GitHub Actions Release Automation

Configure GitHub Actions so that every new version tag automatically triggers the complete release pipeline.

For each release tag, the workflow must:

1. Build all supported OS and architecture targets.
2. Install and validate all required dependencies and runtimes.
3. Run the required automated tests and validation checks.
4. Build the production application for each supported target.
5. Generate the appropriate installers and portable/direct distribution packages.
6. Create a GitHub Release for the version tag.
7. Upload all generated release artifacts to the GitHub Release.
8. Clearly report build and validation failures instead of publishing incomplete releases.

The release workflow should be reproducible and should not depend on manually building artifacts on a developer's machine.

### Release Artifacts

Release artifacts must use a consistent and unambiguous naming convention that identifies:

- Application name
- Version
- Operating system
- Architecture
- Package/distribution type

For example:

```text
CS3-1.2.3-windows-x64-installer.exe
CS3-1.2.3-windows-x64-portable.zip
CS3-1.2.3-macos-arm64.dmg
CS3-1.2.3-macos-x64.dmg
CS3-1.2.3-linux-x64.AppImage
CS3-1.2.3-linux-x64.deb
```

Use the package formats that are appropriate and reliably supported for each target rather than forcing an identical package format across all operating systems.

### Cross-Platform Validation

Before considering the cross-platform release work complete, verify that each supported target can:

- Install or launch successfully.
- Start the Electron application correctly.
- Locate and execute all required bundled binaries.
- Load the Java sidecar/runtime correctly.
- Load and run extensions.
- Access repositories and providers.
- Search and resolve content.
- Play supported media.
- Download media where supported.
- Persist application data correctly.
- Access required filesystem locations.
- Handle application updates or packaged runtime behavior correctly.
- Exit and restart cleanly.
- Preserve existing user data across application restarts.

The final implementation should make **Windows, macOS, and Linux first-class release targets**, rather than treating macOS and Linux as secondary ports of the existing Windows implementation.
---
Extension Management Improvements: Bulk Install, Automatic Updates, and Repository Catalog Controls
Improve the extension management experience by adding bulk installation, automatic updates, and better controls for managing providers and repositories. The goal is to minimize repetitive clicks, reduce manual maintenance, and make extension management straightforward without compromising reliability or user control.
1. Bulk Install Search Results
Add an Install All action to the Extension screen when users search for providers, extensions, or repositories.
Currently, users must open or interact with individual catalog cards to install each item. Allow users to install all matching items directly from the current search results.
Requirements:

* Display an Install All action when the search returns eligible, installable items.
* Apply the action to all items matching the current search and active filters, including providers and repositories where applicable.
* Support installing multiple providers and multiple repositories in one operation.
* Install and configure each item using the existing installation and configuration workflows.
* Avoid requiring users to open individual cards or repeat the same action for every result.
* Show installation progress, completed items, failed items, and any items requiring additional configuration.
* Handle dependencies, duplicate installations, incompatible versions, and already-installed items safely.
* Prevent duplicate installation requests and provide a clear way to retry failed items.
* Keep the interface responsive while bulk operations run.
* Preserve individual installation controls for users who want to select specific items.

Do not blindly install every catalog entry regardless of its state. Exclude items that are already installed, incompatible, unavailable, or otherwise ineligible, and clearly communicate any exclusions.
2. Automatic Extension and Repository Updates
Implement automatic updates so users do not need to visit the Extensions screen to keep installed providers, extensions, and repositories up to date.
Automatic updates should be enabled by default, with a setting that allows users to disable them.
Requirements:

* Automatically check for updates when the application starts.
* Check for updates at most once per calendar day, while allowing a manual check at any time.
* When an update is available, automatically download and install it without requiring the user to open the Extensions screen or approve each individual update.
* Apply updates to all eligible installed providers, extensions, and repositories supported by the existing update mechanism.
* Avoid repeatedly checking or downloading the same updates during a single day unless the user explicitly requests a manual check.
* Show unobtrusive progress and status information when updates are running.
* Notify users about successful updates, failed updates, and items that require manual intervention.
* Handle network failures, unavailable repositories, invalid packages, incompatible versions, and interrupted updates safely.
* Avoid interrupting playback, downloads, or other active application workflows unnecessarily.
* Ensure that failed updates do not leave extensions in a broken or partially installed state. Preserve the existing version or provide a recovery mechanism where supported.
* Reuse existing version checks, repository metadata, download mechanisms, and installation services rather than introducing a parallel update system.

If an update requires additional permissions, a breaking configuration change, or an explicit user decision, do not silently bypass that requirement. Clearly explain what needs attention.
3. Extensions Screen Settings and Controls
Enhance the Extensions screen and repository catalog with clear, minimal controls for bulk installation and automatic updates.
Provide the following options where applicable:

* Install All: Install all eligible items matching the current search and filters.
* Update All: Manually update all installed items that have available updates.
* Automatic Updates: Enable or disable automatic updates, enabled by default.
* Check for Updates: Manually check for available updates.
* Update Status: Display the last check, current operation, and relevant success or failure information.
* Retry Failed Items: Retry installations or updates that failed.

Requirements:

* Keep the interface compact and consistent with the existing design system.
* Display actions only when relevant, such as showing Install All when eligible search results exist.
* Disable conflicting actions while an operation is running.
* Provide progress feedback without freezing the interface.
* Clearly distinguish installed, installable, updating, updated, failed, and incompatible items.
* Avoid redundant buttons or excessive explanatory text.
* Preserve existing search, filtering, repository browsing, and individual item management functionality.

4. Bulk Operation Reliability
Treat bulk installation and updating as coordinated operations rather than a series of uncontrolled simultaneous requests.

* Use appropriate concurrency limits to avoid overloading providers, repositories, or network connections.
* Track the status of each item independently.
* Continue processing eligible items when an unrelated item fails.
* Make operations safe to retry without creating duplicate installations.
* Ensure repository dependencies and installation ordering are respected.
* Prevent duplicate background update jobs.
* Persist operation state only where necessary to recover from application restarts.
* Ensure updates do not bypass existing compatibility checks, integrity validation, or security restrictions.

5. Implementation and Acceptance Criteria
Inspect the existing extension catalog, installation workflows, repository management, update scheduler, persistence layer, and background task handling before implementing these changes.
The implementation is complete when:

1. Users can install all eligible providers and repositories matching their current search and filters in one operation.
2. Bulk installation provides per-item progress and clear failure reporting.
3. Automatic updates are enabled by default and can be disabled through the Extensions screen.
4. The application checks for updates on startup and automatically processes eligible updates without requiring manual interaction.
5. Automatic update checks occur no more than once per calendar day, except when explicitly requested.
6. Update All and Check for Updates remain available for manual use.
7. Failed or incompatible updates are handled safely and reported clearly.
8. Existing extension functionality, repository management, search, filtering, and installation workflows continue to work.
9. Bulk operations do not freeze the UI or initiate duplicate jobs.
10. Relevant tests cover filtering, eligibility, dependencies, partial failures, retries, startup checks, daily scheduling, and automatic update preferences.

Files / References (Optional)
Start with the following components:

* `desktop/src/components/extensions/RepositoryCatalog.tsx`
* `desktop/src/components/extensions/ExtensionsScreen.tsx`

Inspect related implementation files as needed, including the existing extension installation service, repository management, update-checking logic, background scheduler, persistence layer, and associated tests.
Use the current source code as the primary reference. Reuse existing installation and update mechanisms wherever practical, and avoid duplicating business logic between the repository catalog and the Extensions screen.