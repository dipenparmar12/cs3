# 20 — Limitations and Constraints

**Generated:** 2026-08-10
**Baseline:** commit `a72f9e6c`

What will not work, and why. Every limitation here must appear in user-facing release notes. **No claim of full parity or 100% data compatibility may be made.**

---

## 1. Hard limitations — cannot be reproduced

### L-1 · Android extensions (`.cs3`) do not run on desktop ★
**Severity: Fatal without mitigation.**
`.cs3` files contain Android DEX bytecode loaded by `dalvik.system.PathClassLoader`. No Electron, Node, or Chromium configuration executes DEX. Even a JVM sidecar requires DEX→JVM conversion, which is imperfect and fails on providers using Android-specific APIs.
**Consequence.** The desktop app launches with an empty catalogue until providers exist for its runtime.
**Mitigation.** [27](27-plugin-and-extension-architecture.md) §6. Whatever is chosen, the ecosystem forks to some degree.
**Evidence.** `app/.../plugins/PluginManager.kt:611`. **Confidence: High.**

### L-2 · Chromecast is unsupported
The Google Cast SDK targets Android, iOS, and web *pages* — there is no Electron-native sender. `CastHelper`, `CastOptionsProvider`, `MiniControllerFragment`, `ControllerActivity`, and the chromecast subtitle style all become inert.
**Mitigation.** DLNA and FCast (FEAT-CAST-3) cover part of the use case. `chome_subtitle_settings` is preserved for round-trip.
**Evidence.** `app/.../utils/CastHelper.kt`; `gradle/libs.versions.toml:38`. **Confidence: High.**

### L-3 · Downloaded media and download state cannot migrate from Android ★
Upstream **deliberately** excludes `DOWNLOAD_EPISODE_CACHE`, its backup variant, `KEY_DOWNLOAD_INFO`, `KEY_RESUME_PACKAGES`, `KEY_RESUME_IN_QUEUE`, and the queue key, with the in-code reason that "the download path URI can not be transferred."
**Consequence.** A migrating user's downloads library is empty on desktop even if the files are copied across.
**Mitigation.** `download_header_cache` *is* transferable, so resume-watching survives. FEAT-DL-9 sidecar metadata prevents the same problem recurring on desktop.
**Evidence.** `app/.../utils/BackupUtils.kt:90-109`. **Confidence: High.**

### L-4 · Authentication tokens cannot migrate ★
Excluded from Android backups by design, both current (`auth_tokens`, `auth_ids`) and legacy (`anilist_token`, `mal_token`, `mal_refresh_token`, `simkl_token`, …) keys.
**Consequence.** Users re-authenticate every tracker and subtitle service after migrating.
**Assessment.** Correct behavior — backups are shareable files. Do not "fix" this.
**Evidence.** `app/.../utils/BackupUtils.kt:64-65, 79-87`. **Confidence: High.**

### L-5 · Screen brightness control is unavailable
Android's player adjusts screen brightness by vertical swipe (`use_system_brightness_key`, `extra_brightness_enabled`, `video_player_alpha_key`). No portable desktop API sets display brightness from an application.
**Mitigation.** A video-level gamma/brightness filter can approximate it in the native backend, but it is not the same feature. Keys preserved, inert.
**Evidence.** `app/.../ui/player/PlayerGestureHelper.kt`; `donottranslate-strings.xml`. **Confidence: High.**

### L-6 · Android TV "watch next" EPG integration
`TvChannelUtils` writes to the Android TV EPG. No desktop analogue.
**Evidence.** `app/.../utils/TvChannelUtils.kt`; `AndroidManifest.xml:13,19`. **Confidence: High.**

### L-7 · Device rotation and battery-optimization settings
`rotate_video_key`, `auto_rotate_video_key`, `battery_optimisation` have no desktop meaning. Preserved but inert.

### L-8 · Biometric setting cannot migrate
`biometric_key` is backup-excluded upstream with the stated reason that it "can lock down users if backup is shared on an incompatible device." Correct; preserve the exclusion.
**Evidence.** `app/.../utils/BackupUtils.kt:66-68`. **Confidence: High.**

---

## 2. Degraded capabilities

