# PRD: Fast Application Startup and Persistent Extension Data Cache

## 1. Overview

The application currently takes too long to load extensions during a fresh application startup.

The exact cause is not yet clear. It may be related to:

- Internet connectivity
- Repository/network requests
- Extension metadata fetching
- Extension runtime initialization
- Provider/repository discovery
- Java/sidecar startup
- Cache initialization
- Database reads
- Main-process initialization
- Renderer initialization
- Multiple operations waiting sequentially for network responses
- Unnecessary refetching of data that is already available locally

We need to investigate the complete startup pipeline and redesign it so that the application does **not depend on the network to become usable every time it starts**.

The target behavior should be similar to a mature enterprise application:

> **Start immediately using the last known valid local state, then synchronize and refresh data in the background.**

---

# 2. Current Problem

The current startup flow appears to behave approximately like:

```text
Application starts
    ↓
Initialize application
    ↓
Load repositories/extensions
    ↓
Fetch remote data
    ↓
Wait for network responses
    ↓
Process extension data
    ↓
Update application state
    ↓
Application becomes fully usable
```

This creates a poor experience when:

- Internet connectivity is slow
- A repository is unavailable
- An extension provider is slow
- DNS is slow
- A remote server is temporarily unavailable
- One request takes significantly longer than others
- Several providers are initialized sequentially
- The user is offline
- The network has high latency

A single slow dependency should not prevent the rest of the application from becoming usable.

---

# 3. Target Startup Architecture

The preferred architecture should be:

```text
Application starts
       ↓
Load local persisted state
       ↓
Immediately initialize UI
       ↓
Display last known extension/repository state
       ↓
Application becomes usable
       ↓
Background synchronization starts
       ↓
Fetch updated remote information
       ↓
Validate / compare
       ↓
Update local cache
       ↓
Notify UI of changes
```

This separates:

### Startup

What is required to make the application usable.

### Synchronization

What can happen after the application is already usable.

The application should avoid making remote network availability a hard dependency for normal startup.

---

# 4. Local-First Startup

The application should maintain a persistent local cache of extension and repository information.

At startup:

```text
Local cache exists?
       │
       ├── Yes
       │    ↓
       │  Load immediately
       │    ↓
       │  Show application
       │
       └── No
            ↓
          First installation flow
            ↓
          Fetch required data
```

For subsequent launches, the previously known data should be reused.

---

# 5. What Should Be Cached

The cache should contain everything required to reconstruct the previous extension/repository state without immediately contacting the network.

Depending on the existing architecture, this may include:

### Repository information

- Repository ID
- Repository name
- Repository URL
- Repository metadata
- Repository version
- Last successful synchronization
- Repository status
- Available extensions
- Repository configuration

### Extension information

- Extension ID
- Extension name
- Version
- Language
- Region
- Type
- Provider information
- Catalog information
- Enabled/disabled state
- User selection state
- Installation state
- Runtime requirements
- Extension metadata
- Last successful load
- Last synchronization time

### User configuration

- Enabled extensions
- Disabled extensions
- Selected repositories
- Provider selections
- Regional selections
- Source preferences
- Extension ordering
- User-specific configuration

The cache should preserve the complete state required to restore the previous application session.

---

# 6. Do Not Confuse Cache With Configuration

There should be a clear distinction between:

```text
Persistent User Configuration
```

and:

```text
Cached Remote Data
```

For example:

### User configuration

```text
Extension X = Enabled
Repository A = Enabled
Region = India
Provider B = Selected
```

This should be treated as user-owned persistent state.

### Remote cache

```text
Extension X
Version 4.2
Last repository metadata
Available providers
Last synchronization
```

This can be replaced when newer information is available.

The synchronization process must never accidentally overwrite user preferences.

---

# 7. Stale-While-Revalidate Strategy

The application should use a **stale-while-revalidate** approach.

At startup:

```text
Cached data
    ↓
Use immediately
    ↓
Application becomes usable
    ↓
Background refresh
    ↓
New data available
    ↓
Update cache
    ↓
Update UI
```

This provides fast startup while still keeping the application current.

---

# 8. Example Startup

Suppose the user previously had:

```text
Repository A
Repository B

Enabled:
Extension 1
Extension 2
Extension 3
```

On startup:

```text
0 ms
Application launches

100 ms
Local state begins loading

200 ms
Extensions appear using cached state

300 ms
Application is usable

Background:
Repository A refresh
Repository B refresh
Extension metadata refresh
Version checks
Provider updates
```

The user should not have to wait for all remote requests to finish before using the application.

---

# 9. Background Synchronization

After startup, synchronization should happen asynchronously.

The synchronization system should:

