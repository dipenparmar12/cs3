

:::writing{variant="document" id="58321"}
You are an AI software architect, reverse-engineering specialist, product analyst, and cross-platform application migration expert.

Your task is to reverse-engineer the existing Android application and produce a comprehensive, implementation-ready Project Requirements Document (PRD) for rebuilding the application as a cross-platform desktop application using Electron.

The source application is:

`https://github.com/recloudstream/cloudstream`

The existing Android application is the functional source of truth. The target product will be a desktop application based on Electron, designed to run on:

- Windows
- macOS
- Linux

The objective is not to create a simplified desktop viewer or a loosely similar application. The objective is to create a complete desktop equivalent of the Android application, preserving its functional behavior, data model, user workflows, integrations, extensibility, and important application capabilities wherever technically possible.

The desktop application must also provide a reliable migration path between Android and desktop. A user who exports their data from the Android application must be able to import that data into the desktop application and continue using the application without losing supported user data, settings, favorites, watch history, downloads metadata, subscriptions, plugin/extension configuration, or other transferable state.

The resulting PRD must therefore describe both:

1. What the existing Android application does.
2. How those capabilities must be reproduced, adapted, or replaced in the Electron desktop application.

Do not treat this as a normal greenfield PRD. This is a reverse-engineering and platform migration PRD.

The PRD must be detailed enough that another AI or engineering team can use it as the primary specification for implementing the complete desktop application without repeatedly referring to the Android application to understand expected behavior.

---

# 1. PROJECT OBJECTIVE

Analyze the complete Android source repository and reverse-engineer the application into a platform-independent product specification.

The final desktop product should provide functional parity with the Android application wherever the underlying capability is applicable to desktop environments.

The migration must distinguish between:

- Features that can be directly reproduced.
- Features that require desktop-specific implementation.
- Features that require a different technical implementation but must preserve the same user-visible behavior.
- Android-only capabilities that require an equivalent desktop alternative.
- Features that cannot reasonably be reproduced on desktop and therefore require an explicit documented limitation.
- Features that are currently implemented but may be hidden, experimental, deprecated, or conditionally available.
- Features provided by extensions/plugins/providers rather than the core application.

Do not remove functionality simply because the existing implementation is Android-specific.

For every Android-specific capability, determine whether the desktop application should:

1. Reimplement it natively for desktop.
2. Replace it with an Electron/Node.js equivalent.
3. Replace it with a browser/Web API equivalent.
4. Provide a desktop-specific UX while preserving the same functional behavior.
5. Provide an alternative workflow.
6. Explicitly mark it as unsupported with a documented reason.

---

# 2. SOURCE OF TRUTH

The Android repository is the primary functional source of truth.

Repository:

`https://github.com/recloudstream/cloudstream`

Analyze the repository comprehensively, including where applicable:

- Source files
- Modules
- Packages
- Gradle configuration
- Kotlin/Java code
- Android resources
- UI definitions
- Navigation
- View models
- State management
- Persistence
- Databases
- Preferences
- Serialization
- Network clients
- API integrations
- Extractors
- Providers
- Plugins/extensions
- Download functionality
- Media playback
- Subtitle handling
- Search
- Authentication
- Accounts
- User profiles
- Watch history
- Favorites
- Bookmarks
- Watch progress
- Settings
- Theme system
- Localization
- Notifications
- Background operations
- Caching
- Update mechanisms
- Import/export functionality
- Backup/restore functionality
- Share/deep-link behavior
- Intent handling
- External application integrations
- Permissions
- File system access
- Security mechanisms
- Error handling
- Logging
- Tests
- CI/CD
- Release configuration
- Build configuration
- Versioning
- Licenses
- Third-party dependencies
- Git history and commits when available

Also inspect related repositories or dependencies when they are required to understand the behavior of the main application, particularly plugin/extension repositories and shared libraries.

Do not assume that the main repository alone contains every user-facing capability.

If a feature is implemented through an extension/plugin/provider ecosystem, document the relationship between the core application and that ecosystem.

The currently observed repository state must be treated as the baseline version being migrated.

If the repository changes during analysis, record the analyzed commit/version where possible.

---

# 3. TARGET APPLICATION

The target application is a desktop Electron application.

Target platforms:

- Windows
- macOS
- Linux

Target architecture should be documented and evaluated around:

