# PRD-52 — Incognito Mode (Private Streaming & Browsing)

Status: **Proposed, nothing built.** Implementation-ready: every change below names the
file, the symbol and the channel it touches. Follows the conventions in `AGENTS.md`;
where this document and the code disagree, the code wins — fix this document in the
same commit.

---

## 1. Summary

Add a Chrome-style Incognito Mode. While it is active the app works exactly as normal —
search, browse, stream, download — but **no automatic activity is persisted**: no search
history, no watch history, no Continue Watching, no playback progress, no played-source
memory, no title outcomes, no visits, no provider analytics, and nothing feeds
personalisation. **Explicit user actions still persist**: Add to Library, Save page
(bookmark), manual downloads, link export and sharing.

The design rule that makes this tractable: **gate the writes at the main-process store
boundary, not at the ~15 renderer call sites.** Every automatic-activity write in this
codebase already funnels through one store method; suppressing the funnel covers every
caller, including future ones that forget to check.

The reverse rule is just as important: **explicit saves must not pass through those
funnels**, or the gate breaks them. The one genuine collision (Save page depends on a
page snapshot existing) is handled with a session-scoped volatile tier — see §6.4.

---

## 2. Goals / non-goals

**Goals**

- One toggle, one source of truth, enforced in the main process so the renderer cannot
  bypass it (same argument as the adult gate living in `enabledProviderNames`).
- Explicit saves (library, bookmarks, downloads, export, share) work identically in and
  out of Incognito.
- A visible, subtle indicator wherever activity could be recorded: navbar, player,
  search screen.
- Configurable download behaviour; optional remember-across-launches.
- Session data discarded when Incognito ends or the app closes.

**Non-goals**

- OS-level privacy (DNS, disk cache of decodes, Windows recent-files). Out of scope;
  do not claim it.
- Network anonymity. Incognito changes **persistence**, not routing. The UI copy must
  not imply otherwise.
- Retroactive deletion. Activity recorded before Incognito was switched on stays.
  (Chrome parity: history from a normal window is untouched.)
- A separate profile. Profiles (`profiles:*`) are orthogonal; Incognito is global and
  temporary.

---

## 3. Precedents already in the codebase (read these first)

| Precedent                               | File                                                                                                                                                                          | What it teaches                                                                                                                                                                                                                                                    |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| In-memory session flag, never persisted | `cs3_windows/electron/cs3/bootstrap.ts` — `adultUnlockedThisSession` (lines ~85–170), channels `extension:unlockAdultForSession` / `lockAdultForSession` in `main.ts` (~4615) | The exact shape of "a flag that lives only for this run of the app". `unlockAdultForSession` refusing unless mode is `ask` is the model for validating transitions main-side.                                                                                      |
| Renderer-wide mode via context          | `cs3_windows/src/utils/experienceMode.ts` (pure) + `cs3_windows/src/utils/ExperienceModeContext.tsx` (React)                                                                  | The two-file split this repo uses so Node's type stripping can test the pure half. **Reproduce the naming pattern exactly — never name a `.ts` and `.tsx` alike but for casing** (this blanked the whole window once; `componentReachability.test.mts` guards it). |
| Settings plumbing end-to-end            | `datastore:getSetting` / `datastore:setSetting` (`preload.ts` ~2347), Android 6-bucket key grammar in `electron/datastore.ts`                                                 | How a boolean setting reaches disk.                                                                                                                                                                                                                                |
| Settings screen structure               | `cs3_windows/src/views/SettingsView.tsx` — `tabs` array (~line 278); `src/components/settings/SettingRow.tsx`, `settingsLevel.ts`                                             | Where the Privacy tab goes; `level="basic"` for every Incognito row (these are viewer controls, not build knowledge).                                                                                                                                              |
| Push-shaped state sync                  | `extension:jobsUpdate`, `mpv:update` patterns in `main.ts` / `preload.ts`                                                                                                     | The model for `privacy:changed`.                                                                                                                                                                                                                                   |
| IPC surface pinning                     | `cs3_windows/electron/ipcSurface.test.mts`                                                                                                                                    | New channels **will fail this test until it is updated** — it pins every channel diff lexically, in all three directions. Budget for updating it; "I'll wire it later" entries are not allowed.                                                                    |