1. Determine which cached data exists.
2. Determine what needs refreshing.
3. Schedule remote requests.
4. Perform requests concurrently where safe.
5. Apply successful updates.
6. Preserve valid cached information if refresh fails.
7. Persist the updated cache.
8. Notify the UI of meaningful changes.

---

# 10. Never Replace Good Data With Failed Data

This is critical.

Suppose:

```text
Cached:
Extension A
Extension B
Extension C
```

and during startup:

```text
Extension A → Success
Extension B → Timeout
Extension C → Server Error
```

The application must not replace the cache with:

```text
Extension A
```

and remove B and C.

Instead:

```text
Extension A → Updated
Extension B → Existing cached version retained
Extension C → Existing cached version retained
```

The application should only replace cached information when the new information has been successfully validated.

---

# 11. Network Failure Must Not Destroy Startup

If the user has no Internet connection:

```text
Application starts
    ↓
Load cached state
    ↓
Application remains usable
    ↓
Background synchronization fails
    ↓
Cached data remains available
```

The application should clearly indicate that synchronization could not be completed, but it should not unnecessarily prevent the user from using already available functionality.

---

# 12. First Installation vs Subsequent Startup

The application should treat these as two completely different scenarios.

## First Installation

There may be no cached data.

```text
First launch
    ↓
Initialize minimum configuration
    ↓
Fetch required repositories/extensions
    ↓
Build initial local cache
    ↓
Application becomes fully configured
```

The first launch can legitimately require network activity.

## Subsequent Launch

```text
Application starts
    ↓
Use existing cache
    ↓
Application becomes usable
    ↓
Refresh in background
```

The second path should be significantly faster.

---

# 13. Startup Critical Path

We need to identify exactly what is currently blocking startup.

Create a startup dependency graph.

For example:

```text
Application
 ├── Database
 ├── Configuration
 ├── Extension Manager
 │    ├── Repository A
 │    ├── Repository B
 │    └── Repository C
 ├── Sidecar Runtime
 ├── Provider Manager
 └── UI
```

Determine which operations are truly required before the application can render.

Only those operations should remain on the critical startup path.

Everything else should be moved to asynchronous initialization.

---

# 14. Startup Performance Instrumentation

Before optimizing, instrument the startup sequence.

Every major startup operation should record:

```text
Operation
Start time
End time
Duration
Success/failure
Cache hit/miss
Network request
Repository
Extension
```

Example:

```text
Application Startup
-------------------
Database initialization       120 ms
Load configuration             35 ms
Load extension cache           80 ms
Repository refresh          2,850 ms
Extension metadata refresh   940 ms
Sidecar startup               620 ms
UI initialization             180 ms
```

This will allow us to identify the real bottleneck instead of guessing whether the problem is Internet speed or application initialization.

---

# 15. Network Timing Diagnostics

For network operations, capture:

- DNS duration
- Connection duration
- TLS duration where available
- Time to first response
- Response duration
- Download duration
- HTTP status
- Retry count
- Timeout duration
- Repository/extension involved

This should be available in development diagnostics without exposing sensitive information.

---

# 16. Parallel Initialization

If multiple independent repositories or extensions are currently loaded sequentially:

```text
Repository A
    ↓
Repository B
    ↓
Repository C
```

consider parallelizing them:

```text
Repository A ─┐
Repository B ─┼─→ Synchronization
Repository C ─┘
```

However, concurrency must be bounded.

Do not create hundreds of simultaneous requests.

Use a controlled concurrency limit.

---

# 17. Timeout Isolation

A slow repository must not block every other repository.

For example:

```text
Repository A → 200 ms
Repository B → 500 ms
Repository C → 10 seconds
```

Repository C should not cause A and B to wait.

Each operation should have its own timeout and failure state.

---

# 18. Retry Strategy

Background synchronization should use controlled retries.

Avoid:

```text
Request fails
→ immediately retry
→ retry again
→ retry again
→ application becomes busy
```

Instead use:

```text
Request
 ↓
Failure
 ↓
Backoff
 ↓
Retry
 ↓
Failure
 ↓
Longer backoff
```

The exact retry policy should be centralized.

---

# 19. Cache Freshness

Each cached object should have timestamps such as:

```text
createdAt
updatedAt
lastFetchedAt
lastValidatedAt
expiresAt
```

This allows the synchronization system to determine whether data needs refreshing.

Example:

```text
Fresh
    → use immediately

Stale
    → use immediately + refresh

Expired
    → use if safe + refresh urgently

Missing
    → fetch
```

---

# 20. Different Refresh Policies

Not every piece of data needs to be refreshed at the same frequency.

For example:

### Repository metadata

Refresh periodically.

### Extension versions

Refresh periodically.

### User configuration

Do not remotely refresh.