- Electron main process
- Electron renderer process
- Preload layer where required
- Node.js services/utilities
- Browser/Web APIs
- Local persistent storage
- Local file system
- Desktop media playback
- External media players where appropriate
- Network layer
- Plugin/extension system
- IPC boundaries
- Desktop notifications
- OS integration
- Auto-update mechanism
- Application packaging
- Application data directories
- Secure storage
- Import/export subsystem

Do not assume that Android implementation details should be copied literally.

The PRD must specify behavior and contracts rather than forcing the Android implementation architecture onto Electron.

The desktop architecture should preserve application behavior while taking advantage of desktop capabilities.

---

# 4. CORE MIGRATION PRINCIPLE

The target desktop application must be functionally equivalent to the Android application as far as technically and legally possible.

Use the following principle:

> Android implementation defines the expected product behavior. Electron implementation defines how that behavior is delivered on desktop.

Therefore:

- Do not redesign functionality merely because the desktop UI looks different.
- Do not remove existing capabilities without explicitly documenting the reason.
- Do not silently change data formats.
- Do not create a separate incompatible data model unless unavoidable.
- Do not make desktop users start from an empty application when transferable Android data is available.
- Do not make users manually recreate their Android configuration when automated migration is technically possible.
- Do not treat Android and desktop as unrelated products.
- Preserve compatibility across application versions wherever reasonably possible.

---

# 5. DATA PORTABILITY IS A FIRST-CLASS REQUIREMENT

Data portability between Android and desktop is a mandatory core requirement, not an optional feature.

The PRD must deeply analyze every user-controlled or user-generated data type stored by the Android application.

Identify:

- Where the data is stored.
- Data format.
- Serialization format.
- Database schema.
- Preferences.
- Files.
- Cache data.
- Metadata.
- IDs.
- Relationships.
- Version information.
- Encryption or protected data.
- Plugin-specific data.
- Provider-specific data.
- Download metadata.
- Media metadata.
- Watch state.
- User preferences.
- Account/session information.
- Custom settings.
- Theme configuration.
- Language configuration.
- Search history.
- Favorites.
- Bookmarks.
- Continue-watching state.
- Watch history.
- Subscriptions.
- Notifications state.
- Installed extensions/plugins.
- Plugin repositories.
- Provider configuration.
- Custom provider settings.
- Any other persistent state discovered during analysis.

For each data category classify it as:

- Fully portable
- Portable with transformation
- Partially portable
- Platform-specific
- Non-portable
- Unknown and requiring verification

---

# 6. ANDROID EXPORT TO DESKTOP IMPORT

The desktop application MUST support importing data exported by the Android application whenever the Android application exposes an export/backup mechanism for that data.

The expected workflow is:

Android:

1. User opens the Android application.
2. User exports/backups supported application data.
3. Android produces the supported export file or archive.
4. User transfers the exported file to Windows/macOS/Linux.
5. User opens the desktop application.
6. User selects Import/Restore.
7. Desktop application identifies the export format.
8. Desktop application validates the file.
9. Desktop application determines the source application/version.
10. Desktop application performs any required schema or format transformation.
11. Desktop application imports compatible data.
12. Desktop application reports imported, skipped, transformed, and unsupported data.
13. User continues using the desktop application with migrated state.

The PRD must specify this workflow in detail.

---

# 7. DESKTOP EXPORT TO ANDROID IMPORT

The reverse direction must also be investigated.

Determine whether the Android application can import data generated by the desktop application.

If Android import support exists:

- Desktop export must remain compatible.
- Export format must follow the Android-compatible structure.
- Version compatibility must be documented.
- Unsupported desktop-only fields must be handled safely.

If Android import support does not exist:

- Document the limitation.
- Determine whether the desktop application can generate an Android-compatible export.
- Determine whether a compatibility adapter is required.
- Define a future-compatible export format if appropriate.

The final PRD must explicitly document:

- Android -> Desktop migration
- Desktop -> Android migration
- Desktop -> Desktop migration
- Backup -> Restore
- Version N -> Version N+1 migration

---

# 8. DATA MIGRATION CONTRACT

Define a formal cross-platform data migration contract.

The PRD must specify:

- Supported export formats
- Supported import formats
- Format versioning
- Application version metadata
- Schema version
- Compatibility rules
- Migration rules
- Validation rules
- Duplicate handling
- Conflict resolution
- Partial import behavior
- Failed import behavior
- Rollback behavior
- Backup-before-import behavior
- Corrupted file handling
- Unsupported version handling
- Forward compatibility
- Backward compatibility
- Unknown fields
- Missing fields
- Deprecated fields
- Platform-specific fields
- Large export files
- Import progress
- Cancellation
- Recovery after interruption