---

## 4. The state model

### 4.1 Two kinds of state, kept apart

1. **Session flag** — `active: boolean`. In-memory only by default. Persisted to the
   datastore **only when** `rememberPreference` is true (§9). Cleared on:
   - user toggles off,
   - user presses "Exit and clear",
   - app quit (always, when not remembered — like `adultUnlockedThisSession`).
2. **Settings** — durable booleans in the datastore (§9). These survive restarts and
   travel in backups (they live in the datastore, which `backupService.ts` already
   exports as a section; no backup change needed).

### 4.2 New module: `cs3_windows/electron/cs3/privacyMode.ts`

A small main-process service, constructed in `main.ts` beside the other singletons and
**injected into the stores it gates** (constructor or setter injection, matching how
`providerAnalytics` is wired at `main.ts` ~575–581).

```ts
export interface IncognitoSettings {
  allowDownloads: boolean // default true
  askBeforeDownload: boolean // default false
  allowExplicitSaves: boolean // bookmarks/library/save-page; default true
  rememberPreference: boolean // default false → always start non-incognito
  clearSessionOnExit: boolean // default true
}

export class PrivacyMode {
  isActive(): boolean
  /** Validates + applies; emits privacy:changed; returns whole state. */
  setActive(active: boolean): PrivacyState
  updateSettings(partial: Partial<IncognitoSettings>): PrivacyState
  /** Drops every volatile artefact listed in §6. Called on setActive(false),
   *  on "exit and clear", and from before-quit when active. */
  clearSession(): void
}
```

Rules:

- **All gating reads `privacyMode.isActive()` at the moment of the write**, never a
  cached copy. A mid-playback toggle takes effect on the next write.
- `setActive(false)` with `clearSessionOnExit` calls `clearSession()`; `setActive(true)`
  also clears, so a stale volatile tier can never leak across two incognito sessions.
- Settings keys (6-bucket grammar, `datastore.ts`): `incognito_allow_downloads_Bool`,
  `incognito_ask_download_Bool`, `incognito_allow_saves_Bool`,
  `incognito_remember_Bool`, `incognito_clear_on_exit_Bool`, and
  `incognito_active_Bool` written **only** when `rememberPreference` is true and deleted
  when it is turned off.

### 4.3 IPC contract (four things change together — `AGENTS.md` §4)

New namespace `privacy:*`:

| Channel                  | Shape                      | Returns                                                                                                                                                     |
| ------------------------ | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `privacy:getState`       | invoke                     | `{ ok, active, settings }` — whole state, never a delta (the `profiles:*` rule: the three must agree and rebuilding from a delta is how they stop agreeing) |
| `privacy:setActive`      | invoke `(active: boolean)` | whole state                                                                                                                                                 |
| `privacy:updateSettings` | invoke `(partial)`         | whole state                                                                                                                                                 |
| `privacy:changed`        | **push**                   | whole state, emitted on every change so navbar, player, search and settings stay in sync                                                                    |

Touch points: handler registrations in `electron/main.ts`; methods + types on
`CloudStreamElectronAPI` in `electron/preload.ts`; shared `IncognitoSettings` /
`PrivacyState` types in `src/types/api.ts`; update `ipcSurface.test.mts`.

---

## 5. Complete inventory of automatic writes to suppress

This is the exhaustive list, verified against the codebase. **Every row is a funnel:
gate inside the named method, and every caller is covered.**

### 5.1 Watch history / Recently Watched / download history

- **Store:** `HistoryStore.record` — `cs3_windows/electron/cs3/historyStore.ts` (line 14),
  datastore key `media_history_events_v1`.