### Provider catalog data

Refresh according to provider/catalog requirements.

### Static extension metadata

Can have a longer cache lifetime.

The system should use configurable refresh policies instead of treating all data identically.

---

# 21. Background Updates Must Be Non-Disruptive

When updated extension information arrives, the UI should not suddenly reset.

Avoid:

```text
Old extension list
    ↓
Clear UI
    ↓
Loading spinner
    ↓
Rebuild everything
```

Prefer:

```text
Existing extension list
    ↓
Background update
    ↓
Detect changes
    ↓
Update only affected items
```

This prevents flickering and unnecessary rendering.

---

# 22. Preserve User State During Updates

If the user has configured:

```text
Extension A = Enabled
Extension B = Disabled
Extension C = Selected
```

and a repository refresh happens, those choices should remain intact unless the extension genuinely no longer exists or has become incompatible.

Remote synchronization should not silently reset user configuration.

---

# 23. Extension Version Updates

If a newer extension version becomes available:

```text
Cached extension
Version 1.2
    ↓
Background update detects
Version 1.3
```

the application should:

1. Keep the current working version available.
2. Download/prepare the new version in the background where appropriate.
3. Validate it.
4. Switch to the new version safely.
5. Preserve configuration.
6. Roll back if the update fails.

The application should not become unusable because a new extension version failed to initialize.

---

# 24. Repository Failure Isolation

If one repository is unavailable:

```text
Repository A → Available
Repository B → Timeout
Repository C → Available
```

the application should still load:

```text
A + cached B + C
```

Repository B should be marked:

```text
Temporarily unavailable
```

rather than deleting all data associated with it.

---

# 25. Offline Startup

Offline startup should be treated as a valid operating condition.

Expected behavior:

```text
No Internet
    ↓
Application starts
    ↓
Cached extensions available
    ↓
Cached repositories available
    ↓
Previously configured state available
    ↓
Network-dependent features indicate offline state
```

The application should not show a blank extension area merely because synchronization could not happen.

---

# 26. Cache Corruption Protection

Persistent cache data must be protected against corruption.

Use:

- Atomic writes
- Temporary files
- Validation before replacement
- Schema versions
- Recovery from previous valid cache
- Safe migrations

Do not overwrite a known-good cache with incomplete or corrupted data.

---

# 27. Cache Versioning

The cache schema should be versioned.

Example:

```text
cacheSchemaVersion: 3
```

When the application updates:

```text
Old cache
    ↓
Migration
    ↓
Validation
    ↓
New cache
```

If migration fails:

```text
Preserve old cache
    ↓
Fallback safely
```

---

# 28. Startup State Snapshot

The application should maintain a coherent snapshot of the last known working extension/repository state.

Conceptually:

```text
Startup Snapshot
├── Repositories
├── Extensions
├── Provider metadata
├── User selections
├── Versions
├── Runtime state
└── Last synchronization information
```

The application can use this snapshot to reconstruct the previous state immediately.

---

# 29. Atomic Snapshot Updates

When synchronization completes, update the snapshot atomically.

Do not write partial state such as:

```text
Repository A updated
Repository B half-written
Extension C missing
```

Instead:

```text
Build new state
    ↓
Validate
    ↓
Write atomically
    ↓
Swap active snapshot
```

This ensures that the application always has a valid state to fall back to.

---

# 30. Startup and Renderer Separation

The Electron main process should avoid blocking the renderer unnecessarily.

Heavy operations such as:

- Repository synchronization
- Extension processing
- Metadata parsing
- Network operations
- Large cache processing

should not unnecessarily block UI initialization.

The UI should be able to render quickly and receive state updates asynchronously.

---

# 31. Sidecar and Runtime Initialization

Because the desktop application uses an extension runtime/sidecar architecture, startup should also measure:

- Sidecar startup time
- Java process startup
- Runtime initialization
- Extension loading
- IPC initialization
- Repository communication

If the sidecar is required for some operations but not for initial UI rendering, consider starting it asynchronously.

The application should not wait for the complete extension runtime before rendering the basic application shell unless absolutely necessary.

---

# 32. Lazy Initialization

Features that are not required immediately should be initialized only when needed.

For example:

```text
Application startup
    ↓
Basic UI
    ↓
Core configuration
    ↓
Cached extension state
```

Then:

```text
User opens Search
    ↓
Search runtime initialized

User opens Downloads
    ↓
Download subsystem initialized

User opens Extensions
    ↓
Extension management subsystem initialized
```

This should only be used where it does not negatively affect user experience.

---

# 33. Warm Startup

If the application is restarted frequently, the previous application state should make the next startup progressively faster.

The objective is:

```text
First startup
    → slower

Second startup
    → faster

Subsequent startup
    → fast and predictable
```