The import system must never silently corrupt existing user data.

Before modifying existing data, the desktop application should create an appropriate local backup or transactional restore point.

---

# 9. DATA LOSS PREVENTION

Data integrity is a critical acceptance requirement.

The PRD must require:

- Pre-import backup where appropriate.
- Transactional or staged import.
- Validation before committing changes.
- Clear import summary.
- Error reporting.
- Recovery from failed imports.
- No silent data loss.
- No silent overwriting of user data.
- Duplicate detection.
- Conflict handling.
- Migration logs where useful.
- Safe cancellation.
- Compatibility warnings.

If an imported field cannot be mapped, the application must report it rather than silently discarding it.

---

# 10. FEATURE PARITY MATRIX

Create a comprehensive feature parity matrix.

For every meaningful Android feature include:

| Feature | Android Behavior | Desktop Requirement | Implementation Strategy | Data Impact | Platform Difference | Priority | Status |
|---|---|---|---|---|---|---|---|

Each feature must be classified as:

- Parity required
- Desktop adaptation required
- Desktop enhancement
- Android-only
- Desktop-only
- Unsupported
- Needs investigation

The matrix must cover the complete application, not only major screens.

Examples of areas to investigate include:

- Home
- Search
- Search filters
- Provider selection
- Content discovery
- Movies
- TV shows
- Episodes
- Seasons
- Genres
- Categories
- Recommendations
- Favorites
- Watch history
- Continue watching
- Bookmarks
- Subscriptions
- Downloads
- Download queue
- Media player
- External player
- Subtitle selection
- Audio selection
- Video quality
- Playback speed
- Volume
- Brightness
- Fullscreen
- Picture-in-picture
- Playback controls
- Next episode
- Episode autoplay
- Skip intro
- Skip outro
- Resume playback
- Playback progress
- Search history
- Sharing
- Deep links
- Accounts
- Authentication
- Profiles
- Settings
- Themes
- Localization
- Extensions
- Plugins
- Plugin repositories
- Provider configuration
- Provider pinning
- Network settings
- Cache
- Storage
- Backup
- Import
- Export
- Updates
- Notifications
- Error handling
- Logging
- Accessibility
- Keyboard navigation
- Mouse interaction
- Controller/remote interaction if relevant

Use the actual repository to determine which features exist rather than assuming every example exists.

---

# 11. USER INTERFACE MIGRATION

The desktop UI must not simply imitate a mobile screen.

The PRD must define how Android interactions translate to desktop interaction patterns.

Analyze:

- Android screens
- Navigation structure
- Bottom navigation
- Side navigation
- Tabs
- Dialogs
- Bottom sheets
- Cards
- Lists
- Grids
- Detail pages
- Player UI
- Settings
- Search
- Forms
- Context menus
- Long press actions
- Swipe actions
- Touch gestures

Map them to desktop equivalents such as:

- Sidebar navigation
- Top navigation
- Tabs
- Menus
- Context menus
- Right-click
- Keyboard shortcuts
- Mouse interactions
- Hover states
- Resizable panels
- Window controls
- Modal dialogs
- Tooltips
- Drag and drop
- Desktop file pickers
- System notifications

The goal is behavioral parity with a desktop-native user experience.

Do not preserve mobile UI constraints when they reduce desktop usability.

---

# 12. DESKTOP-SPECIFIC REQUIREMENTS

Define desktop capabilities that should be added or adapted where appropriate.

Investigate:

- Resizable application window
- Minimum and maximum window dimensions
- Fullscreen
- Maximized window
- Multi-monitor support
- Window state persistence
- Keyboard shortcuts
- Mouse shortcuts
- Right-click context menus
- Drag and drop
- Native file dialogs
- Native folder selection
- System notifications
- Tray behavior if appropriate
- Deep links
- File associations
- URL associations
- External player integration
- Default browser integration
- Clipboard integration
- OS media controls where feasible
- Application protocol handlers
- Crash recovery
- Auto-update
- Offline behavior
- Startup behavior
- Application data location
- Cache location
- Download location
- Temporary files
- Log files
- Portable mode if appropriate

Every desktop-specific feature must be documented separately from Android parity features.

---

# 13. MEDIA PLAYBACK MIGRATION

Media playback is a critical subsystem.

Reverse-engineer the Android playback architecture and document:

- Supported media formats
- Streaming protocols
- Video sources
- Audio tracks
- Subtitle tracks
- Subtitle formats
- Quality selection
- Resolution selection
- Playback speed
- Resume position
- Buffering
- Retry behavior
- Playback errors
- Episode transitions
- Autoplay
- External players
- Downloaded media
- Hardware acceleration
- DRM if present
- Network failures
- Seek behavior
- Audio synchronization
- Subtitle synchronization
- Picture-in-picture behavior
- Fullscreen behavior
- Playback state persistence

Then define the equivalent Electron/Desktop implementation.

Explicitly identify where browser/Electron media APIs differ from Android APIs.

If a direct equivalent is unavailable, define the required alternative implementation.

---

# 14. PLUGIN AND EXTENSION ECOSYSTEM

Treat the plugin/extension/provider architecture as a first-class subsystem.

Analyze:

- Plugin format
- Plugin discovery
- Plugin repositories
- Installation
- Uninstallation
- Updates
- Version compatibility
- Provider APIs
- Provider metadata
- Provider settings
- Provider lifecycle
- Provider errors
- Extractors
- Custom repositories
- Trust model
- Permissions
- Sandboxing
- Network access
- Dynamic loading
- Compatibility with Android plugins

Determine whether Android plugins can run unchanged in Electron.

If not, define:

- Compatibility layer
- Porting strategy
- Adapter architecture
- Plugin API
- Desktop plugin format
- Migration path
- Versioning strategy
- Security model

The PRD must avoid creating an extension ecosystem that unnecessarily fragments the Android ecosystem.

---

# 15. API AND NETWORK COMPATIBILITY

Document all network-facing behavior discovered in the Android application.

For every API, provider, service, or network dependency determine:

- Purpose
- Endpoint or service role
- Input data
- Output data
- Authentication
- Headers
- Cookies
- Tokens
- Session state
- Rate limits
- Retries
- Timeouts
- Error behavior
- Caching
- Offline behavior
- Provider-specific behavior
- Compatibility requirements

Determine whether the desktop application can reuse the same APIs.

If an Android-specific networking layer exists, define the desktop equivalent.

---

# 16. STORAGE AND DATABASE MIGRATION

Reverse-engineer all persistent storage.

Document:

- Database technology
- Database files
- Tables
- Fields
- Relationships
- IDs
- Indexes
- Serialization
- Preferences
- File-based storage
- Cache
- Metadata
- Migration versions
- Backup format

For every Android storage mechanism determine:

- Can it be reused directly?
- Can it be converted?
- Does Electron require a different storage implementation?
- Can the desktop app import it?
- Can the desktop app export it back?

Define a canonical logical data model independent of platform implementation.

This is important because Android and Electron may use different storage technologies while still needing identical application behavior.

---

# 17. CROSS-PLATFORM DATA MODEL

Define a platform-independent logical data model.

The model should separate:

1. User data
2. Application settings
3. Content metadata
4. Provider configuration
5. Plugin configuration
6. Playback state
7. Download state
8. Cache
9. Platform-specific state

The PRD must clearly identify which data belongs to the portable cross-platform layer and which data belongs to a specific operating system.

---

# 18. FILE AND DOWNLOAD MANAGEMENT

Analyze the Android download system and create desktop requirements for:

- Download queue
- Download state
- Pause
- Resume
- Cancel
- Retry
- Failed downloads
- Download progress
- Concurrent downloads
- Storage selection
- File naming
- Duplicate detection
- Disk space
- Download metadata
- Downloaded media discovery
- Import/export of download metadata
- Cross-platform path conversion

Android file paths must never be blindly copied to desktop.

The migration system must transform platform-specific paths safely.

For example, an Android path must not become an invalid Windows or Linux path.

Define path portability rules.

---

# 19. PLATFORM PATH AND FILE PORTABILITY

Explicitly document the difference between:

- Android application storage
- Windows application data
- macOS application data
- Linux application data
- User-selected directories
- Downloads directory
- Cache directory
- Temporary directory

Any stored path must be classified as:

- Portable logical path
- Platform-specific path
- User-configured path
- Generated path

Portable exports should store logical information where possible rather than absolute platform-specific paths.

---

# 20. SECURITY REQUIREMENTS

Analyze the Android security model and define desktop equivalents.

Document:

- Credentials
- Tokens
- Cookies
- Session data
- Encryption
- Local storage security
- Plugin security
- Network security
- Certificate validation
- Sensitive files
- Import file validation
- Malicious plugin risks
- Malicious provider risks
- Arbitrary file access
- Electron IPC security
- Renderer isolation
- Preload exposure
- Node.js access
- Remote content risks