- **Callers covered by the funnel:**
  - `history:recordEvent` handler (`main.ts` ~5627) ← `recordHistoryEvent` from
    `DetailView.tsx` (~437, `detail_opened`), `VideoPlayer.tsx` (~890 played, ~1412,
    ~1442), `App.tsx` (~1540), `HistoryView.tsx` (~392), `LibraryBucketSelector.tsx`
    (~115, ~141).
  - `downloadService.ts` line ~98: `this.historyStore.record(historyEventForTask(...))`
    — this is why "download history" needs no separate gate.
- **Gate:** `record()` no-ops (returns current list unchanged) when incognito.
- **Explicit-save nuance:** `LibraryBucketSelector` records a history event as a side
  effect of an _explicit_ add-to-library. Under Incognito the bucket assignment (a
  `LibraryStore` mutation, §5.7) must still land while the history event is suppressed.
  Gating `HistoryStore.record` achieves exactly this split with no caller changes.

### 5.2 Playback progress / Continue Watching / resume

- **Store:** `LibraryStore.recordProgress` — `electron/cs3/libraryStore.ts` line ~740.
- **Callers:** `library:recordProgress` handler (`main.ts` ~5324) ←
  `recordWatchProgress` from `VideoPlayer.tsx` (~1888).
- **Gate:** no-op when incognito. With no progress rows, Continue Watching and
  "resume from 42:10" simply have nothing to show — no renderer changes needed.

### 5.3 Last played source

- **Store:** `LibraryStore.recordPlayedSource` — `libraryStore.ts` line ~547.
- **Callers:** `library:recordPlayedSource` (`main.ts` ~5394) ← `VideoPlayer.tsx`
  (~753, fires after 10s of real playback).
- **Gate:** no-op when incognito. `markPlayedSourceUnavailable` (`main.ts` ~5530) is a
  no-op too — there is nothing stored to mark.

### 5.4 Search history

- **Store:** `SearchHistoryStore.record` / `setResultCount` —
  `electron/searchHistory.ts` (line 21).
- **Callers:** `main.ts` ~1733, ~1907, ~1935 (search session + `api:searchAll`).
- **Gate:** both methods no-op when incognito. The history dropdown
  (`api:getSearchHistory`) continues to show _pre-incognito_ entries; do not hide them
  (Chrome parity).

### 5.5 Title outcomes / failed-playback memory (dead-row badges)

- **Store:** `TitleOutcomeStore` via the `api:recordTitleOutcome` handler
  (`main.ts` ~2420) ← `DetailView.tsx` (~423, ~517, ~574).
- **Gate:** no-op when incognito. Suppressing this also suppresses the "dead row"
  dimming from `src/utils/deadRows.ts` for incognito activity — correct: failures in a
  private session must not follow the title into the normal profile.

### 5.6 Visits ("recently viewed" dimming)

- **Store:** `TitleInteractions.visit` via `interactions:visit` (`main.ts` ~1883) ←
  `recordTitleVisit` from `DetailView.tsx` (~434).
- **Gate:** no-op when incognito. `interactions:summarise` (the batched card-state read)
  needs no change — it only reads.

### 5.7 Library buckets — **NOT gated**

`LibraryStore`'s explicit add/remove/bucket-assign methods are user-initiated saves and
must keep working (PRD §3). Only `recordProgress` and `recordPlayedSource` on this store
are gated. When `allowExplicitSaves` is false (§9), the **handlers** for the explicit
channels refuse with `{ ok: false, error: 'Disabled during Incognito' }` — do not gate
the store methods themselves, so internal callers are unaffected.

### 5.8 Provider analytics / ranking ("don't influence recommendations")

- **Store:** `ProviderAnalytics.observe` — funnelled at `main.ts` ~2906, fed by
  `pluginManager`, `contentService`, `downloadService` (`setAnalytics` wiring, ~579–581).
- **Gate:** `observe()` drops the event when incognito. `providerAnalytics.flush()`
  calls (~919, ~1781) are harmless but should still run — they flush only what was
  counted.
