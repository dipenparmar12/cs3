# 15 — Upgrade and Modernization

**Generated:** 2026-08-10
**Baseline:** commit `a72f9e6c`

Where to modernize, where to stay bit-compatible, and the architecture decision records for the major migration choices.

---

## 1. The rule

> Modernize the **implementation**. Preserve the **contract**.

Anything a user's data touches, or that a provider observes, is a contract. Everything else is an implementation detail free to improve.

| Free to modernize | Must stay compatible |
|---|---|
| Storage engine | Key grammar, value shapes, id derivation |
| UI framework and layout | Behavioral thresholds (`fixVisual`, 30 s guard, NONE-deletes) |
| Networking stack | Provider-observable semantics (timeouts, sequential loading, headers) |
| Concurrency model | Enum ordinals and names as persisted |
| Build and packaging | Export file format (Android-compatible variant) |
| Logging and diagnostics | Deep-link URI grammar |
| Credential storage | Repository URL grammar and jsDelivr rewrite |
| Error handling and reporting | Plugin install/verify lifecycle semantics |

---

## 2. Constraints worth dropping

Android carries constraints that do not apply to desktop. Inheriting them would be cargo-culting.

| Android constraint | Why it exists | Desktop position |
|---|---|---|
| Jackson pinned to 2.13.1 | Later versions crash on minSdk < 26 (Android TV, Fire Stick) | Irrelevant — use modern JSON |
| Rhino pinned to 1.8.1 | 1.9.0 needs minSdk 26 | Irrelevant — native JS |
| Coil pinned to 3.3.0 | Later versions need jvmTarget 11 | Irrelevant |
| Conscrypt | Repairs TLS on Android 9 | Not needed |
| `SafeFile` | Works around the Storage Access Framework | Not needed — a genuine simplification |
| Everything in SharedPreferences | No database was ever introduced | **Drop.** Use a real indexed store |
| Minification disabled | Reflection-based plugin loading | Keep the *principle* — protect reflectively-resolved names (CI-8) |
| jvmTarget 1.8 | minSdk 23 | Irrelevant |

---

## 3. Weaknesses worth fixing

Improvements the desktop version should make, each with a compatibility note.

| ID | Android weakness | Desktop improvement | Compatibility risk |
|---|---|---|---|
| MOD-1 | Plugins run with full app privilege | Sandboxed plugin host ([11](11-security-and-compliance.md) §4) | Some providers may rely on capabilities the sandbox denies — must be discovered early with real providers |
| MOD-2 | Tokens in plaintext preferences | OS keychain | None — tokens are already backup-excluded |
| MOD-3 | Backup has no version, no app version, no platform marker | Desktop-native format carries all three; Android-compatible export stays versionless | None, if the two formats stay distinct |
| MOD-4 | Restore is a blind key/value merge with no validation and an immediate `recreate()` | Validated, previewed, staged, rollback-capable import | None — strictly safer |
| MOD-5 | Failures are frequently silent (`safe {}` swallows) | Attributed, surfaced, actionable errors | None |
| MOD-6 | Watch progress is never pruned; the store grows forever | Optional retention policy, **off by default** | Must be opt-in, or an export would lose data the user expects |
| MOD-7 | Unbounded parallel provider fan-out | Concurrency caps | None — reduces the chance of being rate-limited |
| MOD-8 | 32-bit hash ids can collide, undetected | Detect and report collisions | None — reporting only, never silent remapping |
| MOD-9 | No id repair when a provider changes domain | Offer an explicit, user-initiated "remap provider ids" tool | Must never run automatically — silent remapping would diverge from Android |
| MOD-10 | No bulk operations | Multi-select and bulk actions | None |
| MOD-11 | Limited accessibility | Full keyboard and screen-reader support | None |
| MOD-12 | Download metadata is unrecoverable if files move | Sidecar metadata files (FEAT-DL-9) | None — additive |

---

## 4. Architecture Decision Records

### ADR-1 — Storage engine
**Android.** Two `SharedPreferences` files; all user data as JSON strings under namespaced keys; the whole map loads into memory.
**Problem on desktop.** No indexing, no transactions, no partial load. At 500,000 records this is unworkable.
**Options.** (a) Mirror the flat key/value model in a JSON file. (b) SQLite for collections + JSON for settings. (c) A document database. (d) LevelDB/RocksDB.
**Decision.** **(b)** — `better-sqlite3` for indexed collections, a JSON document for settings.
**Reason.** Transactions give the migration subsystem its rollback guarantee. Indexes meet PERF-4/29. Settings stay a flat verbatim map, preserving unknown keys for round-trip.
**Tradeoffs.** A native module to rebuild per platform/arch. Two storage mechanisms rather than one.
**Compatibility impact.** None — the migration layer translates between key grammar and schema.
**Migration impact.** Positive; transactions are what make staged import safe.
**Testing.** Crash-during-write; 500k-row load; concurrent access; corruption recovery.