The desktop application must follow Electron security best practices.

Do not expose unrestricted Node.js capabilities to untrusted renderer content.

Imported files and plugins must be treated as untrusted input.

---

# 21. ELECTRON ARCHITECTURE

Define the target Electron architecture.

At minimum evaluate:

- Main process
- Renderer process
- Preload layer
- IPC
- Local services
- Network layer
- Storage layer
- Plugin runtime
- Media subsystem
- Download subsystem
- Import/export subsystem
- Update subsystem
- Logging
- Crash recovery

For each subsystem define:

- Responsibility
- Inputs
- Outputs
- Dependencies
- Lifecycle
- Error handling
- Security boundary
- Platform differences
- Testing requirements

Do not include implementation source code.

---

# 22. LARGE DATA AND PERFORMANCE

The application may process large datasets, metadata collections, downloads, caches, playlists, histories, or imported backups.

Analyze performance requirements.

Document:

- Expected dataset size
- Large import behavior
- Large export behavior
- Large plugin repositories
- Large watch histories
- Large download queues
- Large metadata collections
- Memory consumption
- CPU-intensive operations
- Network-heavy operations
- UI rendering bottlenecks

For large operations specify:

- Progress indicators
- Background processing
- Worker threads
- Streaming
- Chunked processing
- Virtualized lists
- Lazy loading
- Incremental rendering
- Cancellation
- Recovery
- Memory limits

The application must remain responsive during long-running operations.

---

# 23. IMPORT AND EXPORT UX

Create a complete UX specification for data migration.

Import flow must include:

1. Select import file.
2. Detect format.
3. Validate file.
4. Detect source application/version.
5. Display migration preview.
6. Show categories that will be imported.
7. Show categories that require transformation.
8. Show unsupported categories.
9. Warn about conflicts.
10. Create backup where necessary.
11. Execute import.
12. Display progress.
13. Display result.
14. Display warnings/errors.
15. Allow user to inspect migration results.

Export flow must include:

1. Select export scope.
2. Show estimated data.
3. Select destination.
4. Create export.
5. Display progress.
6. Validate generated export.
7. Provide final export file.
8. Record export format/version.

The UX must make it obvious whether an export can be imported into Android, desktop, or both.

---

# 24. VERSION COMPATIBILITY

Define compatibility across application versions.

The PRD must address:

- Android version -> Desktop version
- Desktop version -> Desktop version
- Desktop version -> Android version
- Older export -> New application
- New export -> Older application
- Schema migrations
- Plugin version migrations
- Provider configuration migrations

Use explicit compatibility rules rather than assuming compatibility.

Where compatibility is impossible, provide clear user-facing warnings.

---

# 25. OFFLINE AND ONLINE BEHAVIOR

Document which capabilities require internet access.

Classify features as:

- Fully offline
- Partially offline
- Online required
- Online preferred

The desktop application should preserve local user data and configuration even when network services are unavailable.

Offline failures must not corrupt local state.

---

# 26. TESTING STRATEGY

Testing must validate both feature parity and data compatibility.

Required test categories include:

- Unit tests
- Integration tests
- UI tests
- End-to-end tests
- Cross-platform tests
- Import/export tests
- Migration tests
- Regression tests
- Plugin compatibility tests
- Provider tests
- Playback tests
- Download tests
- Storage tests
- Security tests
- Performance tests
- Upgrade tests

Create explicit Android-to-desktop migration test cases.

Examples:

- Empty Android profile
- Small profile
- Large profile
- Existing favorites
- Existing history
- Existing playback progress
- Installed extensions
- Custom plugin repositories
- Provider settings
- Downloads
- Multiple profiles if supported
- Corrupted backup
- Partial backup
- Unsupported version
- Duplicate records
- Conflicting records
- Interrupted import
- Insufficient disk space
- Invalid file
- Very large export

---

# 27. ACCEPTANCE REQUIREMENT FOR DATA PORTABILITY

The desktop application should be considered incomplete if a supported Android export cannot be successfully migrated.

Define measurable acceptance criteria such as:

- All documented portable user data is imported.
- No supported data is silently discarded.
- Unsupported data is explicitly reported.
- Import failures do not corrupt existing data.
- Import can be cancelled safely.
- Import can recover from failures.
- Exported desktop data can be restored.
- Compatible Android export files are recognized automatically.
- Migration results are auditable.
- Application version and schema version are preserved.