- This is what keeps "Because you watched…" and provider ordering untouched: the ranking
  (`providerRanking.ts`) reads only these counters, and the home feed's personalised
  genre rows (`discovery.ts` ~273, ~343) read only the library — which received nothing.

### 5.9 Page snapshots — volatile tier, see §6.4

### 5.10 Source cache — volatile tier, see §6.3

### 5.11 Saved searches

`search:saveResults` is an explicit button press → **allowed**, subject to
`allowExplicitSaves`. No gate beyond that.

### 5.12 Bookmarks

`pages:remember` / `bookmarkStore.ts` — explicit, allowed (subject to
`allowExplicitSaves`). The dependency on page snapshots is the §6.4 problem.

---

## 6. Session isolation: the volatile tier

PRD §4 asks for temporary in-memory data that is discarded when Incognito ends. Two
stores need a real volatile mode; everything else is either already in-memory
(and dies with its session) or is covered by a write gate.

### 6.1 Already in-memory — no work, but list them in `clearSession()`

| State                  | Owner                     | Why it's fine                                                                                                                             |
| ---------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Search session state   | `searchSession.ts`        | Lives for one search; cancelled/finished sessions are not persisted.                                                                      |
| Playback session state | `playbackSession.ts`      | Same.                                                                                                                                     |
| Suggestion caches      | `searchSuggestions.ts`    | In-memory exact/prefix cache; clear it in `clearSession()` so incognito queries cannot autocomplete _into_ the normal session afterwards. |
| Source prefetcher      | `cs3/sourcePrefetcher.ts` | In-flight only; but it **writes to `SourceCache`**, which is why §6.3 matters.                                                            |

### 6.2 What NOT to do

Do not create a parallel "incognito profile" or a second datastore. The gates above make
that unnecessary, and two profiles would re-introduce the stale-runtime class of bug
(two sources of truth drifting).

### 6.3 `SourceCache` (`electron/sourceCache.ts`) — volatile writes

Resolved sources persist with per-source expiry, and `SourceCache.onWrite` feeds
`LibraryStore.mergeDiscoveredSources` ("a library title keeps what discovery found").
Both must not happen for incognito activity, but **within** a session the cache is load-
bearing: pressing Play after the prefetcher ran must still join the in-flight discovery
(`sharedDiscovery.ts`), and a source that 404s should not be re-tried three times in one
sitting.

Design:

- `SourceCache` gains `setVolatileMode(active: boolean)` (called by `PrivacyMode`).
- In volatile mode: **reads** fall through to the persistent cache as today (reading a
  magnet cached last week records nothing); **writes** go to an in-memory `Map` checked
  before the persistent store, and `onWrite` **does not fire** (that one flag suppresses
  `mergeDiscoveredSources` too).
- `recordFailure` / `recordSuccess` update only the volatile map.
- `clearSession()` drops the volatile map.
- `sourceCache.test.mts` gains cases: write-then-read within session hits; nothing on
  disk after clear; `onWrite` not fired in volatile mode. Mutation-verify the `onWrite`
  suppression.

### 6.4 `PageSnapshotStore` (`electron/cs3/pageSnapshot.ts`) — volatile capture

The subtle one. Capture is not exposed over IPC — it happens inside
`ContentService.load` — and `pages:remember` (explicit "Save page") persists **from the
captured snapshot**. If capture is simply disabled under Incognito, explicit save has
nothing to save and silently breaks — the "a catch that reassures" failure shape.

Design:

- Same volatile pattern as `SourceCache`: capture always happens, but under Incognito it
  lands in an in-memory map keyed by address, checked first on reads, dropped by
  `clearSession()`.
- `pages:remember` explicitly **promotes** the volatile snapshot into the persistent
  store when the user saves (subject to `allowExplicitSaves`). Promotion-on-save is the
  whole point: automatic capture is private, the deliberate save is durable.
- Add a `promote(address)` method to the store rather than letting the handler
  re-assemble a snapshot — the store owns its own record shape.

### 6.5 Downloads in progress

