# Android parity: what was measured, what was closed, what is left

**Date:** 2026-08-23. **Reference:** the checked-out Android source at `a72f9e6c` (v4.8.0),
read directly rather than via `docs/docs_cs3/`.

This document exists because "the Android app feels better" kept coming back as a report
without a list behind it. It is that list. Everything here was found by reading both
trees, and every line reference was verified in source.

It is deliberately narrow: it covers **the gap between the two products**, not our own
roadmap. For the extension/media/network *standards* work, see
[PRD 39](../PRD/39-native-extension-and-playback-standards.md), which reaches the same
conclusion about the network layer from the other direction.

---

## 1. The one that explains most "works on Android, fails here"

> **Closed 2026-08-24.** Built as described in "the shape of the fix" below — a reverse-call
> frame on the stdio protocol, `WebViewResolver` supplied from `sidecar/bridge/` so it
> shadows the library stub, and an offscreen `BrowserWindow` in the main process.
> `AGENTS.md` § "The browser, finally" carries the as-built design, the traps, and the one
> thing still unmeasured: whether the providers this was supposed to rescue are actually
> rescued. The analysis below is left as written, because its *method* — a gap that a
> missing-class count cannot see — is the part worth keeping.

**`WebViewResolver` on the JVM is a method that throws.**

Extensions reach Cloudflare-protected sites and JavaScript-driven extractors through
`WebViewResolver`. On Android it drives a real WebView. The `library-jvm` build we ship
carries a JVM variant of the same class, and its core method is a placeholder:

```kotlin
// library/src/jvmMain/kotlin/com/lagradost/cloudstream3/network/WebViewResolver.jvm.kt

override fun intercept(chain: Interceptor.Chain): Response {
    return chain.proceed(request)          // the challenge page passes straight through
}

actual suspend fun resolveUsingWebView(...): Pair<Request?, List<Request>> {
    TODO("Not yet implemented")            // throws NotImplementedError at runtime
}
```

Confirmed present in the jar we ship (`javap` on `sidecar/runtime/library-jvm-4.8.0.jar`).

So a provider that needs a browser does not degrade — it throws, or it silently receives
a Cloudflare interstitial as though it were the page it asked for. **This is a different
failure from the missing-class problem closed over four rounds, and it is invisible to a
class-resolution audit, because the class resolves perfectly.**

Scale, counted across the vendored corpus rather than estimated: **45 plugin directories
across 11 repositories** reference `WebViewResolver` or `CloudflareKiller`, out of ~510 —
about 9%, which matches the "~7% of providers" figure in `AGENTS.md`. The true reach is
wider, because the shared bot-protected extractors (Voe, Vidsonic) are called by many
more providers than declare the class themselves.

**We already ship the engine that fixes it.** Android borrows the system WebView; Electron
*is* Chromium. The obstacle is not capability, it is direction: our stdio RPC runs one way
only. `Main.java` dispatches methods the main process calls, and the JVM has no channel
back, so it cannot ask Electron to open a window and watch it.

The shape of the fix, for whoever picks it up:

1. A reverse-call frame on the stdio protocol — the sidecar asks, the main process answers.
   This is the real work, and it is worth designing carefully; everything else is small.
2. `WebViewResolver` implemented in `sidecar/bridge/` so it shadows the library stub. It
   must be in the bridge jar for the same reason `Plugin` is: only code loaded by the
   loader that owns `library-jvm.jar` resolves the identical class.
3. In Electron: an offscreen `BrowserWindow`, `webRequest` matching the intercept regex,
   the matched request returned, cookies harvested for `CloudflareKiller`.

This is PRD-36 step 7 and PRD-39 §7. Both name it as the highest-value outstanding work.
This audit agrees, independently.

---

## 2. Closed in this pass

### Next-episode preload — `VideoPlayer`

Android holds the whole episode list in the player and preloads the *next* episode's links
while the current one plays (`PlayerGeneratorViewModel.preLoadNextLinks`, line 281, calling
`generateLinks(offset = episodeIndex + 1)`).

Ours prefetched only from the detail page — `DetailView.tsx:645` was the single
`prefetchSources` caller. So pressing Play on episode 2 began a fifteen-provider scrape
from cold: the exact stall `SourcePrefetcher` exists to remove, reappearing at the one
moment someone working through a season feels it most.

Fires at 70% watched. A **ratio, not a countdown**: episode lengths in the corpus run from
22 minutes to feature length, and a fixed lead that suits one is either far too early or
useless for the other. Not the last thirty seconds either — the scrape itself takes tens of
seconds against the slower providers, so starting it as the credits roll would finish after
the viewer had already pressed Next and waited anyway.

Everything that makes it safe already lived in `SourcePrefetcher.schedule`: it declines when
background loading is off, returns immediately when the cache can already answer, dedupes by
target, and supersedes rather than stacking. It needed a caller, not a mechanism.

### Cast and related titles — `DetailView`

`ProviderBridge.encodeLink` has encoded `actors` (line 236) and `recommendations` (line 237)
on every `load` since the link-surface work. The detail page rendered neither — a scrape
already paid for, dropped at the last step.

