# PRD-52 — Custom (user-added) repositories: persistence, identity and parity with bundled repositories

Status: **Proposed — ready to implement.** Every reference below was verified against the code
on 2026-09-30. Where this document and the code disagree at implementation time, the code wins
and this document is fixed in the same commit (repo rule, AGENTS.md §13).

Requirement ids used below: **CR-1…CR-10**. They are the anchors for tests and commit messages.

---

## 1. What this is

A user can paste any CloudStream repository URL into the extensions screen. That repository must
behave exactly like a bundled one — its providers searchable, its sources playable and
downloadable, its enable/disable/update/remove controls identical — while remaining visibly
marked as **user-added (custom)**, surviving restarts, app updates and reinstalls that preserve
user data, and never being touched by changes to the app's bundled repository list.

### 1.1 Why this PRD exists

The mechanism is **already half-built and the gaps are specific**. `PluginManager.addRepository`
exists, verifies the URL by fetching it, and persists the resolved URL. What is missing is
everything that makes a custom repository a _first-class, identifiable, durable_ object rather
than a bare string in a list. This PRD is the gap list with the fix for each, not a greenfield
design.

---

## 2. Current state — measured, with file:line

Read this section before writing any code. It is the "extra research" already done.

### 2.1 What already works (do not rebuild)

| Behaviour                             | Where                                                                                                                                              | Notes                                                                                                                                                                                                                 |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Add by URL, verified before kept      | [pluginManager.ts](../../cs3_windows/electron/pluginManager.ts) `addRepository` (~L1277)                                                           | Fetches the document first; an unreachable or non-repository URL is refused with the reason. Project pages are resolved to raw documents via `rawDocumentCandidates` (~L503) and `resolveRepositoryDocument` (~L562). |
| Persistence                           | `persist()` (~L953) writes `installed_repositories_urls` through `DatastoreManager.setObject`                                                      | The datastore lives in `app.getPath('userData')/cs3_datastore.json`, is debounced (250 ms) and written temp-file-plus-rename. userData survives app updates and NSIS reinstalls by default.                           |
| Startup restore                       | `restore()` (~L938) reads `installed_repositories_urls` into `installedRepoUrls`                                                                   | Runs in the constructor; no IPC or window needed.                                                                                                                                                                     |
| Remove with cascade                   | `removeRepository` (~L1446)                                                                                                                        | Deletes the URL **and** uninstalls every extension that came from it, and cleans the disabled set so a re-added repository does not arrive silently off.                                                              |
| Enable/disable                        | `cs3_disabled_repositories` datastore key (~L376) via `DisabledSet`                                                                                | Keyed by repository URL. Reversible; archives are kept.                                                                                                                                                               |
| Updates                               | [extensionUpdater.ts](../../cs3_windows/electron/cs3/extensionUpdater.ts) L360, L568 iterate `getInstalledRepositories()`                          | Custom repositories are already in that set, so their extensions already update OTA.                                                                                                                                  |
| Background install                    | [extensionJobs.ts](../../cs3_windows/electron/cs3/extensionJobs.ts) L36–39: `addRepository` / `installRepository` job kinds                        | The screen queues jobs; one job per target; whole-state snapshots.                                                                                                                                                    |
| UI entry point                        | [RepositoryCatalog.tsx](../../cs3_windows/src/components/extensions/RepositoryCatalog.tsx) ~L175–241                                               | Custom URL input + Add button, wired through `ExtensionsScreen.tsx` L338 to the job queue.                                                                                                                            |
| Search/scope/playback/download parity | `enabledProviderNames` funnel                                                                                                                      | Once an extension from any repository is installed, its providers are indistinguishable downstream. **This already holds and needs no change.**                                                                       |
| Backup                                | `BackupService` `settings` section ([main.ts](../../cs3_windows/electron/main.ts) L5704) collects `datastore.snapshot()` — the **whole** datastore | `installed_repositories_urls` is already inside it. Any new datastore key added by this PRD is backed up automatically.                                                                                               |