An in-progress download is an explicit action and must not be killed when Incognito
ends. Completed tasks' **history events** are already suppressed (§5.1). What remains is
the queue row itself:

- `DownloadService` tags tasks started while incognito with an in-memory-only
  `incognito: true` (never written into the persisted queue record).
- On `clearSession()`: completed incognito tasks are removed from the queue listing
  (the **file stays** — deleting the file would destroy an explicit save);
  active/queued tasks keep running and lose the tag (they become ordinary downloads
  the user chose to start).
- `download:request`'s gate: when incognito and `allowDownloads` is false, refuse with
  `{ ok: false, error }` and a sentence the renderer can show; when
  `askBeforeDownload` is true the renderer shows a confirm dialog _before_ calling
  `download:request` (the `get/setConfirmPreference` pattern already exists).

---

## 7. Developer logging & diagnostics (PRD §10)

| Surface                                            | Behaviour under Incognito                                                                                                                                                                                                              |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `logging/logger.ts` (NDJSON per-launch transcript) | Add `logger.setPrivateMode(true)`: records are written but `title`, `query`, `url` fields are stripped via the existing `redact.ts` pass. Runtime errors still debuggable; viewing history absent. Cleared with log rotation as today. |
| `cs3/diagnostics.ts` (DiagnosticsLog)              | Gate the record call for detail/playback stages — it stores titles/URLs, and it persists across restarts, so it cannot run unfiltered. Extension _load_ failures carry no user activity and may still record.                          |
| `cs3/extensionIssues.ts`                           | **No change.** It stores `(cause, source, groupingForm(message))` — no URLs, queries or titles by design. Say so in a comment so nobody "fixes" it.                                                                                    |
| `providerAnalytics`                                | Covered by §5.8.                                                                                                                                                                                                                       |

Developer mode (`experienceMode`) does not override any of this. A setting to preserve
private-session logs is **rejected**: a switch that undoes the privacy guarantee for
debugging convenience is how the guarantee quietly stops existing. Debugging incognito
uses the live console, not the durable log.

---

## 8. UI

### 8.1 Indicator & toggle — `src/components/Navbar.tsx` (~line 70)

- Incognito toggle button (hat-and-glasses style icon, e.g. `EyeOff` from the icon set
  already in use) beside the existing navbar controls.
- When active: a persistent badge reading **Incognito** on the navbar, plus a subtle
  accent (border or tint on the navbar — do **not** retheme the whole app; a full theme
  swap is the kind of flourish that breaks contrast in the player).
- Badge tooltip: one honest sentence — "Activity isn't being saved. Bookmarks and
  downloads you choose are still kept." (Must not imply network anonymity, §2.)

### 8.2 Player and search indicators

- `VideoPlayer.tsx`: a small chip in `.player__messages--top` (the flow column that
  already exists for stacked messages — do not add another absolutely-positioned box;
  that class of overlap bug is on record). No transport behaviour changes.
- Search screen (`src/views/SearchView.tsx`): a muted line under the search box —
  "Incognito — searches aren't saved". Same rule as the loading-stage copy: reworded,
  not decorative.

### 8.3 Renderer plumbing

- `src/utils/incognitoMode.ts` — **pure**, Node-strip-safe: types, `describeState()`
  for the badge/tooltip copy. (Naming follows `experienceMode.ts`; folded-lowercase
  module-path uniqueness is enforced by `componentReachability.test.mts`.)
- `src/components/privacy/IncognitoModeContext.tsx` — provider seeded from
  `privacy:getState` on mount, subscribed to `privacy:changed` via the unified
  `api.subscribe()` teardown pattern. Mounted in `App.tsx` beside
  `ExperienceModeContext`.
- Views read the context; **no view writes gates itself** — the main process enforces
  (§4). The renderer only _displays_ and adjusts copy.

### 8.4 Keyboard shortcut