Where 100 percent data parity is technically impossible, explicitly identify the exact fields and reasons.

Never claim 100 percent compatibility without evidence.

---

# 28. LICENSE AND OPEN SOURCE COMPLIANCE

Because the source application is open source, inspect and document:

- Project license
- Copyright notices
- Third-party licenses
- Plugin licenses
- Media libraries
- Native libraries
- Fonts
- Icons
- Images
- Open source notices
- Attribution requirements
- Distribution requirements
- Copyleft obligations
- Electron dependency licenses

The target application's redistribution model must comply with the licenses of the Android project and all reused components.

Do not assume that "open source" means all assets can be redistributed without conditions.

---

# 29. DEVELOPMENT HISTORY

Analyze Git history where available.

Identify:

- Major architectural changes
- Feature additions
- Removed features
- Bug fixes
- Security fixes
- Data migrations
- Plugin changes
- Provider changes
- Playback changes
- UI redesigns
- Performance improvements
- Breaking changes

Use history to infer why the current architecture behaves the way it does.

Do not treat historical implementation as current behavior when it has been superseded.

---

# 30. REQUIRED PRD STRUCTURE

Create the PRD under:

`docs/PRD/`

Use separate Markdown files.

Required files:

- `00-index.md`
- `01-executive-summary.md`
- `02-system-architecture.md`
- `03-feature-specifications.md`
- `04-utility-specifications.md`
- `05-library-dependencies.md`
- `06-data-models.md`
- `07-apis-and-contracts.md`
- `08-ui-and-interactions.md`
- `09-user-workflows.md`
- `10-user-personas.md`
- `11-security-and-compliance.md`
- `12-performance-and-limits.md`
- `13-testing-and-qa.md`
- `14-deployment-and-ci.md`
- `15-upgrade-and-modernization.md`
- `16-implementation-plan.md`
- `17-acceptance-criteria.md`
- `18-technical-reference.md`
- `19-development-history.md`
- `20-limitations-and-constraints.md`
- `21-open-issues-and-assumptions.md`
- `22-contributor-guide.md`
- `23-manifest.json`

Add additional documents when required.

Recommended additional documents for this migration:

- `24-feature-parity-matrix.md`
- `25-data-portability-and-migration.md`
- `26-electron-desktop-requirements.md`
- `27-plugin-and-extension-architecture.md`
- `28-media-playback-requirements.md`
- `29-platform-compatibility.md`
- `30-migration-test-cases.md`

---

# 31. FEATURE SPECIFICATION FORMAT

Every feature must include:

- Feature ID
- Feature name
- Description
- Android behavior
- Desktop behavior
- Actors
- Trigger
- Preconditions
- Main workflow
- Alternative workflows
- Error workflows
- Postconditions
- Data affected
- Dependencies
- Platform differences
- Acceptance criteria
- Priority
- Implementation strategy
- Evidence
- Confidence
- Risks
- Recommended tests

Do not group unrelated features into vague high-level descriptions.

For example, "Settings" is not sufficient.

Break it down into meaningful settings/features based on actual implementation.

---

# 32. EVIDENCE REQUIREMENTS

For every significant behavior or requirement provide evidence.

Evidence must contain:

- Repository path
- Relevant line range
- Relevant class/module/component/function name when useful
- Short explanation of why the evidence supports the requirement

Do not paste source code.

Example:

- Path: `app/src/...`
- Lines: `120-160`
- Rationale: Defines persistent watch history storage and therefore establishes that watch history is part of the user's durable application state.

For external documentation or repositories, include the source URL and explain how it supports the requirement.

---

# 33. CONFIDENCE REQUIREMENTS

Every inferred behavior must include:

- High
- Medium
- Low

Also explain why.

Use:

High:
Directly demonstrated by implementation, tests, configuration, or explicit documentation.

Medium:
Strongly implied by multiple implementation details but not directly confirmed.

Low:
Reasonable interpretation requiring manual verification.

Never present an inference as a confirmed requirement.

---

# 34. ANALYSIS PROCESS

Perform the following analysis in order.

## Step 1: Repository inventory

Map the entire repository.

Identify:

- Modules
- Packages
- Source directories
- Resources
- Build files
- Tests
- Documentation
- CI
- Configuration
- Native code
- Assets

## Step 2: Architecture analysis

Identify:

- Application entry points
- Major modules
- Dependencies
- Services
- State management
- Persistence
- Networking
- UI architecture

## Step 3: Feature discovery