### 2.2 The gaps this PRD closes

**GAP-1 — Repository metadata is discarded at add time.**
`fetchRepository` returns `{ repositoryUrl, name, description, iconUrl, plugins, warnings }`
(~L1240) and `addRepository` keeps only the URL. The comment at ~L300 says it plainly: _"the
plugin records keep the URL and nothing else."_ After a restart the tree labels a custom
repository by `repositoryLabel(url)` (~L303) — `owner/repo` for GitHub, a bare hostname
otherwise — with no description, no icon, no plugin count, no record of when it was added.

**GAP-2 — A repository with zero installed extensions is invisible.**
`getProviderTree()` (~L2176) builds its repository nodes exclusively by iterating
`installedPlugins` (~L2194). A custom repository that was added but whose extensions the user
has not installed yet appears **nowhere** on the Installed tab — the exact "a row that vanishes"
failure the `addRepository` doc comment (~L1256) says was fixed, still present for the
added-but-empty case.

**GAP-3 — There is no "custom" identity.**
`ProviderTreeRepository` (~L266) carries `bundled: boolean` and nothing else. A user-added URL
that happens to match the official catalogue is labelled and badged exactly as if the app had
shipped it; one that does not match is merely _not_ bundled. Neither state says "you added
this". The requirement "clearly identify user-added repositories as external/custom" and "do
not treat custom repositories as application-managed" cannot be met without an explicit,
persisted origin.

**GAP-4 — Re-adding is not reported.**
`installedRepoUrls.add(url); persist()` is idempotent in effect but `addRepository` answers
"Added X — N extensions available" every time, including when nothing changed. A user testing
whether the app remembered their repository gets an answer that implies it did not.

**GAP-5 — No health signal for a custom repository that goes dark.**
A bundled repository is maintained by us; a custom one can 404, be force-pushed empty, or turn
into an HTML page. Today nothing notices. The requirement is _not_ auto-removal (§7, NG-3) —
it is that the screen says so, once, in the row, instead of the repository silently answering
zero extensions forever.

**GAP-6 — Bootstrap/bundled-list changes are safe only by accident.**
`BootstrapService.run()` filters targets on `!already.has(rawRepoUrl)`, so it happens not to
touch custom URLs today. Nothing pins that. A future bootstrap change that "reconciles" the
installed set against the bundled list would delete custom repositories, and no test would
fail. This PRD adds the pin (CR-9), not a behaviour change.

---

## 3. Requirements

| Id    | Requirement                                                                                                                                                  | Gap                                        | Verification                              |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------ | ----------------------------------------- |
| CR-1  | Custom repository URLs persist in user data and are restored at startup                                                                                      | exists (§2.1)                              | regression test pinning the datastore key |
| CR-2  | Custom repositories survive app updates and reinstalls that preserve user data                                                                               | exists by platform (userData); document it | manual checklist §9.4                     |
| CR-3  | Repository metadata (name, description, icon, plugin count, added-at, last-check) is persisted at add time and refreshed, never replaced by a failed refresh | GAP-1                                      | unit tests §9.1                           |
| CR-4  | An added-but-empty repository is visible and manageable on the Installed tab                                                                                 | GAP-2                                      | unit tests §9.1                           |
| CR-5  | Every repository node carries an explicit origin — `bundled` \| `catalogue` \| `custom` — and the UI marks custom rows                                       | GAP-3                                      | unit + lexical tests §9.1                 |
| CR-6  | Custom repositories' providers participate in search, scope, source discovery, playback and downloads identically to bundled ones                            | exists via the funnel; pin it              | integration test §9.2                     |
| CR-7  | Enable, disable, update, remove work per custom repository, independently of all others                                                                      | exists for enable/remove; pin update path  | integration test §9.2                     |
| CR-8  | Re-adding an existing repository (by any of its known spellings) reports "already added" and changes nothing                                                 | GAP-4                                      | unit tests §9.1                           |
| CR-9  | A change to `official_repositories.json` or a bootstrap re-run never adds, removes, re-labels or re-origins a custom repository                              | GAP-6                                      | unit tests §9.1                           |
| CR-10 | A custom repository that stops answering is **reported** on its row, never removed and never silently empty                                                  | GAP-5                                      | unit tests §9.1                           |

