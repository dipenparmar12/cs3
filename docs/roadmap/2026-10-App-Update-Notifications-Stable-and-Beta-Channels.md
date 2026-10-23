# PRD: App Update Notifications, Stable and Beta Channels

**Status (2026-10-23):** Proposed. Nothing built. The register entry is in `ROADMAP.md`.

**Owner decision needed before Phase 2:** §13 (three questions). Phase 1 can start without them.

---

## 1. Objective

Tell the viewer when a newer CloudStream 3 Desktop is published, and let them get it, without a server of our own. Releases live on GitHub; the app reads GitHub's public release list, compares versions, and offers the right file for the machine it runs on.

Two channels, as Android CloudStream has:

- **Stable** — tagged releases (`vX.Y.Z`), built and verified by `release.yml`. The default.
- **Beta** — builds of `master`, published as prereleases, for people who want fixes first and accept rough edges.

The viewer chooses the channel, can turn checking off, can skip a version, and is never interrupted mid-film.

## 2. What exists (checked 2026-10-23)

| Fact | Where |
|---|---|
| Releases are GitHub Releases of `dipenparmar12/cs3`; no other host | `git remote`, `.github/workflows/release.yml` |
| A `v*` tag builds 5 targets, verifies and smoke-tests every artifact, creates the release as a **draft**, uploads, then publishes. No partial releases | `release.yml`, AGENTS §3.4 |
| The version comes from the tag (semver), stamped with `--version`; `package.json` stays `1.0.0` | `release.yml` `version` job, `build-installer.mjs` |
| An **unsigned** tag build is published as an "(unsigned preview)" **prerelease**; `REQUIRE_SIGNING=true` fails it instead | `release.yml`, `docs/release/distribution.md` |
| Artifact names: `CS3-<v>-windows-x64-installer.exe`, `-portable.exe`, `-portable.zip`; `CS3-<v>-macos-<arch>.dmg`/`.zip`; `CS3-<v>-linux-<arch>.AppImage`/`.deb`/`.tar.gz` | `tools/package/package-layout.mjs` |
| `master` builds are **not** published anywhere; CI runs only on tags and manual dispatch | `.github/workflows/ci.yml`, AGENTS §3.3 |
| No code checks for app updates. (`docs/done/2026-10-051-App-updates-prd-info.md` is, despite its name, a media-sources PRD) | grep: no `releases/latest` or update checker |
| Third-party HTTP must go through `electron/torrent/http.ts` (Electron `net.fetch`: system proxy, DoH) | AGENTS §12 |
| Downloaded executables are verified before use (SEC-03): own HTTPS origin or a pinned SHA-256 | AGENTS §12, `binaryDownloader.ts` |
| Extension updates already have the right UX shape: a daily check, a bottom-right notice with Review | `cs3/extensionUpdater.ts`, `cs3/updateSchedule.ts`, `ExtensionUpdateNotice.tsx` |

## 3. Scope

**In:** checking for a newer release on the chosen channel; telling the viewer; opening or downloading the right artifact for this OS, CPU and install kind; release notes; skip and remind later; channel and check settings; the beta publishing workflow.

**Out (this PRD):** silent background installation; delta updates; an update server or CDN; telemetry about who updated. electron-updater's auto-install is deliberately not used in Phase 1 (§11).

## 4. Channels

### 4.1 Definitions

| Channel | Releases it sees | Tag form | GitHub flag |
|---|---|---|---|
| Stable | Releases with a plain semver tag | `v1.4.0` | not prerelease |
| Beta | Stable **and** beta releases | `v1.5.0-beta.20261023.42` | prerelease |

A beta viewer always gets whichever is newest, so a stable release that supersedes a beta is offered to them too. A stable viewer never sees a beta.

### 4.2 The unsigned-preview collision

