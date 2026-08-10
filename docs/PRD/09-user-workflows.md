# 09 — User Workflows

**Generated:** 2026-08-10
**Baseline:** commit `a72f9e6c`

End-to-end journeys, each with preconditions, steps, alternates, failures, and the data touched. WF-2 is the workflow this entire project is judged on.

---

## WF-1 — First launch (new user)

**Precondition.** Fresh install, no data.

1. App starts; window at default size.
2. Setup wizard (FEAT-SETUP-1): language → density/10-foot → media types → provider languages → extensions → *"Import from Android?"*.
3. User declines import.
4. Extensions step: prebuilt repositories offered; user adds one and installs a provider.
5. Home loads from the newly installed provider.

**Alternates.** Skip every step (all defaults). No network — extensions step is skippable with an explanatory note.
**Failures.** Repository unreachable → retry offered, wizard still completes. Plugin install fails → error names the plugin, wizard continues.
**Data touched.** `app_locale`, `app_layout_key`, `prefer_media_type_key_2`, `provider_lang_key`, `REPOSITORIES_KEY`, `PLUGINS_KEY`, profile 0.
**Acceptance.** Completes offline. Completes in under two minutes with network. No step is unskippable.

---

## WF-2 — Migrating from Android ★

**This is the workflow the product is judged on.**

**Precondition.** The user has a `CS3_Backup_*.txt` from Android, transferred to the desktop machine.

1. Settings → Backup & Restore → **Import**, or the wizard's import step.
2. Native file dialog, filtered to `.txt` and `.json` but accepting any file.
3. **Analysis (read-only).** The app parses the file, detects the format, infers the source and approximate version from the key set, and counts records per category. Nothing is written.
4. **Preview.** A categorized report:
   - *Will import* — profiles (N), watch progress (N), bookmarks (N), favourites (N), subscriptions (N), resume-watching (N), search history (N), repositories (N), settings (N), subtitle style, quality profiles, sync mappings (N).
   - *Will transform* — legacy `rating`→`score` (N); legacy resume-watching key→current (N); resume entries pointing at downloads (N, will import as unresolved); `app_layout_key` semantic remap.
   - *Cannot import* — plugin binaries (repositories will be re-fetched instead), auth tokens (re-login required), download queue and files, tracker list caches, biometric setting. **Each with a one-line reason.**
   - *Unrecognized* — any key the desktop app does not understand, listed and **preserved verbatim** for export round-trip.
   - *Conflicts* — existing records that collide, with the chosen strategy shown.
5. User picks a conflict strategy: **Merge, preferring imported** (default) · **Merge, preferring existing** · **Replace everything** · **Import only new**.
6. **Pre-import snapshot** created automatically. Its location is shown.
7. **Staged import** with progress, per-category counts, and a working Cancel.
8. **Commit** atomically, or roll back entirely on any failure.
9. **Report.** Imported / transformed / skipped / conflicted counts, exportable as a text file, with a link to the snapshot.
10. UI refreshes; library, history, and settings are populated.

**Alternates.** Import settings only. Import user data only. Import a single profile. Dry run (steps 3–5, then stop).
**Failures.**
- Not a recognized backup → explain what was expected; offer to show the first bytes.
- Malformed JSON → report byte offset; offer partial import of the salvageable portion, clearly labelled.
- Interrupted (crash/power loss) → next launch detects the incomplete staging area and offers rollback or resume.
- Disk full during snapshot → abort **before** any mutation.
- Cancelled → roll back to the snapshot; state is exactly as before.

**Data touched.** Everything in [06](06-data-models.md) §7 "fully portable" and "portable with transformation".
**Acceptance.** [17](17-acceptance-criteria.md) AC-10 … AC-22.

---

## WF-3 — Installing a provider

**Precondition.** Network.

1. Extensions → Add repository.
2. Paste a URL, a `cloudstreamrepo://` link, a `cs.repo` link, or a short code.
3. Repository resolves; plugin list renders with name, author, version, language, status.
4. User installs a plugin: download → **SHA-256 verify** → atomic move → load → providers register.
5. Provider appears in the homepage selector and search filters.