Non-functional: TypeScript `strict`, no `any`; comments explain _why_; Conventional Commits
(`feat(cs3):`); `AGENTS.md` and this PRD updated in the same commit as the code.

---

## 4. Design

### 4.1 Data model — two new datastore keys

Both live in the datastore (so §2.1's backup row covers them with no `BackupService` change)
and are read/written only inside `PluginManager`.

```ts
// electron/pluginManager.ts

/** Datastore key: metadata for user-added repositories. CR-3. */
const SETTINGS_KEY_CUSTOM_REPOSITORIES = 'cs3_custom_repositories'

/** What we remember about a repository the user added by URL. */
export interface CustomRepositoryRecord {
  /** The resolved raw-document URL. This is the identity; it never changes. */
  url: string
  /** Every spelling the user successfully added it by (project page, alias). CR-8. */
  aliases: string[]
  name: string
  description?: string
  iconUrl?: string
  /** Size of the plugin list at last successful fetch. */
  pluginCount: number
  /** Epoch ms of the first successful add. Never updated. */
  addedAt: number
  /** Epoch ms of the last successful fetch. */
  lastCheckedAt: number
  /**
   * Set when the most recent refresh failed; cleared by the next success.
   * Carries the classified reason, never the raw exception. CR-10.
   */
  unreachableSince?: number
  unreachableReason?: string
}
```

Rules:

- **The record is written only on success or marked on failure — never deleted by a failure.**
  A repository that 404s today keeps its name, its icon and its installed extensions.
  (Same rule the source cache and the played-source store already follow: a dead link is
  marked, not erased.)
- **`addedAt` is written once.** It is the answer to "which of these did I add recently", and
  a refresh that rewrote it would make the field meaningless.
- **`aliases` exists because the two ends hold different URLs by design** — the same problem
  `findOfficialRepository` (~L343) already documents for the catalogue. The user pastes
  `https://github.com/owner/repo`; what resolves and gets stored is
  `https://raw.githubusercontent.com/owner/repo/builds/repo.json`. Re-adding the project page
  must hit the same record (CR-8), which requires remembering both spellings.
- **Nothing outside `PluginManager` reads this key.** The tree (§4.3) is the only consumer
  surface, exactly as `installedRepoUrls` is today.

### 4.2 Add flow — `addRepository` becomes the single funnel

`PluginManager.addRepository` (~L1277) changes shape; its public signature and return type do
not. Every existing caller (`main.ts` L477, L4677, L5937, the job queue runner) keeps working.

```
addRepository(rawInput):
  1. trim; empty → refuse (existing)
  2. ALREADY KNOWN?  (CR-8)
       resolve candidates = rawDocumentCandidates(rawInput) ∪ {rawInput}
       if any candidate ∈ installedRepoUrls
            or matches a CustomRepositoryRecord.url/alias:
         → refresh that record's metadata (§4.4) and return
           { ok: true, alreadyAdded: true, message: `<name> is already added.` }
  3. fetch + validate (existing resolveRepositoryDocument path)
       failure → { ok: false, message } (existing wording)
       empty plugin list → { ok: false, message } (existing wording)
  4. installedRepoUrls.add(resolvedUrl); persist()            (existing)
  5. write CustomRepositoryRecord { url: resolvedUrl,
        aliases: [rawInput] (plus the resolved url if different),
        name/description/iconUrl/pluginCount from the fetch,
        addedAt: now, lastCheckedAt: now }                     (CR-3)
  6. return { ok: true, message, name, plugins }               (existing shape)
```

`planRepositoryInstall` (~L1362) and `installRepository` (~L1334) also call
`this.installedRepoUrls.add(...)`. They gain the same record-write (step 5) via a shared
private `rememberRepository(result, rawInput)` helper, so a repository installed wholesale
without an explicit "Add" is still recorded. **One helper, three call sites** — a fourth copy
of this logic is how the two would drift.

Return-type addition (non-breaking): `{ ok, message, name?, plugins?, alreadyAdded?: boolean }`.
The renderer shows "already added" as an info toast rather than a success toast; no envelope
change, so `ipcSurface.test.mts` is untouched.

### 4.3 The tree — zero-extension repositories and the origin field

Two changes to `getProviderTree()` (~L2176):

**a) Seed from the installed list, not only from installed plugins (CR-4).**
Before the `installedPlugins` loop, create a node for every URL in `installedRepoUrls` (and
the sideload bucket stays as-is). The plugin loop then fills extensions into nodes that already
exist instead of creating them. An empty custom repository renders with `extensionCount: 0`
and an "Install all" / "Browse" action rather than being absent.