The two had different fates worth recording: `actors` reached the renderer intact and was
simply not drawn, while `recommendations` stopped at `pluginManager`, which never read the
field. Related titles are re-addressed through `mapProviderResults` rather than a second
mapper, because a recommendation is only useful if it can be opened — which means its URL
has to carry the provider that produced it, exactly like a search result.

Both render only when non-empty. Most providers send neither, and an empty "Cast" heading
reads as a failed lookup rather than an absent field.

**Still missing: trailers.** `LoadResponse.trailers` exists upstream (`MainAPI.kt:1826`) and
our bridge does not encode it. Worth adding — we already ship yt-dlp, so playing one needs
no new dependency.

### Subtitle appearance — `subtitleStyle.ts`, `SubtitleSettings`

Android ships a caption editor with thirteen controls (`SaveCaptionStyle`). We had none, and
default `<track>` rendering is small white text with no separation from the picture — it
disappears completely over snow, a white wall, or light credits.

Five settings: size, colour, background treatment, weight, and a lift off the bottom for
releases with text burned into the picture.

Two things about the implementation are load-bearing:

- **One record drives two renderers.** The settings are stored as numbers and enums rather
  than a composed CSS string, because `::cue` and mpv properties have no syntax in common.
  `subtitleStyle.ts` owns both translations so they cannot drift, and the test pins the
  agreement — including that `sub-pos` counts *down* from 100 where the CSS lift counts up,
  which is a sign flip waiting to happen.
- **Applying it to mpv is not polish.** The engine routes 4K HEVC and multichannel audio to
  mpv on its own, without the viewer asking. Styling only the element would have meant the
  settings silently vanishing on exactly the files most likely to need them.

The default is an outline rather than a box: a box is the most readable option and also the
most intrusive, covering the frame whether or not anything behind it needed hiding. The
preview sits on a light gradient for the same reason — bright content is the case that
actually decides between the two.

### Playing a finished download — `MediaProxy.serveFile`

A completed film was handed to `shell.openPath` — the OS default player — so the viewer lost
resume position, subtitle search, track selection, the next-episode flow and the
compatibility engine, for a file already on their disk. Android plays downloads in-app
(`OfflinePlaybackHelper`).

The engine was built for this all along: `mediaInspector` has always withheld `-user_agent`
for non-HTTP input precisely because a local path was expected. What was missing was a way in.

Served over the existing loopback origin rather than as a `file://` URL, for two reasons.
Everything downstream already speaks that origin — ffprobe, the media element, hls.js and mpv
all take a loopback URL today, and `file://` in a `contextIsolation` renderer does not. And it
keeps INV-RACE-1 intact: the file still goes through `media:prepare` and is classified before
anything is attached, which a downloaded 10-bit HEVC file needs exactly as much as a streamed
one.

`serveLocal` is deliberately **not** `stream()`. That method exists to survive a flaky origin
mid-transfer — resuming, re-requesting, counting bytes — and none of it applies to a local
disk, where a short read is a real error rather than something to paper over.

Range support is the point rather than a detail: without it the file plays and cannot be
seeked, which reads as a corrupt download rather than a missing HTTP feature.

---

## 3. Still open, in the order worth doing

| | Gap | Android has | Size |
|---|---|---|---|
| 1 | **The WebView bridge** (§1) | a real WebView | large — needs reverse RPC first |
| 2 | **Trailers on the detail page** | `ResultTrailerPlayer` | small — one bridge field, yt-dlp already shipped |
| 3 | **User source priority** | `QualityDataHelper` | medium |
| 4 | **More subtitle services** | four, we have one | medium |
| 5 | **Trackers and cloud backup** | AniList, MAL, Simkl, Kitsu, `BackupAPI` | large |

### On source priority specifically

Android carries a full preference model (`source_priority/QualityDataHelper.kt`): a priority
per provider, a priority per quality, grouped into named profiles that switch automatically
by context (Wi-Fi, mobile data, download). Above `AUTO_SKIP_PRIORITY = 10` it **stops
resolving further links altogether** — a correctness-preserving shortcut that makes playback
start sooner.

Our `providerRanking` is arguably better *evidence*: it counts what actually happened rather
than what someone guessed. But it is not a substitute. A viewer who knows one provider serves
their language, or who wants 1080p over 4K on a metered line, has no way to say so. The two
compose — the user's ranking as an override on the measured one — and that is the shape to
build, not a replacement.

The early-stop deserves copying on its own merits, independently of the UI.

---

## 4. Where we are ahead

Worth stating, because it decides what is worth copying and what is not:

- **The compatibility engine.** Android leans on the device's hardware decoders and never had
  to reason about this. The inspect → decide → execute split, with mpv routing behind it,
  solves a problem Android does not have, and solves it against a tested decision table.
- **Provider analytics and ranking.** No Android equivalent. Counting what each provider
  actually did — and keeping `empty` distinct from `failure` — is a better answer than a
  static list.
- **Swarm diagnostics.** Naming what limits a torrent, rather than showing a spinner, is ours.
- **Failure reporting.** The deduplicated, cause-grouped diagnostic report has no counterpart.

The lesson from the four rounds of shim work applies to this document too: **count before
fixing.** The counting here says the class problem is solved and the network layer is not,
so that is where the next unit of effort belongs — not in more shims, and not in more UI.