- `Ctrl+Shift+N` (Windows/Linux) / `Cmd+Shift+N` (macOS) toggles Incognito.
- Wire it where the F12 handler lives (`App.tsx` keyboard handling) and mirror it in the
  application menu so it is discoverable — the menu is what makes any shortcut
  discoverable (AGENTS.md, navigation section). Register it in the same
  `before-input-event` style; do **not** `preventDefault` a key the page might need
  unless it actually toggled.

### 8.5 Settings — Privacy tab

- New entry in the `tabs` array of `src/views/SettingsView.tsx` (~line 278):
  `{ id: 'privacy', label: 'Privacy', icon: <Shield …/> }` — it appears in the `all`
  view automatically (the `all` view renders the same groups; no duplication).
- New `src/components/settings/PrivacyPanel.tsx` built from `SettingRow` /
  `SettingGroup`, **every row `level="basic"`** — these are viewer controls and the
  Developer-mode row precedent says visibility controls are never hidden.
- Rows:
  1. **Private browsing (Incognito)** — current state + toggle (same control as navbar).
  2. **Clear private session when exiting Incognito** — `clearSessionOnExit`, default on.
  3. **Allow downloads during private sessions** — `allowDownloads`, default on.
  4. **Ask before starting a download in Incognito** — `askBeforeDownload`, default off,
     disabled when (3) is off.
  5. **Allow bookmarks and library saves in Incognito** — `allowExplicitSaves`, default on.
  6. **Remember Incognito between launches** — `rememberPreference`, default **off**
     (private-by-default at every launch is the trustworthy failure direction; Chrome
     behaves this way).
- Each row's note states the consequence in one sentence (e.g. row 6: "When off, the app
  always starts with Incognito turned off."). Route the panel through
  `SettingsSection keywords=…` so settings search finds it.

---

## 9. Edge cases — decided, not open

| Case                                      | Decision                                                                                                                                                                                   |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Toggle on mid-playback                    | Takes effect on the next write (progress pings stop recording). Nothing already written is deleted.                                                                                        |
| Toggle off mid-playback                   | Progress resumes recording from that point; the gap is simply absent.                                                                                                                      |
| App quit while incognito                  | `before-quit` calls `clearSession()` when active (wire into the existing teardown with its 5s deadline — do not add a new teardown path). Volatile state dies with the process regardless. |
| Crash while incognito                     | Volatile tier was never on disk. Gates prevented writes. Nothing to clean — this is the main reason for gate-at-write over write-then-delete.                                              |
| Explicit save then exit                   | Bookmarks/library/downloads persist — they never went through a gated funnel. The promoted page snapshot (§6.4) persists too.                                                              |
| Incognito + adult gate                    | Independent. Incognito never widens `enabledProviderNames`; the adult session-unlock precedent stays untouched.                                                                            |
| Profiles                                  | Incognito is global, not per-profile. Switching profile mid-incognito keeps Incognito on.                                                                                                  |
| Backup export                             | Privacy settings travel (datastore section). No incognito activity exists to travel.                                                                                                       |
| `interactions:summarise` during incognito | Read-only; cards show no incognito-derived state because none was written.                                                                                                                 |
| Home feed personalised rows               | Read from the library, which received nothing. Zero-impact by construction — state this in the test plan.                                                                                  |

---

## 10. Implementation order & file checklist

Ordered so each step typechecks with `tsc -b` and ships green tests.

1. **`electron/cs3/privacyMode.ts`** (new) — the service in §4.2. Pure apart from the
   datastore; inject it.
2. **Gates** — one-line guards + tests, in this order (each independently shippable):
   - `historyStore.ts` `record()`
   - `libraryStore.ts` `recordProgress()` / `recordPlayedSource()` /
     `markPlayedSourceUnavailable()`
   - `searchHistory.ts` `record()` / `setResultCount()`
   - `main.ts` `api:recordTitleOutcome` and `interactions:visit` handlers
   - `providerAnalytics.observe()`
3. **Volatile tiers** — `sourceCache.ts` `setVolatileMode`, `pageSnapshot.ts` volatile
   capture + `promote(address)`.
4. **Downloads** — `downloadService.ts` incognito tag + `clearSession` sweep +
   `download:request` refusal path.