**b) Add `origin` to `ProviderTreeRepository` (CR-5).**

```ts
export interface ProviderTreeRepository {
  // ...existing fields unchanged...
  bundled: boolean // unchanged: catalogue says bundled
  /** Where this repository came from. CR-5. */
  origin: 'bundled' | 'catalogue' | 'custom'
  /** Present for custom repositories — the persisted metadata. CR-3. */
  custom?: CustomRepositoryRecord
}
```

Resolution order per node, and the order is load-bearing:

1. `customRepository(url)` record exists → `origin: 'custom'`, and the record's
   `name/description/iconUrl` **win over** the catalogue's. A user-added repository is labelled
   by what the user added, even if we later catalogue it.
2. else `findOfficialRepository(url)` → `origin: bundled ? 'bundled' : 'catalogue'`, catalogue
   metadata, as today.
3. else → `origin: 'custom'` with a label from `repositoryLabel(url)`. This covers legacy
   installs: any URL in `installedRepoUrls` that is not in the catalogue and has no record
   (added before this feature) is _definitionally_ user-added, and must be shown as such rather
   than pretending the app shipped it.

`bundled` stays on the interface unchanged — other consumers read it, and `origin` does not
replace it 1:1 (`catalogue` ≠ "not bundled" is a distinction the update flow cares about).

**Renderer change** ([SourceTree](../../cs3_windows/src/components/extensions/SourceTree.tsx)
and the row rendering): a "Custom" badge on rows where `origin === 'custom'`, plus the
`unreachableReason` line when set (CR-10). Standard mode shows "Added by you"; developer mode
may add the raw URL (which provenance already shows). No jargon gate on the badge itself —
knowing you added something is not a developer concept (§settings-level rule: a privacy/choice
surface is never held back).

### 4.4 Refresh — background, best-effort, non-destructive (CR-10)

A new private `refreshCustomRepositories()` on `PluginManager`:

- Registered as a **startup queue task** ([util/startupQueue.ts](../../cs3_windows/electron/util/startupQueue.ts)),
  priority below provider warm-up, lane `extension-updates` if that lane exists for the updater
  — repository fetches are network-bound and safe to overlap, but the queue's serial default is
  fine and simpler. Nothing about this may run at module scope (AGENTS.md §12).
- For each custom record: `fetchRepository(url)` with the existing 15 s timeout.
  - Success → update `name/description/iconUrl/pluginCount/lastCheckedAt`, clear
    `unreachable*`. Add the fetched name to `aliases` if the repository renamed itself — no,
    keep `aliases` to _URLs only_; names are display data.
  - Failure → set `unreachableSince` (only if unset — the first failure is when the clock
    starts) and `unreachableReason = classifyFailure(error)`'s grouping form. **Never delete,
    never blank.**
- Cadence: once per launch, not on a timer. A repository list is not volatile enough to poll,
  and these are third-party hosts (the `SourcePrefetcher` restraint argument applies).
- The tree reads the records synchronously from memory; the refresh only rewrites the store.
  Nothing on any screen waits for it.

### 4.5 Remove — one extra step