### ADR-2 — Plugin runtime
**Superseded 2026-08-12 by [ADR-10](#adr-10--host-architecture-and-cs3-drop-in).** Retained for the reasoning trail.
Full analysis in [27](27-plugin-and-extension-architecture.md) §6 and [31](31-cs3-dropin-compatibility.md).
**Android.** DEX bytecode via `PathClassLoader`.
**Problem on desktop.** Cannot execute *in Node or V8*. The original wording — "Cannot execute. **No workaround exists.**" — overgeneralized from JavaScript runtimes to desktop, and that error drove the decision below.
**Options.** (a) JVM sidecar running converted `.cs3`. (b) Zipline/QuickJS aligned with upstream. (c) A native JS/TS plugin API. (d) A headless-browser provider host.
**Original decision.** (c) first, behind an adapter boundary permitting (a) or (b) later.
**Revised decision (ADR-10).** **(a), (b) and (c) together, behind that same adapter boundary, with (a) as P0** — it is what gives the app content on day one. (d) is retained as a component: the offscreen `WebViewResolver` bridge.
**What held up.** The adapter boundary. It is the reason serving three runtimes is tractable rather than a rewrite.
**Compatibility impact.** Reversed: existing providers run unmodified; porting becomes optional and incremental.
**Migration impact.** Repository URLs migrate; plugin binaries are re-downloaded from those repositories and run as-is.
**Testing.** TEST-PLG-1..20.

### ADR-10 — Host architecture and `.cs3` drop-in
**Decided 2026-08-12.** Supersedes ADR-2 and resolves OQ-1/OQ-2.
**Decision.** Electron host + a bundled, sandboxed JVM sidecar executing translated `.cs3` plugins; Windows-first platform scope.
**Reason.** Three verified facts: `:library` already declares a `jvm()` target with JVM actuals; upstream's `makeJar` already merges `library-jvm.jar` into the provider classpath; and 67.6% of surveyed providers import no `android.*` at all, with a 22-type `:app` surface. The desktop app links upstream's provider API rather than reimplementing it.
**Tradeoffs.** A bundled JRE (installer size, endpoint-protection friction, an extra licensing obligation), a second sandbox to design and defend, and a long-term dependency on translated Android bytecode (RISK-D5, accepted).
**Risk.** RISK-D1 — DEX→JVM translation is unproven against Kotlin coroutine state machines and is the gate on the whole decision.
**Full record.** [31-cs3-dropin-compatibility.md](31-cs3-dropin-compatibility.md).

### ADR-3 — Media playback
**Android.** ExoPlayer/Media3 + nextlib FFmpeg + a custom Matroska extractor + a custom subtitle decoder factory.
**Problem on desktop.** Chromium's `<video>` supports a materially narrower codec/container set and cannot render bitmap subtitles or style ASS properly.
**Options.** (a) Chromium only. (b) Embedded native player (mpv/libVLC) only. (c) **Dual backend.** (d) External player only.
**Decision.** **(c)** — Chromium `<video>`/MSE by default for compatible sources; embedded native player for everything else and as a user preference.
**Reason.** (a) fails on a large fraction of real streams. (b) adds 30–80 MB and complicates the UI for cases Chromium handles fine. (c) covers both with one selection point.
**Tradeoffs.** Two code paths to maintain and test. Licensing review for the native player ([11](11-security-and-compliance.md) LIC-5/6).
**Compatibility impact.** `software_decoding_key2` maps to backend selection.
**Migration impact.** None.
**Testing.** TEST-PLAY-1..12 against both backends.

### ADR-4 — Export format
**Android.** Versionless flat JSON with six type buckets.
**Problem.** No version, no app version, no platform marker — nothing to key migration decisions on.
**Options.** (a) Extend the Android format with a version field. (b) Two formats. (c) Desktop-native only.
**Decision.** **(b)** — a byte-compatible Android export and a richer versioned desktop-native export.
**Reason.** (a) risks Android's parser, which was never designed for unknown top-level keys and is a blind merge. (c) breaks the desktop→Android direction, which is an explicit requirement.
**Tradeoffs.** Two writers, two readers, and a UI that must make the distinction obvious.
**Compatibility impact.** Full bidirectional compatibility preserved.
**Testing.** TEST-UPG-3/4; TC-30 on real hardware.

### ADR-5 — Networking
**Android.** NiceHttp/OkHttp with per-provider interceptors, exposed directly to providers.
**Problem.** Providers depend on a specific client's shape; plugins must not get raw network access.
**Decision.** A main-process network service with a **brokered** plugin interface offering a NiceHttp-shaped API.
**Reason.** Preserves provider ergonomics while making every plugin request policy-checked, attributable, and rate-limited.
**Tradeoffs.** IPC overhead per request; needs batching for chatty providers.
**Testing.** NET-1..10; SEC-16/17.

### ADR-6 — Credential storage
**Android.** Plaintext JSON in preferences.
**Decision.** OS keychain, with the data-store key retained but empty for shape compatibility.
**Reason.** Strictly safer; zero compatibility cost because tokens are already backup-excluded.
**Tradeoffs.** Linux keychain availability varies; needs an encrypted-file fallback with an explicit warning.
**Testing.** SEC-28; a scan asserting nothing sensitive is on disk in plaintext.

### ADR-7 — Background work
**Android.** `WorkManager` — subscriptions every 6 h, periodic backup.
**Decision.** A main-process persistent scheduler with **missed-run catch-up**.
**Reason.** Desktop apps are not always running; a naive interval timer silently skips runs. Catch-up is what makes subscription notifications reliable.
**Tradeoffs.** Must avoid thundering-herd polling on launch after a long absence (PERF-35).
**Testing.** Missed-run catch-up; 1,000-subscription batching.

### ADR-8 — Torrent engine
**Android.** In-process Go `torrServer` on an ephemeral loopback port.
**Options.** (a) `webtorrent` in JS. (b) A bundled native engine as a child process. (c) Drop torrent support.
**Decision.** **(b)** as a supervised child process exposing the same loopback-HTTP shape, behind a feature flag.
**Reason.** Matches Android's architecture, keeps the playback integration identical, and isolates crashes. (a) is weaker on DHT and large swarms.
**Tradeoffs.** Per-platform binary; licensing review; a loopback listener the plugin broker must deny access to (SEC-17).
**Testing.** TEST-PLAY-11.

### ADR-9 — UI state management
**Android.** MVVM with LiveData; upstream is migrating to MVI (`COMPOSE.md`).
**Decision.** Unidirectional state flow in the renderer, with the main process as the single source of truth for persisted state.
**Reason.** Aligns conceptually with upstream's MVI direction, which eases future reconciliation, and suits an IPC boundary where the renderer cannot be authoritative.
**Testing.** Component and E2E.

---

## 5. Deliberately not modernized

| Item | Why it stays |
|---|---|
| 32-bit hash ids | Changing them breaks every import. This is permanent. |
| Enum ordinal persistence | Changing it corrupts imported data. |
| `fixVisual` thresholds | User-visible; parity matters more than elegance. |
| The 30-second progress guard | Parity. |
| NONE-deletes semantics | Parity. |
| `chome_subtitle_settings` misspelling | It is a data key. Renaming it loses user data. |
| `prefer_media_type_key_2`, `double_tap_seek_time_key2`, `software_decoding_key2` suffixes | Same. |
| Six type buckets in the Android export | Required for Android compatibility. |

---

## 6. Future modernization, once parity is proven

| ID | Opportunity | Prerequisite |
|---|---|---|
| FUT-1 | Optional cloud sync between installations | Stable data model + explicit user consent |
| FUT-2 | Migrate to upstream's Kotlin/JS provider runtime if it ships | Upstream enabling the `webMain` target |
| FUT-3 | Content-addressed ids alongside hash ids, with a mapping table | Never replacing hash ids, only augmenting |
| FUT-4 | Watch-progress retention with archival | MOD-6 shipped and opt-in |
| FUT-5 | Plugin publisher signing | Ecosystem maturity |
| FUT-6 | Shared plugin format with upstream | Coordination with upstream maintainers |

---

## Next steps

1. Ratify ADR-1 through ADR-9 before Phase 3; they are expensive to reverse.
2. Re-examine ADR-2 quarterly against upstream's KMP progress — it is the decision most likely to change.
3. Freeze the §5 list in code comments where each item is implemented, so future contributors do not "fix" them.