**Alternates.** Install from a local file. Enable auto-update. Install multiple at once.
**Failures.** Unreachable repository → retry; the repository can still be saved. **Hash mismatch → installation aborts with expected-vs-actual shown; the partial file is deleted.** Load failure → the plugin is marked failed and quarantined; other plugins are unaffected; repeated failures engage safe mode.
**Data touched.** `REPOSITORIES_KEY`, `PLUGINS_KEY`.
**Acceptance.** Hash verification is mandatory when supplied. An interrupted install never leaves a loadable partial. A failing plugin never prevents app start.

---

## WF-4 — Finding and playing something

1. Search (`Ctrl+K`) → type a query.
2. Results stream in per provider.
3. Open a result → detail page loads via `load(url)`, merged with local state.
4. Choose an episode → **Play**.
5. `loadLinks` streams sources and subtitles; the quality profile ranks them; the best opens.
6. Position restores if a prior `PosDur` exists.
7. Subtitles auto-select per `subs_auto_select`; auto-download runs if enabled.
8. On exit, progress is written (if duration ≥ 30 s) and resume-watching updated.

**Alternates.** Play from continue-watching. Play from library. Manual source switch. External player handoff. Open a local file. Magnet/torrent link.
**Failures.** No sources → explicit state naming the provider, with retry. Source fails → auto-advance to the next-ranked mirror. Codec unsupported → offer the native-player backend with a clear explanation. Network drop → pause and retry with backoff; **progress is preserved**.
**Data touched.** `video_pos_dur`, `result_resume_watching_2`, `video_watch_state`, `result_episode`, `result_season`.
**Acceptance.** Time-to-first-frame comparable to Android on the same source. Progress survives an abrupt kill.

---

## WF-5 — Building a library

1. On a detail page, set a watch state (Watching / Completed / On-hold / Dropped / Plan to watch).
2. Optionally mark favourite and/or subscribe.
3. Library shows the item under the chosen source and sort.
4. A subscription is polled on the same 6-hour cadence as Android; new episodes raise an OS notification.

**Alternates.** Bulk actions (desktop enhancement). Sync to a tracker.
**Failures.** Tracker offline → local state is authoritative; sync retries later; **no local deletion**.
**Data touched.** `result_watch_state`, `result_watch_state_data`, `result_favorites_state_data`, `result_subscribed_state_data`.
**Acceptance.** Setting state to NONE deletes the record (parity). Subscription notifications fire once per new episode, not repeatedly.

---

## WF-6 — Downloading for offline

1. Download an episode, a season, or a movie.
2. Item enters the queue; concurrency respects the two download settings.
3. Progress shows in-app and via OS notification.
4. Completion makes the item offline-playable with its subtitles.

**Alternates.** Pause/resume/cancel/retry. Reorder (enhancement). Auto-download for subscriptions. Change the download folder.
**Failures.** Disk full → queue pauses with a clear message; **no file is marked complete when it is not**. Link expiry → re-resolve through the provider. Corrupt segment → retry that segment. App killed → resumable on next start.
**Data touched.** Download state keys, `download_header_cache`.
**Acceptance.** Resume survives restart. Offline playback works with subtitles. A truncated file is never presented as complete.

---

## WF-7 — Linking a tracker

1. Settings → Accounts → choose a service.
2. System browser opens the OAuth flow.
3. User authorizes; the redirect returns to the app via protocol handler or loopback.
4. Token is stored **in the OS keychain**; account id recorded.
5. The tracker's list becomes selectable in Library; progress pushes if `episode_sync_enabled_key` is on.

**Alternates.** Multiple accounts per service. Manual key entry for subtitle services. Unlink.
**Failures.** Redirect never returns → timeout with a manual-paste fallback. Token expired → refresh; on failure prompt re-auth **without touching local data**.
**Data touched.** OS keychain; `auth_ids`; `last_sync_api`.
**Acceptance.** Tokens never appear in an export. Local library is untouched by auth failure.