### L-9 · Codec and container coverage ★
Chromium's `<video>` supports a materially narrower set than ExoPlayer + `nextlib` FFmpeg + a custom Matroska extractor. Real-world streams frequently use containers and codecs Chromium refuses.
**Mitigation.** The dual-backend design (ADR-3) with an embedded native player. **This is why ADR-3 exists** — a Chromium-only build would fail on a large fraction of real content.
**Residual risk.** Bundle size grows 30–80 MB; licensing needs review.
**Evidence.** `app/.../ui/player/UpdatedMatroskaExtractor.kt` (3,242 lines); `gradle/libs.versions.toml:45`. **Confidence: High.**

### L-10 · Bitmap subtitles require the native backend
PGS and DVB subtitles cannot render through Chromium's text-track machinery.
**Mitigation.** Native backend; explicit message otherwise.

### L-11 · ASS/SSA styling fidelity
Full ASS rendering — positioning, karaoke, transforms, font overrides — is hard to match in a browser text layer.
**Mitigation.** Native backend for styled ASS; a JS ASS renderer for the Chromium path is acceptable but will differ subtly.

### L-12 · Seekbar thumbnail previews
`PreviewGenerator` uses ExoPlayer's frame extraction. The desktop equivalent depends on the chosen backend and may be slower or unavailable in the Chromium path.
**Evidence.** `app/.../ui/player/PreviewGenerator.kt` (545 lines). **Confidence: Medium** — feasible, mechanism backend-dependent.

### L-13 · Trailer playback
NewPipeExtractor is Java-only and GPL-3.0. Options: JVM sidecar, an external `yt-dlp` binary, or dropping trailers.
**Assessment.** P2 feature; an acceptable documented limitation if no clean path exists.
**Evidence.** `gradle/libs.versions.toml:44`; `app/build.gradle.kts:265`. **Confidence: High.**

### L-14 · Provider capability drift
Providers relying on Android-specific behavior — `WebView` quirks, Android crypto providers, filesystem access, Android `Context` — may behave differently or not port at all, whatever runtime is chosen.
**Confidence: Medium** — depends entirely on the provider corpus, which cannot be assessed without porting.

---

## 3. Data-migration constraints

### L-15 · The backup format carries no version ★
No schema version, no app version, no platform marker. Source version must be **inferred** from which keys are present.
**Consequence.** Version detection is heuristic. A backup from a much older or much newer Android build may be misclassified.
**Mitigation.** Conservative inference; report inferred version in the preview; preserve unknown keys verbatim.
**Evidence.** `app/.../utils/BackupUtils.kt:133-137`. **Confidence: High.**

### L-16 · Ids are 32-bit hashes and can collide
Undetected upstream. Migration must detect and report collisions rather than silently overwriting.
**Confidence: High** for the mechanism, **Medium** for real-world frequency.

### L-17 · Provider domain changes orphan ids
If a provider's `mainUrl` changes — which the "clone site" feature explicitly enables — ids computed before and after differ, and existing progress becomes unreachable. This is a pre-existing upstream behavior, not a migration defect.
**Mitigation.** Offer an explicit, user-initiated remap tool (MOD-9). **Never** remap silently.

### L-18 · Ids depend on provider installation state
`getLoadResponseIdFromUrl` strips `mainUrl` resolved by provider name at call time. With the provider absent, the stripping is a no-op and the id differs.
**Consequence.** Ids **must** be imported verbatim, never recomputed (DATA-ID-3).
**Evidence.** `app/.../ui/result/ResultViewModel2.kt:376-379`. **Confidence: High.**

### L-19 · Android's restore performs no validation
Android merges whatever key/value pairs it is given, then calls `recreate()`. There is no schema check, no type check beyond bucket placement, and no rollback.
**Consequence.** Correctness of desktop→Android migration rests entirely on the desktop exporter. A malformed export can leave an Android install in a broken state with no recovery path.
**Mitigation.** Validate desktop exports before writing; test against real hardware (TC-30).
**Evidence.** `app/.../utils/BackupUtils.kt:169-198, 249-317`. **Confidence: High.**