`removeRepository` (~L1446) gains: delete the `CustomRepositoryRecord` (all URLs in its
candidate set) and persist. Everything else — the extension cascade, the disabled-set cleanup —
already handles arbitrary URLs. After removal, re-adding the same URL is a fresh add with a
new `addedAt`: removal is the user's explicit undo and must actually forget.

### 4.6 Enable/disable — no code change, one pin

`cs3_disabled_repositories` is keyed by URL and already works for any repository (CR-7).
`setRepositoriesEnabled` returns whole state (the bulk-is-the-primitive rule). The work here is
a test (§9.2) proving a disabled custom repository's providers leave `enabledProviderNames`
and return when re-enabled.

### 4.7 Bootstrap isolation — pin, don't change (CR-9)

Add a test, not code: seed the datastore with a custom URL, run `BootstrapService.run()`'s
target filter, assert the custom set is byte-identical afterwards and the custom URL was never
a bootstrap target. If a future bootstrap change breaks that, the test names the regression.

### 4.8 Search/scope/playback/download parity — pin, don't change (CR-6)

The funnel is `enabledProviderNames`; providers do not know their repository's origin and must
not. The work is an integration test (§9.2): install from a custom repository (fixture), then
assert its providers appear in `getSearchScopeOptions`, are asked by `SearchSession.plan()` when
nothing is scoped, and are excluded when the repository is disabled. If any of those fail, the
bug is in the funnel, not here — the test is the tripwire.

---

## 5. IPC surface

**No new channels.** `ipcSurface.test.mts` must pass with zero allow-list edits.

- `extension:addRepository` (exists, `main.ts` L4675) — response gains the optional
  `alreadyAdded` flag. Additive payloads do not trip the surface test.
- `extension:getProviderTree` (existing channel) — nodes gain `origin` and `custom`.
- The job queue (`enqueueJobs` with `kind: 'addRepository'`) is unchanged.

Type additions go in [src/types/plugin.ts](../../cs3_windows/src/types/plugin.ts) wherever
`ProviderTreeRepository` is mirrored for the renderer — the shared-types-both-sides rule
applies; the renderer must import the type, not redeclare it.

---

## 6. UI changes

| Surface                                                                                      | Change                                                                                                                                                                                                                                                                    |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [RepositoryCatalog.tsx](../../cs3_windows/src/components/extensions/RepositoryCatalog.tsx)   | Custom URL form: unchanged entry point. On `alreadyAdded`, show "Already in your repositories" as neutral feedback, not an error.                                                                                                                                         |
| Installed tab ([SourceTree.tsx](../../cs3_windows/src/components/extensions/SourceTree.tsx)) | Zero-extension custom repositories render (CR-4) with name, "Added by you" badge, added date, and an Install-all action. Rows with `unreachableReason` show one muted line: "Could not be reached since \<date\> — \<reason\>. Your installed extensions are unaffected." |
| Repository row badge                                                                         | `origin === 'custom'` → a "Custom" chip beside the existing bundled/catalogue labelling (CR-5).                                                                                                                                                                           |
| Remove confirmation                                                                          | Existing cascade dialog; copy gains the extension count for custom repositories exactly as for catalogue ones.                                                                                                                                                            |

Nothing here is developer-mode gated (the §settings-level rule about choices and provenance).

---

## 7. Non-goals

- **NG-1: Repository discovery.** No "find more repositories" directory beyond the existing
  catalogue. The user supplies the URL.
- **NG-2: Editing a custom repository.** URL and identity are immutable; remove + re-add is
  the edit.
- **NG-3: Auto-removal of dead repositories.** Ever. A host being down is not consent to
  delete the user's configuration — the same rule as "nothing is ever auto-disabled" in the
  provider ranking.
- **NG-4: Per-repository provider ranking changes.** Custom providers rank by the same
  measured behaviour as everyone else's.
- **NG-5: Sync across devices.** The datastore backup/restore path already carries the keys;
  anything beyond that is a separate feature.