Today an unsigned *stable* tag is published as a prerelease, so "prerelease" alone cannot mean "beta". The channel is read from the **tag**, not the flag: a tag with a semver prerelease part (`-beta.N`) is beta; a plain `vX.Y.Z` is stable whether or not GitHub marks it prerelease. Whether a stable viewer is offered an unsigned stable is a setting decision (§13, Q2).

### 4.3 Publishing beta builds (pipeline change)

A new workflow, `beta.yml`:

- **Trigger:** manual dispatch, and optionally a daily schedule that runs only when `master` moved since the last beta (§13, Q1). Not on every push: five targets cost real Actions minutes.
- **Version:** `<next stable>-beta.<YYYYMMDD>.<run number>`, for example `1.5.0-beta.20261023.42`, so semver orders betas by date and run.
- **Reuse:** the same build matrix, `verify-package.mjs` and `smoke-package.mjs` as `release.yml` (call it as a reusable workflow, not a copy).
- **Publish:** as a GitHub prerelease, draft first, then published (the same no-partial-release rule).
- **Retention:** delete beta releases older than the newest 5 so the list the app reads stays small.

## 5. Detecting a newer version

### 5.1 Source

`GET https://api.github.com/repos/dipenparmar12/cs3/releases?per_page=20` through `electron/torrent/http.ts`. A list, not `/releases/latest`, because `latest` excludes prereleases and the beta channel needs them. Drafts are not returned to an unauthenticated caller.

The repository must have **public releases**. A private repository answers 404 to an unauthenticated request; the checker treats that as "cannot check" and says so in Settings (§13, Q3).

### 5.2 Comparing versions

1. Parse each tag as semver (drop the leading `v`). Tags that do not parse are ignored and logged.
2. Keep releases on the viewer's channel (§4.1) that have an artifact for this platform (§6).
3. The candidate is the highest semver. Semver orders `1.5.0-beta.20261023.42` below `1.5.0`, and by date and run among betas.
4. **Dates break ties and catch mistakes:** if two releases compare equal, the later `published_at` wins. A release whose `published_at` is older than the running build's own build date is never offered, even if its version parses higher (a mis-tagged old build).
5. Offered only if the candidate is greater than the running version (`app.getVersion()`, which the tag stamp sets).

Pure, in `electron/appUpdate/releaseSelection.ts`, tested exhaustively (§12).

### 5.3 When to check

- At most once per calendar day automatically, using the same rule as extension updates (`cs3/updateSchedule.ts`, `automaticCheckDelay`), 60 s after launch, as a `background.add` task (never at module scope; AGENTS §12).
- Manually from Settings → About & support → **Check for updates**, which never uses up the day's automatic check.
- Not at all in a development build (`!app.isPackaged`) or a smoke run (`CS3_SMOKE_REPORT`).

### 5.4 Being a good API client

Unauthenticated requests are limited to 60 per hour per IP. The checker sends `If-None-Match` with the last ETag (a 304 does not count against the limit), honours `Retry-After` and `X-RateLimit-Reset` on 403 or 429, and backs off a day. One request per day per install is far inside the limit.

## 6. Choosing the artifact

From `package-layout.mjs`'s names, by `process.platform`, `process.arch` and install kind:

| Running as | Offered | Fallback |
|---|---|---|
| Windows, installed (NSIS) | `windows-x64-installer.exe` | portable `.zip` |
| Windows, portable (`PORTABLE_EXECUTABLE_DIR` set) | `windows-x64-portable.exe` | `.zip` |
| macOS | `macos-<arch>.dmg` | `.zip` |
| Linux, AppImage (`APPIMAGE` set) | `linux-<arch>.AppImage` | `.tar.gz` |
| Linux, other | `.deb` if `dpkg` exists, else `.tar.gz` | the release page |

No artifact for this platform means the release is not offered (it may still be listed in Settings as "not built for this system").

## 7. Telling the viewer

### 7.1 The notice

A non-blocking card, bottom right, the same component family as `ExtensionUpdateNotice`:

> **CloudStream 3 Desktop 1.5.0 is available** · Stable · 84 MB
> Release notes (first lines, rendered as plain text)
> [Download] [What's new] [Later] [Skip this version]

- **Never over playback:** held while the player is in front or fullscreen, shown when it closes.
- **Download** opens the artifact (§8). **What's new** opens the full release notes in a dialog. **Later** hides it until the next automatic check. **Skip this version** stores the version; the notice returns only for a newer one.
- Beta builds are labelled **Beta** and carry one line: "Previews of the next release. May be unstable."
- One notice at a time; if the extension-update notice is also due, the app-update one waits.

### 7.2 Settings → About & support

- Current version, channel, last checked and its result ("Up to date", "1.5.0 available", "Could not check: …").
- **Check for updates** button.
- **Update channel**: Stable (default) / Beta, with a sentence on what Beta means. Switching to Stable while on a beta does not offer a downgrade; it waits for the next stable above the running version.
- **Check automatically** switch (default on).
- **Skipped version** with an Unskip action.

Settings are installation-wide, not per viewer profile (it is one program on disk), and are carried by the backup's settings section.

## 8. Getting the update

### Phase 1: open the download

**Download** opens the artifact's `browser_download_url` with `shell.openExternal` (http and https only, the existing allow rule). The browser downloads it; the viewer runs it. Nothing executable is fetched by the app, so SEC-03 is untouched.

### Phase 2: download in the app (§13, Q3)

- Through `FastChunkDownloader` into the user's Downloads folder, with progress in the notice.
- **Verified before it is offered to run:** the release must carry a `SHA256SUMS` file (added to `release.yml` and `beta.yml` beside the artifacts, generated by `verify-release.mjs`), and the file's digest must match. No checksum file, or a mismatch: the file is deleted and the viewer is sent to the release page instead (SEC-03: never run an unverified binary).
- **Install now** then launches the installer (Windows NSIS, macOS opens the DMG, AppImage replaced and relaunched) and quits CloudStream after the usual shutdown (`before-quit`, flushes, mpv stopped).

## 9. Failure handling

| Case | Behaviour |
|---|---|
| Offline, DNS or TLS failure | "Could not check" with the reason in Settings; no notice; retried at the next daily check |
| 403/429 rate limit | Back off until `X-RateLimit-Reset` or a day; logged once |
| 404 (repository private or renamed) | "Updates cannot be checked for this build" in Settings; automatic checks stop until the version changes |
| Malformed JSON or tag | Ignored entries logged (`app_update_ignored_release`); the rest still compared |
| No artifact for this platform | Not offered |
| Draft or deleted release between check and download | The release page opens instead |
| Checksum missing or wrong (Phase 2) | File deleted, release page opened, logged as `app_update_checksum_failed` |

A failed check never shows the viewer an error dialog. "A catch that reassures is worse than no catch" (AGENTS §4.1) applies: Settings states the real reason.

## 10. Design

### 10.1 Modules

| Module | Responsibility |
|---|---|
| `electron/appUpdate/releaseSelection.ts` | Pure: parse tags, channel rule, semver and date comparison, artifact choice, skipped version |
| `electron/appUpdate/appUpdateService.ts` | Schedule, fetch with ETag, state, settings, events; Phase 2 download and verify |
| `src/components/AppUpdateNotice.tsx` | The notice (§7.1) |
| `src/components/settings/AppUpdateSettings.tsx` | The settings rows (§7.2) |
| `.github/workflows/beta.yml` | Beta builds (§4.3) |
| `tools/package/verify-release.mjs` | Writes `SHA256SUMS` (Phase 2) |

### 10.2 IPC (four places change together, AGENTS §4.1)

| Channel | Shape |
|---|---|
| `appUpdate:getState` | `{ current, channel, autoCheck, lastCheckedAt, lastResult, available?: { version, channel, publishedAt, notes, asset: { name, size, url } }, skipped? }` |
| `appUpdate:check` | Manual check; returns the whole state |
| `appUpdate:setSettings` | `{ channel?, autoCheck? }`; returns the whole state |
| `appUpdate:skip` / `appUpdate:unskip` | Version; returns the whole state |
| `appUpdate:openDownload` | Opens the asset URL (Phase 1) |
| `appUpdate:download` / `appUpdate:install` | Phase 2 |
| push `appUpdate:changed` | Whole state, on every change |

Whole state every time, never deltas (AGENTS §12).

### 10.3 Datastore keys

`app_update_channel`, `app_update_auto_check`, `app_update_last_check`, `app_update_etag`, `app_update_skipped_version`. Installation keys (not in `profileKeys.ts`); in the backup's settings category.

## 11. Security and privacy

- Only `api.github.com` and the release's own asset URLs on `github.com` / `objects.githubusercontent.com` are contacted, over HTTPS.
- Nothing about the viewer is sent: no identifiers, no version telemetry beyond what any HTTP request carries (IP, user agent). Turning off **Check automatically** stops all contact.
- Release notes are untrusted text: rendered as plain text, links opened only through `shell:openExternal` (http, https).
- electron-updater is not used in Phase 1: its auto-install needs signed builds to be safe and smooth (unsigned NSIS triggers SmartScreen; unsigned macOS updates fail Gatekeeper), and this project still ships unsigned previews (AGENTS §3.4). Revisit when signing is on.
- Phase 2 runs nothing that has not matched its published SHA-256.

## 12. Tests

- `releaseSelection.test.mts`: stable ignores betas; beta sees both and takes the newest; an unsigned stable prerelease counts as stable; equal versions decided by date; an older-dated, higher-tagged release is refused; a malformed tag is skipped; a skipped version is not offered but a newer one is; no artifact for this platform means no offer; Windows installed vs portable, Linux AppImage vs deb vs tarball, macOS arm64 vs x64.
- `appUpdateService` with a stubbed fetch: once per day; manual checks do not use up the daily one; ETag 304 keeps the previous answer; 403 with `X-RateLimit-Reset` backs off; 404 stops automatic checks; offline reports the reason.
- Renderer: the notice is held while the player is in front; Later and Skip behave as specified.
- Pipeline: a `beta.yml` dry run (`workflow_dispatch` without publishing) produces `1.5.0-beta.<date>.<run>` artifacts that pass `verify-package.mjs`.
- Phase 2: a checksum mismatch deletes the file and opens the release page.

## 13. Open decisions

1. **Beta cadence:** manual only, or daily when `master` moved? (Actions minutes: five targets per build.)
2. **Unsigned stable releases:** offer them to stable viewers (today they are the only releases), or only when signed?
3. **In-app download (Phase 2):** wanted, or is opening the browser enough? It needs `SHA256SUMS` in every release.

## 14. Phases

| Phase | Work | Done when |
|---|---|---|
| 1 | `releaseSelection.ts` + service + IPC + notice + settings; opens the download in the browser | A packaged stable build sees a newer tag within a day and offers the right file; tests in §12 pass |
| 2 | `beta.yml`; channel switch live | A beta viewer is offered a `-beta` build and a stable viewer is not |
| 3 | `SHA256SUMS` in releases; in-app download, verify, install | A verified installer runs from the notice; a tampered file never does |

## 15. Acceptance criteria

1. With no server of our own, a packaged build learns of a newer release on its channel within one day of publication.
2. Stable viewers never see beta builds; beta viewers see whichever is newest.
3. The offered file matches the OS, CPU and install kind, or the release is not offered.
4. Versions are compared by semver, with publication dates breaking ties and refusing mis-tagged older builds.
5. The viewer can skip a version, postpone, switch channel and turn checking off; nothing interrupts playback.
6. A failed check states its reason in Settings and never raises a dialog.
7. The checker stays far inside GitHub's unauthenticated limit (one conditional request a day).
8. No executable runs without a matching published SHA-256 (Phase 3).
9. Development builds and smoke runs never check.