5. **Logging** — `logger.ts` private-mode redaction; `diagnostics.ts` stage gate.
6. **IPC** — `main.ts` handlers + push emit, `preload.ts` surface, `src/types/api.ts`
   types, **`ipcSurface.test.mts` update (mandatory)**.
7. **Renderer** — `incognitoMode.ts`, `IncognitoModeContext.tsx`, `Navbar.tsx`
   badge/toggle, `VideoPlayer.tsx` chip, `SearchView.tsx` line, shortcut, and
   `settings/PrivacyPanel.tsx` + `SettingsView.tsx` tab.
8. **Docs** — update `AGENTS.md` (new module, new `privacy:*` namespace row, the
   gate-at-write rule) in the same commit, and add this file to `docs/PRD/00-index.md`.

## 11. Test plan

Repo conventions: suites are `*.test.mts`, auto-discovered; pure modules under Node type
stripping; **mutation-verify** every gate (remove the guard, watch a test fail).

- **`electron/cs3/privacyMode.test.mts`** (new, `bun run test privacy`): transitions,
  whole-state replies, settings round-trip, `rememberPreference` persistence semantics,
  clear-on-exit.
- **Gate tests** added beside each touched store's existing suite
  (`libraryStore.test.mts`, `sourceCache.test.mts`, etc.): with privacy active, the
  write is a no-op **and** the datastore's stored string is byte-identical before/after
  (a no-op that still serialises is not a no-op — the datastore write path is debounced,
  so assert on the value, not the file).
- **Explicit-save tests**: with privacy active, bookmark save, library bucket add and
  page promote all persist; with `allowExplicitSaves` off, the handlers refuse with the
  envelope error.
- **Volatile tier**: §6.3/§6.4 cases above.
- **Renderer**: `incognitoMode.test.mts` for the pure copy helpers; the reachability
  suite (`bun run test reachability`) covers the new context/panel being mounted.
- **Manual acceptance** (mark `needs-app-run` until done — do not report as done from a
  cloud session; Electron cannot launch headless here):
  1. Enable Incognito → search, play 30s of a title, open a detail page, fail a source.
  2. Disable → History, Continue Watching, search dropdown, dead-row badges and
     "visited" dimming show **nothing** from the session.
  3. Repeat with a bookmark and a download → both present after exit; download file on
     disk; no history event for either.
  4. `rememberPreference` on → relaunch → still incognito; off → relaunch → not.

## 12. Acceptance criteria (maps to PRD §12)

| Requirement                                     | Enforced by                          | Verified by                                      |
| ----------------------------------------------- | ------------------------------------ | ------------------------------------------------ |
| No search history                               | gate §5.4                            | gate test + manual 2                             |
| No watch history / Continue Watching / progress | gates §5.1, §5.2                     | gate tests + manual 2                            |
| No last-played-source memory                    | gate §5.3                            | gate test                                        |
| No failed-playback history                      | gates §5.5, volatile §6.3            | gate tests                                       |
| No recommendation impact                        | gate §5.8 + read-side argument §9    | gate test                                        |
| Explicit saves work                             | §5.7, §6.4 promote, §6.5             | explicit-save tests + manual 3                   |
| Session isolated & cleared                      | §6, `clearSession()` + `before-quit` | privacyMode suite                                |
| Visual indicator                                | §8.1–8.3                             | reachability suite + manual 1                    |
| Privacy settings page                           | §8.5                                 | `settingsLevel`/`settingsSearch` suites + manual |
| Configurable downloads                          | §6.5                                 | download tests + manual 3                        |
| Logs respect privacy                            | §7                                   | logger/diagnostics tests                         |

## 13. What this deliberately does not build

- No second profile, no separate datastore (§6.2).
- No network-layer privacy claims (§2).
- No developer-mode log-preservation switch (§7).
- No retroactive deletion of pre-incognito activity (§2).
- No blocking of export/share channels (`sourceExport.ts`, external players) — all are
  explicit actions.