### L-20 · Large backups are memory-hostile
Android loads all preferences into memory; a 500,000-record profile produces a very large JSON document.
**Mitigation.** Streaming parse (PERF-19). Note this is also a limitation *on Android* — a sufficiently large profile may fail to back up there.

---

## 4. Platform constraints

### L-21 · Path semantics differ
Windows reserved names and `MAX_PATH`; macOS Unicode normalization (NFD vs NFC); case-insensitive collisions on Windows/macOS. A download directory created on one OS may contain names invalid on another.
**Mitigation.** PATH-4..9.

### L-22 · Linux desktop fragmentation
Protocol handler registration, keychain availability (libsecret is not universal), notification behavior, and Wayland vs X11 video paths all vary.
**Mitigation.** Loopback OAuth fallback; encrypted-file credential fallback with an explicit warning; test on at least two distributions.

### L-23 · macOS App Store is not a viable channel
Sandboxing forbids downloading and executing third-party plugin code.
**Consequence.** Direct download and notarization only.

### L-24 · Windows SmartScreen friction
Without an EV certificate, new installers trigger warnings until reputation accrues.

### L-25 · No mobile-style background execution
Desktop apps do not run when closed. Subscription checks and scheduled backups only run while the app is open.
**Mitigation.** Missed-run catch-up on launch (ADR-7); optional autostart.

---

## 5. Legal and licensing constraints

### L-26 · GPL-3.0 copyleft ★
Any derivative must be GPL-3.0 with complete corresponding source offered. This constrains business models, bundling, and distribution.
**Evidence.** `LICENSE:1-2`. **Confidence: High.**

### L-27 · FFmpeg licensing needs review ★
Bundled FFmpeg (LGPL-2.1+, or GPL depending on build configuration) interacts with GPL-3.0 in ways requiring counsel. Some FFmpeg components are GPL-2.0-only, which is **incompatible** with GPL-3.0.
**Confidence: High** that review is needed; **Low** on the outcome without legal input.

### L-28 · Branding is not GPL-licensed
The "CloudStream" name and logo may require rebranding for a redistributed fork.

### L-29 · Provider legality varies
Out of scope for this PRD; requires legal review per jurisdiction (LEG-5).

---

## 6. Scope constraints

### L-30 · No first-party content
The app ships nothing. Without providers it does nothing useful. This is by design and must be communicated honestly.

### L-31 · Provider availability is outside our control
Providers break when third-party sites change. Neither Android nor desktop can prevent this.

### L-32 · Upstream divergence ★
An Electron fork will diverge from upstream. Provider updates, format changes, and new features must be tracked manually. Over time the two products will differ.
**Mitigation.** Automated monitoring of upstream's format-relevant changes; quarterly re-analysis; early engagement with maintainers.

---

## 7. Constraints inherited deliberately

Preserved for compatibility despite being suboptimal:

| Constraint | Why kept |
|---|---|
| 32-bit hash ids | Changing them breaks every import, permanently |
| Ordinal-persisted enums | Reordering corrupts imported data |
| `fixVisual` thresholds and the 30 s guard | User-visible parity |
| NONE-deletes semantics | Parity |
| Six type buckets in the Android export | Required for Android compatibility |
| Misspelled and suffixed key names | They are data keys |
| Plaintext PIN | Android compatibility; must be labelled a convenience lock, not security |

---

## 8. User-facing limitations summary

To be published with the release, in plain language:

> **What does not transfer from Android:** downloaded files and the download queue; login sessions for MyAnimeList, AniList, Kitsu, Simkl, and subtitle services (you will sign in again); installed extensions (your repository list transfers, so you can reinstall them in a couple of clicks); the fingerprint-unlock setting.
>
> **What works differently on desktop:** extensions must be built for the desktop version — Android extensions are not compatible; Chromecast is not supported (DLNA and FCast are available); screen-brightness swipe is not available; screen-rotation and battery settings do not apply.
>
> **What may need the built-in advanced player:** some video formats and picture-based subtitles. The app will tell you when it switches or when it cannot play something.

---

## Next steps

1. Publish §8 with every release; keep it current.
2. Resolve L-27 with counsel before packaging.
3. Quantify L-14 by porting five real providers in Phase 9.
4. Re-verify §1 and §3 against the real backup corpus — some may soften, none is expected to disappear.