- **NG-6: Treating a custom repository as trusted code.** Verification (SHA-256 against the
  repository's own `fileHash`, analysis tiering, the adult gate per plugin) is unchanged and
  applies identically. The mirror-hash lesson applies: a hash is checked against the index
  that published it, never trusted because the URL came from the user.

---

## 8. Risks and mitigations

| Risk                                                              | Mitigation                                                                                                                                                                                                                                                                                                                     |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A custom URL later enters the official catalogue → two identities | Origin rule §4.3(b): the custom record wins the label; `findOfficialRepository` still supplies `verified`/category. One node, one row. Test: seed both, assert a single tree node with `origin: 'custom'`.                                                                                                                     |
| Legacy installs (pre-feature custom URLs with no record)          | Rule 3 of §4.3(b) synthesises `origin: 'custom'` from presence in `installedRepoUrls` + absence from the catalogue. The next successful refresh (§4.4) backfills a full record — lazily, no migration script.                                                                                                                  |
| A user adds an adult-content repository by URL                    | No catalogue `adult` flag exists for it. The existing per-plugin NSFW filters apply: `planRepositoryInstall` skips NSFW `tvTypes` unless allowed (~L1380), and `enabledProviderNames` gates NSFW providers. Documented, no new code. Test: fixture repository with an NSFW plugin, gate off → skipped with the count reported. |
| Refresh adds startup latency                                      | It is a queued background task that rewrites a store nobody blocks on (§4.4). If it never runs, every screen is still correct — just possibly stale by one launch.                                                                                                                                                             |
| `getProviderTree` seeding changes the shape for existing callers  | Empty-repository nodes are _additive_; every existing node is byte-identical. The tree's consumers already handle `extensionCount: 0` because that is the sideloaded bucket's normal state.                                                                                                                                    |
| Datastore write volume                                            | Two keys, written on add/remove/refresh only. Far below the debounce-coalesced chatter the datastore already absorbs.                                                                                                                                                                                                          |

---

## 9. Test plan

### 9.1 New pure unit suite — `electron/customRepositories.test.mts`

Run via `bun run test custom-repositories` (add the alias to
[scripts/test-runner.mjs](../../cs3_windows/scripts/test-runner.mjs) `PRESET_ALIASES`; suites
are auto-discovered so the alias is the only edit). Extract the record logic into a small pure
module — `electron/cs3/customRepositories.ts` — injected with the datastore and a fetch
function, for the same reason `resumePlan.ts` and `ottPlatforms.ts` are pure: every wrong
answer here is silent and plausible.

Cases (each is one named test):

1. Add new → record written with `addedAt`, `pluginCount`, alias list contains the pasted URL.
2. Re-add by the same URL → `alreadyAdded: true`, `addedAt` unchanged.
3. Re-add by the project page after adding by the raw URL (and vice versa) → same record,
   `aliases` grows, no duplicate in `installedRepoUrls` (CR-8).
4. Refresh success → metadata updated, `lastCheckedAt` bumped, `unreachable*` cleared.
5. Refresh failure → `unreachableSince` set **once** (a second failure does not move the
   clock), reason classified, name and plugin count **not** blanked (CR-10).
6. Remove → record and all aliases gone, URL gone from `installedRepoUrls`; re-add starts a
   fresh `addedAt`.
7. Persistence round-trip: write records, construct a fresh store over the same datastore
   double, records present (CR-1).
8. Bootstrap isolation: custom URLs present → bootstrap target selection never returns them,
   custom set unchanged afterwards (CR-9).
9. Tree origin resolution: custom-with-record beats catalogue match; catalogue-only →
   `catalogue`; unknown URL → `custom` (legacy backfill rule).
10. Tree seeding: an installed repository with zero installed extensions appears with
    `extensionCount: 0` (CR-4).

Mutation-verify the suite: deleting the record write (step 5 of §4.2), the zero-extension
seed, the origin precedence, or the failure-preserves-metadata rule must each fail a test.

### 9.2 Integration pins (extend existing suites)

- `electron/officialRepositories.test.mts` — assert nothing in the catalogue is _marked_ custom
  and the data file cannot express one (the catalogue has no `origin` field; keep it that way).
- Provider-scope suite (`bun run test source-scope` or a new case in the search suites) —
  fixture extension "from" a custom URL: appears in scope options, asked in an unscoped
  search, excluded when its repository is disabled, back when re-enabled (CR-6, CR-7).
- `bun run test ipc` — passes with **no** allow-list changes (§5).

### 9.3 Regression suites that must stay green

`bun run test --fast` (all pure suites), `bun run test repositories`,
`bun run test jobs`, `bun run test updater` (the updater reads `getInstalledRepositories` —
its behaviour must not change), `bun run test reachability` (the new module must be imported
by something — the orphan-component failure mode).

### 9.4 Manual verification checklist (a running app; mark `needs-app-run` until done)

1. Fresh profile → add a custom repository by project-page URL → it appears on Installed
   with its real name and a Custom badge, zero extensions.
2. Install one extension from it → provider appears in the scope picker; an unscoped search
   asks it; a source from it plays and downloads.
3. Restart the app → repository, badge, extension and provider all present (CR-1).
4. Disable the repository → its providers vanish from search; re-enable → they return (CR-7).
5. Re-add the same repository by its raw URL → "already added", no duplicate (CR-8).
6. Remove it → its extensions are uninstalled and reported by name; re-adding works.
7. Export a backup, wipe userData, restore → the custom repository is back (datastore
   snapshot coverage, CR-2's backup half).
8. `bun run dist:win` → install over the previous build → custom repository intact (CR-2).

---

## 10. Implementation order (each step is its own commit)

1. **`electron/cs3/customRepositories.ts`** — the pure store (record type, alias resolution,
   add/refresh/remove semantics) + `customRepositories.test.mts` cases 1–7. No wiring yet.
2. **`pluginManager.ts`** — wire the store into `addRepository`, `planRepositoryInstall`,
   `removeRepository`, `restore`; the `rememberRepository` helper; the `alreadyAdded` return
   flag. Tests 8–9.
3. **`pluginManager.ts` `getProviderTree`** — zero-extension seeding + `origin`/`custom`
   fields; shared type update in `src/types/plugin.ts`. Test 10 + tree shape cases.
4. **`refreshCustomRepositories`** — startup-queue registration in `main.ts`, failure
   marking. CR-10 tests.
5. **Renderer** — badge, zero-extension rows, unreachable line, `alreadyAdded` toast
   ([SourceTree.tsx](../../cs3_windows/src/components/extensions/SourceTree.tsx),
   [RepositoryCatalog.tsx](../../cs3_windows/src/components/extensions/RepositoryCatalog.tsx),
   [ExtensionsScreen.tsx](../../cs3_windows/src/components/extensions/ExtensionsScreen.tsx)).
6. **Docs** — this PRD's status → implemented; `AGENTS.md` services table gains
   `cs3/customRepositories.ts` with one dense entry; `docs/PRD/00-index.md` gains the row.

Steps 1–2 are the whole persistence story and are independently shippable. Steps 3–5 are the
identity/visibility story. Do not land 5 before 3 — a badge reading a field nothing sets is
the wired-to-nothing failure mode this repo has pinned four times.

---

## 11. Acceptance criteria

- All §9.1/§9.2 tests pass and are mutation-verified; `bun run test --fast` and
  `bun run typecheck` (`tsc -b`) are green.
- Every CR row in §3 maps to at least one automated test or one checked box in §9.4.
- A custom repository is visually distinguishable from bundled and catalogue repositories on
  every screen that lists repositories.
- Removing the app and reinstalling **with user data preserved** retains custom repositories;
  uninstalling _with_ data deletion does not (that is the user's explicit choice, not data
  loss).
- No change to how bundled repositories install, update or bootstrap; `bun run test updater`
  and the bootstrap tests pass unmodified.