Build a complete feature inventory.

## Step 4: Data discovery

Identify every persistent data source.

## Step 5: Integration discovery

Identify external APIs, providers, plugins, repositories, services, and media systems.

## Step 6: UI discovery

Map screens, navigation, interactions, dialogs, settings, and workflows.

## Step 7: Platform dependency analysis

Identify everything tightly coupled to Android.

## Step 8: Migration analysis

Determine how each Android capability maps to Electron.

## Step 9: Data portability analysis

Determine exactly how Android export/import can work with desktop.

## Step 10: Desktop architecture

Define the recommended Electron architecture.

## Step 11: Testing

Define parity, migration, compatibility, and regression tests.

## Step 12: Implementation roadmap

Create an implementation plan ordered by dependency and risk.

---

# 35. DO NOT BLINDLY COPY ANDROID ARCHITECTURE

The PRD must explicitly distinguish:

Android implementation:

- Kotlin
- Android framework
- Android lifecycle
- Android storage
- Android networking
- Android media APIs
- Android permissions
- Android UI

from target implementation:

- Electron
- JavaScript/TypeScript
- Chromium
- Node.js
- Electron IPC
- Desktop storage
- Desktop file system
- Desktop media stack
- Windows/macOS/Linux APIs

The goal is functional equivalence, not architectural duplication.

---

# 36. DESKTOP ARCHITECTURE DECISION RECORDS

For major migration decisions document:

- Android implementation
- Problem on desktop
- Options considered
- Recommended solution
- Reason
- Tradeoffs
- Risks
- Compatibility impact
- Migration impact
- Testing requirements

Important decision areas include:

- Database
- Networking
- Plugin runtime
- Media playback
- Downloads
- Storage
- Authentication
- Import/export
- Encryption
- IPC
- Updates
- Notifications
- File handling

---

# 37. IMPLEMENTATION PHASES

Create an implementation roadmap.

At minimum consider:

Phase 1:
Repository reverse engineering and architecture baseline.

Phase 2:
Electron shell and desktop foundation.

Phase 3:
Core application data model.

Phase 4:
Storage and migration system.

Phase 5:
Core UI and navigation.

Phase 6:
Search, discovery, providers, and content details.

Phase 7:
Playback system.

Phase 8:
Downloads.

Phase 9:
Plugins/extensions.

Phase 10:
Settings and personalization.

Phase 11:
Android import/export compatibility.

Phase 12:
Desktop export/backup.

Phase 13:
Cross-platform packaging.

Phase 14:
Security hardening.

Phase 15:
Performance optimization.

Phase 16:
Full regression and parity validation.

The actual phases may be changed after repository analysis.

---

# 38. DEFINITION OF DONE

The target application must not be considered complete merely because:

- Electron launches.
- Main screens exist.
- Search works.
- Playback works.

The application is complete only when:

- Core Android functionality has been mapped.
- Desktop equivalents have been implemented.
- Data portability is implemented.
- Android exports can be imported where supported.
- Desktop backups can be restored.
- Plugin/provider behavior is addressed.
- Playback behavior is validated.
- Downloads are validated.
- Settings are migrated.
- User state is preserved.
- Unsupported capabilities are explicitly documented.
- Windows works.
- macOS works.
- Linux works.
- Security requirements are met.
- Performance is acceptable.
- Upgrade/migration paths exist.
- Automated tests cover critical functionality.

---

# 39. FINAL PRD QUALITY REQUIREMENTS

The PRD must be:

- Comprehensive
- Implementation-oriented
- Evidence-based
- Platform-aware
- Migration-aware
- Data-portability-aware
- Testable
- Maintainable
- Explicit about uncertainty

Avoid:

- Generic product-management language
- Vague feature descriptions
- Unsupported assumptions
- Copying Android implementation details without analysis
- Omitting data migration
- Omitting plugin/provider architecture
- Omitting media playback
- Omitting desktop-specific requirements
- Omitting unsupported functionality
- Claiming parity without verification

The PRD should function as the canonical contract between:

- Product
- UX
- Desktop engineering
- Backend/network engineering
- Plugin/extension engineering
- QA
- Security
- Release engineering
- Future maintainers
- AI coding agents

---

# 40. MACHINE-READABLE MANIFEST

Create:

`docs/PRD/23-manifest.json`

The manifest must map:

- Features
- Requirements
- Android source evidence
- Desktop requirements
- Data entities
- APIs
- Dependencies
- Plugins
- Migration rules
- Acceptance criteria
- Tests
- Open questions
- Risks
- Upgrade recommendations