---

## WF-8 — Backing up on desktop

1. Settings → Backup & Restore → Export.
2. Choose scope (all / user data / settings) and **format**:
   - **Android-compatible** — restorable on Android and desktop; excludes desktop-only state.
   - **Desktop-native** — versioned, complete, restorable on desktop only.
3. Choose destination via native dialog.
4. Export runs with progress; the file is validated by re-reading it.
5. A summary reports what was included and what was intentionally excluded (tokens, downloads, plugin binaries).

**Alternates.** Automatic scheduled backup with retention.
**Failures.** Disk full → abort cleanly, remove the partial file. Read error → abort with the offending category named.
**Acceptance.** An Android-compatible export restores on a real Android install. Every export states where it can be restored.

---

## WF-9 — Restoring on desktop

Same pipeline as WF-2, with format auto-detection covering both desktop-native and Android-compatible files. Desktop-native restores additionally recover window state, download paths (validated for existence), and desktop-only settings.

**Failures.** Version newer than the app → refuse with a clear message naming both versions; **never partially apply a future format**. Checksum mismatch → refuse, offer read-only inspection.

---

## WF-10 — Moving desktop → Android

1. Export as **Android-compatible**.
2. Transfer the file to the device.
3. Android: Settings → Restore → pick the file.
4. Android merges keys and calls `recreate()`.

**Known constraints.**
- Android's restore performs **no validation** — it merges whatever it is given. Correctness is entirely the desktop exporter's responsibility.
- Desktop-only keys are harmless (Android stores and ignores them) but must be excluded to avoid polluting the user's Android install.
- Values must be typed into the correct bucket (`_Bool`/`_Int`/`_String`/`_Float`/`_Long`/`_StringSet`). A number in `_String` will parse-fail on Android when read.
- Android's non-transferable filter uses **substring** matching; desktop must apply the identical filter on export.

**Acceptance.** A desktop export restores on Android with library, history, and settings intact, verified on a real device ([30](30-migration-test-cases.md) TC-30).

---

## WF-11 — Updating the app

1. Update check on start (`auto_update_key`) or manual.
2. Update available → changelog shown → user accepts.
3. Download, verify signature, install, relaunch.
4. Schema migration runs on first launch of the new version, **after** an automatic pre-migration snapshot.

**Alternates.** Prerelease channel (`install_prerelease_key`). Skip a version (`skip_update_key`).
**Failures.** Signature invalid → refuse and report. Migration failure → roll back to the snapshot and the previous version if possible; otherwise start in a safe read-only mode that still allows export.

---

## WF-12 — Recovering from a broken provider

1. A provider starts failing (site change, network block).
2. The app attributes the failure to that provider in the affected row/section, not globally.
3. User can: retry · check for a plugin update · use "clone site" to repoint `mainUrl` · disable the provider · report it.
4. If a plugin crashes the host repeatedly, it is quarantined and **safe mode** is offered.

**Acceptance.** One broken provider never prevents app start, search, or library access.

---

## WF-13 — Multi-profile household

1. Create a second profile with its own avatar; optionally set a PIN.
2. Switch profiles from the header.
3. Library, history, resume-watching, and per-profile settings all change; repositories and installed plugins are shared.

**Failures.** Wrong PIN → re-prompt; no data destruction. Deleting a profile warns explicitly about the scoped data that becomes unreachable.
**Acceptance.** Profile isolation is absolute for scoped keys. An imported multi-profile backup reproduces every profile at its original index.

---

## Next steps

1. Prototype WF-2 end-to-end in Phase 4, before the UI is finished — it validates the data model.
2. Storyboard WF-2 and WF-9 for design review; they carry the highest data-loss risk.
3. Turn each workflow into an end-to-end test in [13](13-testing-and-qa.md).
4. Validate WF-10 against a physical Android device — it cannot be validated any other way.