The application should not repeatedly rebuild everything from scratch.

---

# 34. Background Synchronization Scheduling

Synchronization should happen at appropriate times, such as:

- After application startup
- When the application becomes idle
- When the user opens the relevant extension/repository screen
- Periodically
- After network connectivity is restored
- Manually through a refresh action

The application should avoid refreshing everything every time the application starts.

---

# 35. Connectivity-Aware Synchronization

The application should understand basic network availability.

For example:

```text
Internet unavailable
    ↓
Skip aggressive synchronization
    ↓
Use cache
```

When connectivity returns:

```text
Network restored
    ↓
Start background synchronization
```

A failed request should not cause an aggressive retry loop while the device is offline.

---

# 36. User-Initiated Refresh

Users should still have an explicit way to force synchronization.

For example:

```text
Extensions
    ↓
Refresh
```

This should perform an immediate synchronization while preserving the existing cached state until the new data is successfully retrieved.

---

# 37. Startup Loading UI

Avoid showing a global loading screen simply because remote extension synchronization is occurring.

Instead:

```text
Application opens
    ↓
UI available
    ↓
Extension data already shown
    ↓
Small background synchronization indicator
```

For example:

```text
Extensions
✓ 12 loaded from local cache
↻ Updating...
```

The user should understand that the application is usable while updates continue.

---

# 38. Error Presentation

Background synchronization errors should not interrupt the user unnecessarily.

Instead of:

```text
Failed to load extensions.
[Retry]
```

blocking the application, use a non-blocking indication such as:

```text
Some extension information could not be updated.
Your previous data is still available.
```

The user can manually retry.

---

# 39. Enterprise-Grade Requirements

The final startup architecture should provide:

- Fast startup
- Deterministic startup behavior
- Offline resilience
- Persistent local state
- Stale-while-revalidate caching
- Background synchronization
- Failure isolation
- Bounded concurrency
- Controlled retries
- Atomic state updates
- Cache versioning
- Safe migrations
- Observability
- Performance metrics
- User-state preservation
- Graceful degradation
- Rollback capability
- No unnecessary network dependency
- No data loss from failed synchronization

---

# 40. Recommended Startup Flow

The final architecture should approximately follow:

```text
Application Launch
       ↓
Initialize minimal core
       ↓
Load local configuration
       ↓
Load last known extension/repository snapshot
       ↓
Validate local snapshot
       ↓
Render application
       ↓
Application becomes usable
       ↓
Start background synchronization
       ↓
Check connectivity
       ↓
Refresh stale repositories
       ↓
Refresh extension metadata
       ↓
Check versions/updates
       ↓
Validate updated state
       ↓
Atomically persist new snapshot
       ↓
Notify UI of meaningful changes
```

---

# 41. Failure Scenario

If the network is unavailable:

```text
Application Launch
       ↓
Load cached snapshot
       ↓
Render application
       ↓
Network unavailable
       ↓
Skip synchronization
       ↓
Keep cached state
       ↓
Application remains usable
```

If the network becomes available:

```text
Connectivity restored
       ↓
Background synchronization
       ↓
Update cache
       ↓
Update UI
```

---

# 42. Definition of Done

This improvement is complete when:

- Application startup no longer waits unnecessarily for remote extension/repository requests.
- Previously loaded extension data is immediately reused.
- Previously loaded repository data is immediately reused.
- User configuration is restored immediately.
- Network synchronization happens in the background.
- Cached data is replaced only after successful validation.
- Temporary network failures do not destroy cached data.
- One slow provider/repository cannot block the entire startup process.
- Multiple independent synchronization tasks can run concurrently with bounded concurrency.
- Startup timing is instrumented so bottlenecks can be identified.
- Offline startup remains functional using cached state.
- Background synchronization does not freeze or reset the UI.
- Extension updates can be prepared safely without breaking the currently working version.
- Cache writes are atomic and recoverable.
- Cache schemas are versioned and migratable.
- Renderer startup is not unnecessarily blocked by heavy background work.
- Users can manually force a refresh.
- Connectivity recovery can trigger synchronization.
- The application reaches a usable state as quickly as possible.
- Subsequent launches reuse the previous known-good state instead of rebuilding everything from the network.

## Core Principle

**The application should never need to rediscover everything from the Internet just to start.**

The previous successful application state should be treated as the **known-good local snapshot**.

```text
Previous successful state
        ↓
Persist locally
        ↓
Next startup
        ↓
Restore immediately
        ↓
Application usable
        ↓
Refresh in background
        ↓
Validate
        ↓
Replace local state
```

This gives CS3 a fast, resilient, offline-tolerant startup experience while still ensuring that extension and repository information stays current in the background.