Use a structure equivalent to:

- features
- requirements
- dependencies
- dataModels
- apis
- plugins
- migrations
- acceptanceCriteria
- tests
- risks
- openQuestions
- upgradeRecommendations

Each feature must reference the PRD document where it is defined and the source evidence supporting it.

---

# 41. FINAL OUTPUT EXPECTATION

Produce the complete PRD set under:

`docs/PRD/`

The output must describe the existing Android application and the target Electron desktop application as one coherent product migration.

The most important relationship in the entire PRD is:

Android application
→ source behavior
→ platform-independent requirements
→ Electron implementation requirements
→ Windows/macOS/Linux desktop behavior
→ cross-platform data model
→ Android/Desktop import/export compatibility
→ migration validation
→ complete desktop parity

Do not produce a superficial "Android app converted to Electron" specification.

Produce a complete reverse-engineered product specification for a production-quality desktop equivalent.

The resulting documentation should allow an engineering team to answer all of the following without inspecting the Android source again:

1. What does the application do?
2. What features exist?
3. How does every important feature behave?
4. What data does the application store?
5. Which data belongs to the user?
6. Which data must migrate from Android?
7. How does Android export data?
8. How does desktop import that data?
9. What data cannot migrate and why?
10. How should desktop storage differ from Android storage?
11. How should Android UI behavior translate to desktop?
12. Which Android APIs require desktop replacements?
13. How should playback work?
14. How should downloads work?
15. How should plugins and providers work?
16. How should authentication and sessions work?
17. How should Windows, macOS, and Linux differ?
18. What happens when an import fails?
19. How is user data protected from loss?
20. How is backward and forward compatibility handled?
21. How will feature parity be tested?
22. How will Android-to-desktop migration be tested?
23. What remains unsupported?
24. What must be implemented first?
25. What does "complete desktop application" mean?

---

# 42. REQUIRED FINAL CHECKLIST

Before considering the PRD complete, verify that:

- [ ] Entire Android repository was analyzed.
- [ ] Major modules were identified.
- [ ] All major user-facing features were documented.
- [ ] Android-specific behavior was identified.
- [ ] Desktop equivalents were defined.
- [ ] Windows requirements were defined.
- [ ] macOS requirements were defined.
- [ ] Linux requirements were defined.
- [ ] UI differences were documented.
- [ ] Media playback was analyzed.
- [ ] Downloads were analyzed.
- [ ] Plugins/extensions/providers were analyzed.
- [ ] APIs and network dependencies were analyzed.
- [ ] Persistent data was analyzed.
- [ ] Database/storage structures were analyzed.
- [ ] Android export formats were investigated.
- [ ] Android-to-desktop migration was specified.
- [ ] Desktop-to-desktop migration was specified.
- [ ] Desktop-to-Android compatibility was investigated.
- [ ] Data conflicts were specified.
- [ ] Import validation was specified.
- [ ] Backup-before-import behavior was specified.
- [ ] Failed import recovery was specified.
- [ ] No silent data loss is permitted.
- [ ] Platform-specific paths were addressed.
- [ ] Plugin compatibility was addressed.
- [ ] Security risks were documented.
- [ ] Electron security boundaries were documented.
- [ ] Performance requirements were documented.
- [ ] Large-data handling was documented.
- [ ] Testing strategy was documented.
- [ ] Cross-platform testing was documented.
- [ ] Migration testing was documented.
- [ ] License compliance was documented.
- [ ] Upgrade strategy was documented.
- [ ] Implementation roadmap was documented.
- [ ] Feature parity matrix was created.
- [ ] All significant claims have evidence.
- [ ] All inferred behavior has confidence levels.
- [ ] Unknowns and open questions are explicitly documented.
- [ ] `23-manifest.json` is complete.
- [ ] Every PRD document contains next steps.
- [ ] Every PRD document contains the generation date.
- [ ] No source code is copied into the PRD.
- [ ] The PRD is suitable for use by AI coding agents and human engineers.
- [ ] The PRD treats Android-to-desktop data portability as a mandatory product requirement.
- [ ] The PRD does not declare the desktop application complete until critical functional and data parity requirements are validated.

Final principle:

The goal is not merely to run Cloudstream on a desktop.

The goal is to create a complete, maintainable, cross-platform desktop product that preserves the application's important Android functionality while providing a proper desktop experience and reliable, lossless, version-aware data portability wherever technically possible.
:::