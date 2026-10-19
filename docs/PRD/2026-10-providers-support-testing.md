# PRD: Provider Compatibility Audit — a repeatable, evidence-based validation of every community provider

| | |
|---|---|
| **Status** | Proposed. **Nothing in this document is built.** No source file was changed while writing it. |
| **Number** | Unassigned (filename-dated; next free PRD number is 56) |
| **Date** | 2026-10-16 |
| **Audience** | The engineer (or agent) who will implement it. Written to be executed without further questions; open decisions are in §16 with a recommended default. |
| **Supersedes** | The two-paragraph brief and pasted draft previously in this file (recoverable: `git show 3ca2075:docs/PRD/2026-10-providers-support-testing.md`). Every requirement in them is kept, renumbered `R-*` in §4. |
| **Reads with** | `AGENTS.md` §5 (extensions), §6 (media), §7–8 (search), §12 (cross-cutting rules); `docs/agents/extensions.md`, `media.md`; PRD-38 (the first, hand-run matrix), PRD-40/40.1 (playback engine), PRD-44 §5 (failure taxonomy), PRD-55 §11 (anti-bot). |

**Labels used below.** `[measured]` = taken from this machine/repo on 2026-10-16. `[source]` = read in the code at the cited `file:line`. `[hypothesis]` = suspected from reading, **to be settled by the audit itself, not asserted**. `[not verified]` = could not be checked here (no live network run, no upstream submodule).

---

## 1. Thesis

CS3 runs ~344 community providers it did not write, against sites that change weekly, through a pipeline with 10 playback strategies. Today, "does provider X work?" is answered by whoever last tried it, with a title they happened to pick, on one machine, by a script that reimplements half of the product. The answers disagree with the product because the scripts are not the product.

The audit exists to replace anecdote with **a dated, versioned, diffable table: for each provider, for each stage of the real pipeline, what happened, with what evidence, and whose problem it is.** Everything else in this document serves four properties:

1. **Faithful** — it runs the shipping code (inspector, decision engine, proxy, link mapper, failure taxonomy), not lookalikes.
2. **Bounded** — it never downloads a film, never hammers a host, never touches the user's data.
3. **Honest** — "couldn't tell" is a first-class result, distinct from "broken", and every failure is attributed (provider / plugin / runtime / app / environment).
4. **Comparable** — two runs can be diffed, and a difference is traced to *what changed* (plugin build, runtime generation, app commit, or the site).

### 1.1 What this document is not

Not a fix list for any provider. The audit's output *is* the fix list; §13 only records enhancements the **gaps found while researching** already justify, as input for later PRDs.

---

## 2. Strategy: what we will do, can do, and will not do

### 2.1 We WILL (the verbs)

| Verb | Meaning here |
|---|---|
| **Enumerate** | Take the corpus from the app's own sources of truth (installed archives, `official_repositories.json`, the provider registry), never a hand-kept list. Every archive ends in exactly one terminal state, so `tested + skipped + … = discovered` always holds. |
| **Isolate** | One archive loaded at a time (providers self-register into a global; overlapping loads mis-attribute — measured 176 times, `AGENTS.md` §5), unloaded afterwards, JVM recycled on leak/heap/hang. One provider's hang never advances another's clock. |
| **Seed from the provider itself** | Test titles come from the provider's own `getMainPage` (343 of 344 declare one `[measured]`), then search is tested by round-trip on a title the provider just showed us. A fixed title list scores anime, regional, live and adult providers wrongly (§3.3, G-05). |
| **Measure, then decide** | Persist what the source *is* (container, codecs, tracks, headers, range behaviour) separately from what *this machine would do* with it. Matches the repo rule: probes cached by origin, verdicts recomputed (`AGENTS.md` §6). |
| **Bound** | Bytes, time and requests are budgeted per source, per provider and per host, and the budget is enforced by a **meter in the network layer that aborts the socket**, not by trusting ffprobe/mpv to stop. |
| **Classify** | Six outcomes per stage (§6.2) and one owner per failure (§8). |
| **Attribute upward** | Group by **extractor/host** as well as by provider. Many providers fail for one shared reason (an `ExtractorApi` for a file host); fixing it once is the highest-value output the audit can give. |
| **Journal** | Append-only NDJSON written as it happens. A killed 3-hour run resumes; it never restarts. |
| **Diff** | Compare against a previous run and name the dimension that changed. |
| **Redact** | Tokens, cookies, credentials and signed query values never reach disk (reuse `logging/redact.ts`). |
| **Reuse** | Import shipping modules. Where a thing must be reimplemented for the harness, say why in a comment and add a parity test that fails when the product diverges. |

### 2.2 We CAN (already available, no new capability needed)

- Drive any provider operation headlessly over the sidecar's line-JSON RPC: `load`, `unload`, `providers`, `providerMainPageSections`, `providerMainPage`, `providerSearch`, `providerLoad`, `providerLoadLinks`, `status`, `hostCapabilities`, `clearTranslationCache` `[source: sidecar/…/Main.java:280-383]`. No Electron needed for this half; `tools/e2e/provider-e2e.mjs` already proves it.
- Construct the production `MediaProxy` headlessly: it takes an injected `FetchLike` (`mediaProxy.ts:520`) and imports no `electron` `[source]`. Likewise `MediaInspector` takes injected `fetchHead`/`fetchBytes` (`mediaInspector.ts:966`).
- Call the pure decision functions with any renderer/host/native-engine profile: `decideStrategy` (`decisionEngine.ts:1098`), `shouldRouteToNativeEngine` (`:968`), `selectAudioTrack` (`:367`).
- Read provider declarations as the app does: `mapProviderLink` (`cs3/providerLinks.ts:124`) yields type, DRM, headers, audio side-tracks, multi-part playlists.
- Classify failures with the app's closed taxonomy: `classifyFailure` (`cs3/failureTaxonomy.ts:170`), `groupingForm` (`:309`).
- Play a stream for a few seconds through real mpv (`native-engine-matrix.mjs` `playInMpv`, `:310`) and measure playhead + dropped frames.
- Fetch with Chromium's network stack from a headless Electron child (`tools/e2e/links-play.cjs`) so referrer policy, DoH and system proxy behave as in the app.

### 2.3 We WILL NOT

| # | Will not | Why (the failure it prevents) |
|---|---|---|
| N-1 | Change source code, provider config, user settings, the datastore, the app's ledgers (`cs3-extension-issues.json`, `cs3-provider-analytics.json`, diagnostics) or the installed archives as a side effect of an audit. | R-9.7. Existing harnesses write into `%APPDATA%/CloudStream 3 Desktop/` `[measured: cs3-native-engine-matrix.json, cs3-pan-provider-test-matrix.json]`; the audit must be provably side-effect-free (§12.1 AC-6). |
| N-2 | Download a full media file, segment set or torrent payload — and never "fall back" to one. | R-5. A meter-enforced cap, no escape hatch flag. |
| N-3 | Decide anything from a URL string (extension, path word, host). The URL is recorded as a *claim* and compared with the measured body. | `AGENTS.md` §12 first rule; it is also the audit's N-1 detection (§7). |
| N-4 | Treat a failed `HEAD`, an ignored `Range`, a 403 without the provider's `Referer`, or a missing WebView host as "broken". | R-5, R-6. These are `inconclusive` with a named reason until a second strategy has been tried. |
| N-5 | Call a provider "compatible" because it answered or returned a URL. Compatibility is the **deepest stage reached with evidence**, named. | R-2, R-6. |
| N-6 | Auto-disable, rank-down, or write to `providerAnalytics`/`providerRanking` from audit results. | `AGENTS.md` §7–8 "nothing is ever auto-disabled". Audit data may *inform* a later, explicit import (§13 E-03), never silently change ranking. |
| N-7 | Create a second provider registry, a second media detector, or a second failure taxonomy. | R-10.2. Extend the shipping ones if they fall short and say so. |
| N-8 | Test adult providers by default, play their video, screenshot them, or record their titles. | §9. Same gate semantics as `PluginManager.enabledProviderNames`. |
| N-9 | Escalate against bot walls (stealth proxies, header spoofing beyond what the app already does, captcha solving). | A block or rate limit never opens a browser; only a genuine challenge does (`AGENTS.md` §7–8). |
| N-10 | Run at app startup, in the default CI workflow, or on a timer inside the app. | R-7.5. It is a deliberate maintainer operation. |
| N-11 | Commit run output, or share any unredacted capture. | §10.4. Runs are local, gitignored (anchored rule), redacted by construction. |
| N-12 | Report "playback verified" without a stage-S10 record. | R-6. |
| N-13 | Use more than one request pattern against a host than the app itself would. | Respectful by default; see §6.6. |

---

## 3. Where we are (research findings)

### 3.1 The corpus, measured `[measured 2026-10-16, this machine]`

| Fact | Value |
|---|---|
| Repositories in the catalogue (`desktop/electron/official_repositories.json`) | **55** |
| Installed `.cs3` archives (`%APPDATA%/CloudStream 3 Desktop/extensions/**`) | **406** in 26 repository directories, 22 MB |
| Archives the registry has seen (`cs3-provider-registry.json`) | **313**, of which **14 registered zero providers** |
| ⇒ archives never loaded yet (registry loads lazily) | **~93** — a full audit must load them itself |
| Providers registered | **344**; 343 declare `getMainPage`, only 55 declare quick search |
| Adult-only (`supportedTypes == [NSFW]`) / mixed adult+general | **84** / **3** |
| `Live` (IPTV/channels, unbounded streams, no search semantics) | **21** |
| Languages (top) | en 131 · hi 53 · ta 39 · uk 20 · mx 20 · de 16 · ar 13 · pt-br 10 · id 9 · bn 7 · it 7 · es 5 · fr 4 · zh 2 |
| Distinct `mainUrl` hosts | **295**; **66 providers share 17 hosts** ⇒ throttle per **host**, not per provider |
| Archives holding >1 provider | 22 (max 7) |
| Runtime generation the app runs | 17 (`runtimeProvisioner.ts:202`) |
| Prior ad-hoc result files | `cs3-pan-provider-test-matrix.json` (322 rows, PRD-38), `cs3-comprehensive-streaming-suite-report.json` (**2 bytes — empty**), `cs3-native-engine-matrix.json` (1 KB) — unversioned, no schema, no run id |

"More than 400 providers" in the brief is the archive count; the provider count is ~344 (and the catalogue allows more once all 55 repositories are installed). The audit's discovery step reports both and does not hard-code either.

### 3.2 What already exists and what each one proves

| Harness / module | Proves | Stops short because |
|---|---|---|
| `tools/e2e/provider-e2e.mjs` (917 lines) | Archive → `load` → `search` → `load` → `loadLinks` → 2 MB ranged GET, over the real sidecar RPC | **9 hard-coded repositories** (`:52`) vs 55 in the catalogue; **2 plugins per repository** by default (`:127`); 3 fixed queries (`:104`); stops at the **first** stream with bytes (`:816`) so mirrors/extractors are unseen; Node `fetch`, no inspector, no engine routing, no subtitles; installs into a temp dir (good) |
| `tools/e2e/native-engine-matrix.mjs` (725) | Imports shipping `MediaInspector` + `decideStrategy`, **plays 8 s in real mpv**, records both pre- and post-engine verdicts | Max 14 plugins (`:118`), 5 fixed titles (`:134`), **hand-rolled `startProxy` stand-in** (`:249`) instead of `MediaProxy` (no manifest rewriting, no PNG-wrapper unwrapping, no HLS audio-in-segments), one renderer profile `RENDERER_PLAIN` (hevc off, `:391`), software host only |
| `tools/e2e/links-e2e.mjs` + `links-play.cjs` | Fresh links per reported title; Chromium `net.fetch`; walks HLS master→variant→segment; tests default vs `unsafe-url` referrer policy | Manual `--case` list; no inspection/engine stage |
| `tools/e2e/catalogue-e2e.mjs` | `getMainPage` rows classified OK/MULTI/EMPTY/DROPPED/ERROR | Home-page only, per-request `--installed` name match against the **live profile** |
| `tools/e2e/multi-provider-streaming-matrix.test.mjs` (385) | PRD-38's test spec | Hard-coded `D:\projects\cs3` and a named-provider list; assertions, not a corpus audit |
| `tools/research/survey-repositories.mjs` | Repository liveness and novelty counts | Counts indexes, not providers |
| `cs3/extensionIssues.ts`, `diagnostics.ts`, `providerAnalytics.ts` | Real-user failure history (6,180-record log → taxonomy) | Reactive: only what users hit; deliberately stores no URLs/titles |
| `desktop/electron/*.test.mts` and `cs3/*.test.mts` (47 files at the top two levels) | Pure logic, stubbed origins | By design never touch a live provider |

### 3.3 Gap analysis — why a "fix for one provider breaks another" keeps happening

IDs are referenced from later sections.

| ID | Gap | Evidence | Consequence |
|---|---|---|---|
| **G-01** | No corpus-wide runner; coverage is a cap (2/repo, 14 total) and a hand list | §3.2 | Compatibility is inferred from a sample |
| **G-02** | Harnesses reimplement the product (`pullBytes`, `startProxy`) | `provider-e2e.mjs:488`, `native-engine-matrix.mjs:249` | Harness green, app red (or reverse). The PNG-wrapped-TS and `.m3u8`-with-`.png`-segments fixes live in `MediaProxy`/inspector, so a stand-in can't see regressions in them |
| **G-03** | Node `fetch` is the wrong judge | `AGENTS.md` §12: Chromium refuses a cross-site full-path `Referer` (`ERR_BLOCKED_BY_CLIENT`); 159 blocked requests in 36 logs; DoH/proxy only apply to `net.fetch` | A source passes in the harness and fails in the app, exactly the "downloads but won't stream" class |
| **G-04** | Harness has no host capabilities: `hostCapabilities {webview:false}` is the default, no `clearance.*` | `Main.java` `hostCapabilities` case; `cs3/clearance.ts`, `webViewHost.ts` | Every Cloudflare/WebView-resolving provider "fails" for a reason that is the harness's, not the provider's |
| **G-05** | Query oracle problem: fixed titles | `provider-e2e.mjs:104`, matrix `:134`; 21 live, dozens of anime-typed, 84 adult, 14+ languages | A provider with nothing for *Dune* is correct (`empty ≠ failure`, `AGENTS.md` §7–8) but is reported as failing |
| **G-06** | Throttle per provider, not per host | 66 providers on 17 hosts | A parallel run bans its own IP |
| **G-07** | One sample stream per provider; extractor not recorded | `provider-e2e.mjs:816` | The shared root causes — a broken file-host extractor — are invisible. The extractor (`link.source`) is the real unit of failure across providers |
| **G-08** | No persistence contract: no run id, schema, journal, resume, baseline | §3.1 prior files | Can't diff; a crash at hour 2:50 loses the run |
| **G-09** | Subtitles, side audio tracks, HLS renditions/variants and multi-resolution grouping never exercised | `ProviderBridge.kt:198,526` emits subtitles; `providerLinks.ts` reads `audioTracks`/`playlist`; `resolutionVariants.ts` groups quality rungs; no harness touches them | R-3 "Subtitles / Resolution variants" is currently untested |
| **G-10** | Verdict measured for one renderer profile and one host | `RENDERER_PLAIN` (`:391`), `HOST_SOFTWARE` (`:390`) | The matrix reports a compatibility story true for one machine. Verdict depends on decoders (`AGENTS.md` §6) |
| **G-11** | Range semantics collapsed: `206` or `200` both "pass" | `provider-e2e.mjs:498-515` | A Range-ignoring origin (which makes mpv "grind the whole file", `AGENTS.md` §6) is scored healthy. Production already models this: `MediaProxy.rangeSupportFor` returns `yes\|no\|undefined` (`:634`) |
| **G-12** | JVM lifetime: all archives in one process, 512 MB heap (`-Xmx512m`), no unload/leak check | `provider-e2e.mjs:274`; fn:extensions (a failed `load()` leaked a classloader and blocked later updates with `EPERM`) | Late-corpus failures that are really early-corpus leakage |
| **G-13** | Live/IPTV and torrent/magnet links have no defined audit semantics | 21 `Live` providers; `isTorrentLink` (`providerLinks.ts:167`) | Reported as unreachable or skipped silently |
| **G-14** | Harnesses read the user's real profile | `catalogue-e2e.mjs --installed`, matrix `EXTENSIONS_DIR` | Violates N-1; not reproducible on another machine |
| **G-15** | Response *shape* is not recorded | none | Provider drift (renamed field, new nesting) is only noticed when something breaks; also hides where the **bridge** is lossy (the earlier "bridge discarding link data" incident, fn:extensions) |
| **G-16** | The audit's byte promise conflicts with the production probe | `mediaInspector.ts` `PROBE_SIZE_PROGRESSIVE = 10 MB`, `PROBE_SIZE_RAISED = 15 MB` | Faithful probing reads up to 15 MB. The cap must be *explicit and metered*, not inherited (§6.5) |

### 3.4 Hypotheses the audit must settle (not assert)

These are suspected defects in the **app** that the audit is designed to expose; each becomes a named detector and, if confirmed, a separate fix PRD.

| ID | Suspicion | Where |
|---|---|---|
| **H-01** | `classifyBody` returns `'dash'` for *any* body starting `<?xml` — an XML error document, TTML, or Smooth Streaming manifest would be classified DASH and routed to the DASH path | `mediaInspector.ts:206-211` `[source]` |
| **H-02** | On the bounded-range path the proxy answers with the **upstream `Content-Type` verbatim** (`:1703`; manifests at `:1139`). The only correction is for PNG-wrapped TS (`:1400-1423`). A video served as `image/jpeg` / `text/html` / `application/octet-stream` on a `.jpg` URL reaches `<video>` mislabelled. Whether Chromium sniffs past it for each of those is **unmeasured** | `mediaProxy.ts` `[source]` |
| **H-03** | The URL-pattern fallbacks (`detectUrlType` `mediaInspector.ts:183`, `looksLikeHls/Dash` `providerLinks.ts`) still decide transport when the provider sends `type: VIDEO` for everything (older plugins). The audit should count how often a fallback — not a declaration or a body — decided | `[source]` |
| **H-04** | Mirrors are plentiful but only the first is ever tried by tooling; real users hit the 2nd–Nth. Per-extractor failure rates will differ sharply from per-provider ones | G-07 |
| **H-05** | Providers' `lang` and `supportedTypes` predict which seed titles work; a few providers declare `Movie, TvSeries` but only serve anime or vice-versa | G-05 |
| **H-06** | A non-trivial share of "dead" providers are dead **sites** (NXDOMAIN, parked, 5xx), not broken plugins; the Extensions screen cannot tell the viewer which | §6.3 stage S2 |
| **H-07** | Some providers return embed/interstitial HTML pages as "links" (the extractor failed to reach a stream) | §7 N-7 |

---

## 4. Requirements (the original brief, traceable)

`R-*` ids map to the brief's sections. "Where" points at the design section that satisfies it.

| ID | Requirement (condensed from the brief) | Where |
|---|---|---|
| R-1 | Single objective: audit every supported provider and repository for discovery, extraction, formats, playback, audio, video, subtitles, resolution. Core principle: each provider tested independently, on real responses, with measurable results. | §1, §5 |
| R-2.1 | Sequential or rate-limited runner discovers all registered providers/repositories; processes each eligible provider individually. | §5.1 |
| R-2.2 | Per provider: name, repository, implementation, version, capabilities; initialises and responds; tests search/catalogue/detail/source extraction; records response structure and source format; validates usability in the **existing** pipeline; identifies unsupported formats, malformed replies, expired URLs, missing headers, auth needs. | §6 |
| R-2.3 | Record success / fail / skipped / unsupported / inconclusive separately; continue after failure/timeout; per-provider report + overall summary. | §6.2, §10 |
| R-2.4 | Never treat "responded" or "returned a URL" as fully compatible; separate discovery from accessibility from playback. | §6.1, N-5 |
| R-3.1 | Video: container, codec, resolution, fps, bitrate, stream count, single file vs segmented, direct/HLS/DASH/provider-specific. | S8 |
| R-3.2 | Audio: codec, track count, language, selection, channel layout. | S8, S9 |
| R-3.3 | Subtitles: count, language, format, embedded vs external, URL/mechanism, standard vs provider-specific. | S6, S8 |
| R-3.4 | Resolution/quality variants: separate files vs URLs vs manifest renditions; displayed correctly; quality preserved through selection. | S6, S8, S9 |
| R-3.5 | Metadata: size, duration, MIME, headers, auth, expiry, redirects, range support, Referer/cookies/authorization, provider-specific fields. | S7 |
| R-3.6 | Don't assume every provider supports everything; record *unsupported* accurately — not as failure. | §6.2 |
| R-4 | Detect nonstandard responses (e.g. a `.jpg` URL that is a video stream): compare extension vs headers vs bytes; record real structure; decide whether an adapter/normaliser is needed; don't assume unusual = invalid. | §7 |
| R-5 | Lightweight probing: HEAD, small Range, manifest-only, bounded probes, stop when enough evidence, strict byte/time limits, record Range/HEAD behaviour, **never** auto-fall back to a full download, bounded temp files. Unverifiable-by-light-means ⇒ *inconclusive* or a controlled alternative — never "broken". | §6.5 |
| R-6 | Validate through the production pipeline (parse → normalise → resolve → detect → streams → quality → engine selection → error/fallback). Distinguish: request OK / URL extracted / reachable / metadata detected / streams identified / engine-compatible / playback verified. A stage never implies the next. | §6.3, §6.4 |
| R-7 | Full audit, targeted audit (provider / repository / category / format / previous failures), periodic audit with regression comparison; explicit maintainer operation, never at startup. | §11 |
| R-8 | Structured machine-readable results + concise human summary; per-provider fields (ids, timestamp, version, stages, durations, extraction, formats/codecs/tracks, header/content-type mismatches, engine results, failure stage/category, bytes, range honoured, retries, classification); redaction; final report contents incl. regressions and prioritised issues; detailed logs preserved without verbose routine output. | §10 |
| R-9 | Bounded retries with backoff; rate limits; per-provider and overall limits; continue after failures; no re-testing permanent invalids within a run; transient vs repeatable; cancellation-safe; incomplete tests explicit; repeatable; **no side effects on configuration/preferences/production data**; controlled concurrency with per-provider isolation. | §6.6, §12 |
| R-10.1 | Inspect existing registry, repository management, extraction, probing, engine selection, normalisation, tests **before** implementing. | §3, §14 |
| R-10.2 | Reuse established architecture; no duplicate registry or conflicting media detector. | §2.3 N-7, §5.2 |
| R-10.3 | Acceptance: 12 criteria (runner, classification, inspection, nonstandard detection, no full downloads, isolation, stage separation, rerun, diff, safe logs, test coverage of malformed/expired/HTTP error/unsupported/missing headers/Range failure/timeout/partial metadata, existing behaviour intact). | §12 |

---

## 5. Architecture

### 5.1 Shape: one orchestrator, one JVM sidecar (or small pool), one headless Electron network worker

```
tools/audit/provider-audit.mjs      (Node, run with --experimental-strip-types — same as native-engine-matrix)
 │  discovery · scheduling · budgets · journal · verdicts · report · diff
 │
 ├──► JVM sidecar(s)         line-JSON RPC, exactly as the app and provider-e2e drive it
 │        load → [declare, catalogue, search, detail, links] → unload   (one archive at a time per JVM)
 │
 ├──► net-worker (Electron, headless)   evolution of tools/e2e/links-play.cjs
 │        every byte of every *source* request goes through Chromium net.fetch
 │        owns the byte meter (aborts the socket at the cap) and the per-host limiter
 │        optional: hosts the WebView/clearance reverse channel for the sidecar (`--webview`)
 │
 └──► production modules imported from desktop/electron (type-stripped), never copied:
          MediaProxy(fetchImpl = net-worker fetch) · MediaInspector · decideStrategy ·
          mapProviderLink · classifyFailure/groupingForm · redactUrl/redactHeaders ·
          (optional) PlaybackEngine + MediaTranscoder
```

Why this split, in one line each:
- **Node orchestrator**: matches every existing `tools/e2e` script; testable under `bun run test`'s type-stripping; no window needed.
- **Electron only for the network** (G-03): the one thing Node cannot judge faithfully. Keeps the Electron-free parts fast.
- **Real `MediaProxy` / `MediaInspector`** (G-02): the thing being validated is the product's handling, so the product's code does it.

**Pure logic goes under `desktop/electron/cs3/audit/`** (new), so the repo's test runner discovers its `*.test.mts` and the tools import it the way `native-engine-matrix.mjs` imports `mediaInspector.ts` (note: `.ts` extensions on imports are load-bearing, `AGENTS.md` §3). That is: sniffing, verdict composition, attribution, budgets, journal reduction, diff. The runner under `tools/audit/` stays thin.

### 5.2 Reuse map (nothing here is new infrastructure)

| Need | Reuse | Do not |
|---|---|---|
| Provider list | RPC `providers` / `load` result + `cs3-provider-registry.json` shape (read-only) | build a registry |
| Repository list | `official_repositories.json` + installed set; resolve index with `survey-repositories.mjs` / `provider-e2e.mjs` `resolveRepository` logic | hard-code repos |
| Link semantics | `mapProviderLink` | re-read `.m3u8` in URLs |
| Transport/body class | `MediaInspector` (HLS/DASH manifest parse, TS PMT audio-in-segments `media/tsProgram.ts`, ffprobe) | write a second prober |
| Header injection, manifest rewrite, PNG-TS unwrap, range model | `MediaProxy` | write a stand-in proxy |
| Engine choice | `decideStrategy` + `shouldRouteToNativeEngine`; strategy names from `PlaybackStrategyType` (10 today) read at run time | hard-code "four engines" |
| Failure causes | `classifyFailure` (+ `UNSCORED_FAILURE_KINDS` to know what not to count) | invent causes |
| Link TTL | the deadline reader in `sourceCache.ts` (`Expires`/`exp`/JWT, case-insensitive) | re-parse |
| Redaction | `logging/redact.ts` (`redactUrl :71`, `redactHeaders :129`) | log raw |

> "Four playback engines" in the brief maps, in the repo, to: the **media element** (DIRECT, HLS via hls.js, DASH via Shaka, EME), the **ffmpeg pipeline** (`MediaTranscoder`: remux/transcode), **mpv** (`NATIVE_MPV`), and the **torrent engine** (WebTorrent) — with external players and yt-dlp as hand-off lanes. The audit does not encode that list; it records the strategy the production function returns, so a new strategy appears in reports without audit changes.

### 5.3 Proposed files (all new; none exist yet)

```
tools/audit/
  provider-audit.mjs            CLI entry (flags in §11)
  net-worker.cjs                headless Electron: fetch+meter+host-limiter+(webview) over line-JSON
  lib/discover.mjs  lib/sidecar.mjs  lib/seed.mjs  lib/stages.mjs  lib/journal.mjs  lib/report.mjs
  corpus/seeds.json             per (type × lang) fallback title bank, incl. non-Latin scripts
  corpus/expectations.json      reviewed known-quirks with owner, reason, expiry date (§10.5)
  runs/                         gitignored output — anchor the rule: /tools/audit/runs/
desktop/electron/cs3/audit/     pure, tested
  sourceSniff.ts  stageResult.ts  attribution.ts  budget.ts  quirks.ts  diff.ts  schema.ts
  *.test.mts
desktop/package.json            script: "audit:providers"   (one line)
docs/agents/field-notes/extensions.md   dated notes as the audit teaches things (not AGENTS.md)
```

Doc discipline (`AGENTS.md` §14): add a **capsule + one table row** to `AGENTS.md` (command, what it writes), keep detail in the domain file / field notes, and never grow the core file.

---

## 6. The validation model

### 6.1 Stage ladder (each stage independent; a pass never implies the next)

| Stage | Question | Evidence recorded | Cost |
|---|---|---|---|
| **S0 Discover** | Which archive/provider is this, from where, which build? | repo id, archive `sha256`, size, version, install state, translation tier (T1–T4), app git sha, `RUNTIME_GENERATION`, runtime fingerprint | none |
| **S1 Load** | Does the archive load and register providers? | `load` result (tier, tierReason, provider list), duration, stderr lines classified by `cs3/sidecarStderr.ts`, post-`unload` leak check | JVM |
| **S2 Declare + Site** | What does it claim, and is its *site* alive? | `mainUrl`, `lang`, `supportedTypes`, `hasMainPage`, `hasQuickSearch`; DNS result, TLS result, one `GET /` (status, redirect chain, parked-page and challenge detection via `torrent/botChallenge.ts`) — **separates "site dead" from "plugin broken"** (H-06) | 1 req/host |
| **S3 Catalogue** | Does `getMainPage` give usable rows? | `providerMainPageSections` + up to 2 rows via `providerMainPage`; classes OK/MULTI/EMPTY/DROPPED/ERROR as in `catalogue-e2e.mjs`; item shape fingerprint | RPC |
| **S4 Search** | Does search find a title the provider itself listed (round-trip), and does it handle a Unicode query? | per query: count, latency, shape fingerprint; `unsupported` if the bridge answers "does not implement" (`searchUnsupported`); for non-Latin providers one query in the provider's script | RPC |
| **S5 Detail** | Does `load` return a coherent title? | type, year, plot, poster, episodes/season shape, recommendations, `dataUrl`/episode `data` handle kind (opaque blob vs URL — "a links handle is not a page address", `cs3/extensionAddress.ts`) | RPC |
| **S6 Links** | What does `loadLinks` hand back, in the provider's own words? | per link: `source` (extractor), `name`, `type`, `isM3u8`, `isDash`, `mimeType`, `quality`, `referer`, header **names**, `audioTracks[]`, `drm`, `playlist[]`, `extractorData` present?; per call: `subtitles[]` (lang, url host/shape, format guess), link count, schema fingerprint; torrent/magnet detected via `isTorrentLink` | RPC |
| **S7 Reach** | Can the source be fetched, how, and what is it *really*? | §6.5 protocol: HEAD→Range-GET ladder; redirect chain (hosts only); status; `Accept-Ranges`/`Content-Range`; declared vs sniffed type (§7); required headers inferred by differential retry (with/without `Referer`/UA); URL-derived expiry; bytes spent | ≤64 KB/source |
| **S8 Inspect** | What streams does it contain? | production `MediaInspector` through production `MediaProxy`: transport, container, video (codec, profile, bit depth, w×h, fps, bitrate, HDR), audio tracks (codec, channels, language, default), subtitles (codec, language, embedded), duration, HLS renditions/variants (resolution ladder, audio groups, audio-in-segments), DASH adaptation sets, DRM, `probeIncomplete`, `probeBytesTransferred` | ≤ cap (§6.5) |
| **S9 Route** | What would CS3 do with this, on which machine profiles? | `decideStrategy` × profile matrix (§6.4): strategy, `directPlayable`, plan, explanation, `shouldRouteToNativeEngine`; invariant checks (e.g. AC-3/E-AC-3/DTS must never be `DIRECT`; DRM never to ffmpeg; Hindi dual-audio keeps both tracks selectable) | none (pure) |
| **S10 Verify** | Does it actually play? **Opt-in, tiered.** | T1 `<video>`/hls.js for element-routed; T2 `MediaTranscoder` first-chunk time + sustained bytes/s for remux/transcode; T3 mpv N seconds (playhead, dropped frames, hw decoder) for `NATIVE_MPV`; each hard-capped in bytes and seconds | highest |

Provider-level headline = **deepest stage reached with passing evidence**, e.g. `S7 reachable`, `S8 inspected`, `S9 routable`, `S10 played`. Reports show the ladder, never a single boolean.

### 6.2 Outcome vocabulary (per stage, per provider; exactly one)

| Outcome | Meaning | Counts against compatibility? |
|---|---|---|
| `pass` | Evidence satisfied the stage | no |
| `fail` | Stage attempted, repeatable negative, cause attributed (§8) | **yes** |
| `unsupported` | The provider *declares* it does not do this (no quick search, no main page, `Live` has no search) — a capability, not a defect | no |
| `skipped` | Policy/flag excluded it (adult gate, `--stages`, type filter, budget exhausted, listed in `expectations.json`) with the **reason code** | no |
| `inconclusive` | We could not tell, with a named reason and the alternatives already tried: `head-rejected`, `range-ignored`, `needs-webview`, `challenge`, `rate-limited`, `geo-blocked`, `needs-auth`, `network-flaky`, `budget-exhausted`, `probe-incomplete`, `host-capability-absent` | no, but listed prominently — an `inconclusive` rate above ~10 % of a repository is itself a finding about the audit |
| `blocked` | An earlier stage failed so this one was never reached | derived, never counted twice |

Run summary reports all six counts per stage. A source that cannot be validated by light means is **inconclusive or goes to S10-T3 under its own cap — never `fail`** (R-5, N-4).

### 6.3 Provider verdict (derived, not stored by hand)

| Verdict | Condition |
|---|---|
| `verified-playback` | ≥1 source reached S10 `pass` |
| `compatible` | S8 `pass` and S9 yields a non-failing strategy; S10 not run |
| `reachable-only` | S7 `pass`, S8 not `pass` (probe failed/inconclusive) |
| `extraction-only` | S6 `pass`, S7 never `pass` |
| `browse-only` | S3–S5 `pass`, S6 empty with provider-side reason (e.g. nothing for these titles) |
| `site-down` | S2 site `fail` (NXDOMAIN, parked, persistent 5xx) — plugin not blamed |
| `walled` | S2/S3/S7 hit a genuine challenge and no clearance was available (`inconclusive: needs-webview`/`challenge`) |
| `plugin-broken` | S1 fails, or S3–S6 `fail` with a plugin/runtime cause while the site is alive |
| `app-gap` | S7 `pass` and the source is valid, but S8/S9 mis-handle it (e.g. a hypothesis H-01/H-02 hit) — **the audit's most actionable verdict** |
| `unverifiable` | Everything attempted was `inconclusive` |
| `skipped` | adult gate / type filter / expectation |

### 6.4 Machine-profile matrix for S9 (verdicts are per machine; measurements are not)

Stage S8 results are **properties of the source** and are cached per `urlFingerprint` within a run. S9 is recomputed for each profile:

| Axis | Values (initial) |
|---|---|
| Renderer decoders | `plain-chromium` (no HEVC, as `RENDERER_PLAIN`) · `hevc-capable` · `hevc10-capable` (Windows with HW) |
| Host encode | `software` · `qsv` · `nvenc` (`HostEncodeCapability`) |
| Native engine | `off` · `auto` · `aggressive` (`NativeEngineCapability`) |

Report the **distribution of strategies** per profile and flag cells where the same source flips class (e.g. `FULL_TRANSCODE` → `NATIVE_MPV`) — the quantified value of an engine change, and the evidence for "this provider needs mpv" lists.

### 6.5 Light-probe protocol and byte budgets (enforced by the meter)

**Request ladder for S7 (stop at the first sufficient answer, record which rung answered):**

1. `HEAD` (provider headers). If `405/501`, closed connection, or content-length/type absent → rung 2. *Record `head: supported|rejected|lies`.*
2. `GET` with `Range: bytes=0-0` (as `describeUnreadableSource` does, `main.ts`) → learn status, `Content-Range` total, `Accept-Ranges`. `206` = honoured, `200` = **ignored** (abort immediately after headers; never read the body to learn this).
3. `GET Range: bytes=0-65535` → body sniff (§7). For MP4 with `moov` not in the head, one `Range: bytes=-65536` tail read.
4. If `Range` is refused (`416/403` bounded-only): retry as the proxy's `boundedRanges` window (64 KB) and record `range: bounded-only`.
5. Manifests (`#EXTM3U`, `<MPD`): read the manifest only (≤64 KB, `MANIFEST_SNIFF_BYTES`), resolve variants, then **one** 64 KB read of the first media segment (as `MediaInspector.segmentStreams` does) — never the segment list.

**Differential header test (cheap, high-value):** if rung 2 returns `401/403`, repeat once without `Referer`, once with `Referer` = the provider `mainUrl`, once without `User-Agent` override. The result names the *required* header set (`requires: [Referer]`) — a direct answer to "missing headers" (R-2.2) and a check that the provider's own headers actually make the difference.

**Budgets (defaults; flags override, never to "unlimited"):**

| Level | Scope | Default cap | Notes |
|---|---|---|---|
| L0 sniff | per source | **64 KB** (+64 KB tail for MP4) | S7 |
| L1 manifest | per source | **128 KB** | manifest + first segment head |
| L2 inspect | per source | **16 MB hard** (2 MB first; escalate only when `probeIncomplete`, never past 16 MB) | the shipping probe reads up to 10/15 MB (G-16); the audit sets an explicit meter below 16 MB and records `probeIncomplete` rather than exceeding it |
| L3 verify | per source | **32 MB hard + 12 s wall** | T1/T2/T3 |
| Provider | all stages | **48 MB, 3 sources deep** at S8, **1 at S10** | |
| Host | concurrent / spacing | **2 in flight, ≥400 ms between requests** | shared by all providers on that host |
| Run | total | reported, soft cap `--max-bytes` (default 4 GB) | abort cleanly when hit |

The meter lives in `net-worker.cjs` and in the `FetchLike` handed to `MediaProxy`/`MediaInspector`: it counts bytes as they arrive and **aborts the socket** at the cap (lesson from `AGENTS.md` §9: `res.resume()` discards but does not stop a transfer — destroy request *and* response). ffprobe/mpv/ffmpeg consume loopback URLs from the proxy, so they are metered too. Temp files (audit run dir only, `appStorage`-style ownership marker) are deleted in `finally`; a size ceiling is asserted in tests.

### 6.6 Network etiquette and reliability

- **Concurrency**: global default 4 providers in flight; **per-host** limit 2; a host that returns `429` or a challenge enters a cooldown (escalating, reset on success — mirror `torrent/indexerBudget.ts`) and its remaining providers are marked `inconclusive: rate-limited`, not failed.
- **Retries**: transient kinds only (`timeout`, `network`, `server-error`, `blocked: rate-limit`) — 2 retries, 2 s then 8 s, jittered. A **repeatable** failure requires two *independent candidates* (different titles) failing the **same stage with the same `groupingForm`**; one failure on one title is `suspect`, rerun once on another.
- **Deadlines**: per RPC 90 s (as `provider-e2e`); per provider 180 s for S1–S7 + 60 s per inspected source; overall `--max-hours` (default 3). The host deadline rule stands: the worker stops before the waiter (`cs3/hostDeadline.ts`).
- **No permanent-invalid retesting in a run**: a host with NXDOMAIN or a parked page is probed once; all providers on it inherit `site-down` with a pointer to the shared S2 evidence.
- **Cancellation** (SIGINT / `--cancel`): finish the in-flight request, flush the journal, unload, delete temp, write `status: incomplete` with the cursor. Never leave a JVM or Electron child running.

---

## 7. Nonstandard responses: detection catalogue (R-4)

The principle: **record a URL's claim, then measure the body, and report the disagreement.** `sourceSniff.ts` (pure, tested) turns the first bytes + headers into a `SniffResult { kind, confidence, evidence }` using magic numbers, not extensions:

`m3u8` (`#EXTM3U`), `mpd` (`<MPD` — **not** merely `<?xml`, see H-01), `mp4/fmp4` (`ftyp`/`styp`/`moof`), `mkv/webm` (`1A 45 DF A3`), `ts` (`0x47` every 188 bytes), `png+ts` / `jpeg+ts` (image header then TS — the PNG-wrapped-TS case the proxy unwraps), `flv`, `avi`, `ogg`, `mp3/aac/flac`, `html`, `json`, `xml-other`, `zip/rar/7z/gz`, `torrent` (bencode `d8:announce`), `image`, `empty`, `unknown`.

| Code | Nonstandard shape | Detection | Production handling today `[source]` | Audit reports |
|---|---|---|---|---|
| **N-1** | Extension lies (`.jpg/.png/.css/.txt/.ico/.webp` URL serving video/TS/HLS) | sniff ≠ extension class | PNG-wrapped TS unwrapped (`mediaProxy.ts:1400-1423`); others rely on ffprobe's content sniffing | `ext-mismatch` + both values; marks `adapter-needed` only if S8/S9 then fail |
| **N-2** | `Content-Type` lies (`image/*`, `text/html`, `application/octet-stream`, `text/plain` on media) | header class ≠ sniff class | proxy forwards upstream type verbatim on bounded path (**H-02**) | `mime-mismatch`; S10 T1 decides whether Chromium copes |
| **N-3** | Image-wrapped TS segments | PNG signature then `0x47` at 8+n·188 | handled (E-03, FFmpeg 7.1 `extension_picky` detection) | `wrapped-ts` ⇒ `handled` if S8 passes, else `app-gap` |
| **N-4** | HLS with extensionless / disguised segments, relative or token-bearing multi-hop | manifest walk | handled | `disguised-hls` |
| **N-5** | Redirector (`.php`, `/go/…`, 301→302→CDN) | redirect chain | `net.fetch` follows; proxy handles | chain length, hosts, final sniff |
| **N-6** | JSON/HTML envelope (`{"url": "…"}`, base64 `data:`, JS-obfuscated URL) as the "link" | sniff `json/html`, regex for embedded media URL **only to report, never to follow** | none (provider's job) | `envelope`; counts as `fail: provider-error`-class `extraction-incomplete` |
| **N-7** | Embed/interstitial/captcha page returned as a link (extractor didn't reach a stream) | sniff `html` with `<iframe`, `<video`, challenge markers | none | `html-page-as-stream` (**H-07**) ⇒ attributed to the extractor |
| **N-8** | Non-HTTP schemes: `rtmp(s)://`, `rtsp://`, `udp://`, `mms://`, `intent:`, `vlc:`, `ace:` | scheme | `mapProviderLink` accepts any string; proxy refuses non-http | `unsupported-scheme`; classed `unsupported`, not `fail` |
| **N-9** | Torrent/magnet | `isTorrentLink` | torrent engine | `torrent` ⇒ S7/S8 `skipped: torrent-lane` unless `--torrents` (metadata only, 30 s cap, no pieces) |
| **N-10** | Live streams: unbounded TS/HLS, no `Content-Length`, no `ENDLIST` | no length, rolling playlist | `judgeableDuration` skips judging | `live`; S8 reads the playlist/first segment only; S10 T3 for N seconds |
| **N-11** | DRM (ClearKey/Widevine/PlayReady) | `link.drm` / manifest | EME path / DASH_NATIVE; FFmpeg never | `drm:<scheme>`, `keys: present\|absent`; S10 T1 only (mpv has no CDM) |
| **N-12** | Range ignored (200) / bounded-only / refused | §6.5 | `rangeSupportFor`, `boundedRanges` | `range: ignored|bounded-only|refused|honoured` |
| **N-13** | Header-gated (Referer/Origin/UA/Cookie) and IP/time-bound tokens | differential test, URL expiry | proxy injects | `requires: […]`, `ttl` |
| **N-14** | Content-Encoding gzip/br on media, chunked with no length, HTTP/2-only | headers | via `net.fetch` | `encoded`, `no-length` |
| **N-15** | Subtitle oddities: JSON, base64 SRT, ZIP/GZ, ASS/SSA, SRT with BOM/CP1252, relative URLs | sniff + charset (`subtitles/convert.ts` detectors) | converted to WebVTT in the player | `subtitle: format, charset, convertible: y/n` |
| **N-16** | Archive downloads (`.zip/.rar`) as "streams" | sniff | none | `archive` ⇒ `fail` (not a stream) |
| **N-17** | Side-file audio (`audioTracks[]`), multi-part `playlist[]`, one-link-per-resolution, one-link-per-language | `mapProviderLink`, grouping via `resolutionVariants.ts` | handled in player | recorded, plus whether the player's Audio/Quality menus *would* be populated (S9) |

For each code that appears, the report emits a **minimal redacted reproduction record** (headers + first 64 bytes as hex + URL shape) sufficient to write a fixture test without re-contacting the provider.

---

## 8. Attribution: whose problem is it?

Every `fail`/`inconclusive` carries `owner` and `cause`. `cause` comes from `classifyFailure` (reused); `owner` is the audit's mapping, kept as a table in `attribution.ts` with tests:

| Owner | Typical `FailureKind` / evidence | Action it implies |
|---|---|---|
| `site` | S2 NXDOMAIN, parked page, persistent 5xx, expired TLS | none for us; surface "site unreachable" (§13 E-05) |
| `provider-plugin` | `provider-error`, `unreadable-reply`, `not-found` after site alive; shape drift vs previous run | upstream/community; our shim can't fix |
| `runtime` (shim/bridge/translator) | `runtime-unavailable` (`NoClassDefFoundError`, `NoSuchMethodError`, `VerifyError`…), `unsupported-operation`, `UnsupportedAndroidApiException`, tier `T4_BLOCKED` | fix in `sidecar/` shim/bridge; bump `RUNTIME_GENERATION` |
| `app-media` | S7 ok, S8/S9 wrong (`app-gap`), mislabelled content type, mis-classified transport | fix in `media/*`, `mediaProxy.ts`; add a fixture |
| `app-host` | `needs-webview`, `challenge`, `host-capability-absent`, clearance cooldown | WebView/clearance path (PRD-49/55) |
| `environment` | `network`, `timeout`, `geo-blocked`, DNS | rerun / other vantage (§13 E-10) |
| `inconclusive-audit` | audit couldn't tell | improve the audit, not the provider |

**Two roll-ups matter most and are mandatory in the summary:**
1. **By extractor/host** (`link.source`, final media host): the shared-root-cause view (G-07). One row = one `ExtractorApi` or file host, with providers affected, links tried, S7/S8 pass rates and the dominant `cause`.
2. **By root cause** (`cause` + `groupingForm`): one issue per cause, listing every provider it touches, as the issue ledger's "count before fixing" rule demands.

---

## 9. Safety, privacy and ethics

- **Adult gate (N-8)**: default `skipped: adult-gate` for the 84 adult-only providers. `--include-adult` is explicit; with it, **metadata-level only**: S3–S8, no S10, no thumbnails, no titles in the report (hash + index), no `mpv`. **Mixed** providers (3 measured; `NSFW, Movie, …`) are tested like general ones using the app's own screening — seeds are drawn from rows `src/utils/adultContent.ts` does **not** flag (`screenSections`/`screenLists`), so the audit sees what an adult-off viewer sees.
- **Vantage**: runs record the network context the user declares (`--vantage-tag`, DNS mode) — never an IP address.
- **Redaction (R-8)**: the persisted URL form is `scheme://host/<path-shape>?<param-names>` + `urlFingerprint = sha256(normalised url)` for cross-run matching. Headers keep **names only**, except `Referer`/`Origin` host. `Cookie`, `Authorization`, `Set-Cookie`, `X-*Token`, signed query values, JWTs are never stored. `--keep-raw` writes unredacted captures to a separate gitignored directory, off by default, deleted by `--purge-raw`.
- **No user data**: the audit reads installed archives through a **copy** (or read-only view) into `runs/<id>/work/` and uses its own sidecar data dir; it never opens the live datastore or `cs3-sidecar-data`. Translation cache may be seeded by copying a snapshot (`--reuse-translation-cache`), never shared.
- **Third-party burden**: per-host limits, no full downloads, retry caps, identical request shapes to the app. It is a maintainer tool and says so in `--help`.
- **Credentials in providers** (Jellyfin keys, addon URLs, logins): providers needing user credentials are `skipped: needs-credentials` — never prompted for, never guessed.

---

## 10. Outputs

### 10.1 Run layout

```
tools/audit/runs/<runId>/                 runId = <UTC ISO>-<app git sha7>-<runtime gen>
  manifest.json        inputs: flags, corpus mode, app sha, runtime generation+fingerprint, ffmpeg/ffprobe/mpv versions,
                       renderer/host profiles, vantage tag, seed, budgets, start/end, status: complete|incomplete|cancelled
  journal.ndjson       append-only, one record per stage per candidate, fsync'd per line (the source of truth)
  providers/<id>.json  reduced from the journal: ladder, evidence, sources, verdict, owner/cause
  summary.json         counts per stage × outcome; per repository; per language; per type
  summary.md           ≤ 2 screens: headline, top root causes, regressions, "needs a human" list
  extractors.json      §8 roll-up 1
  causes.json          §8 roll-up 2 (issue-ready markdown per cause in causes/*.md)
  quirks.json          §7 detections with minimal repro records
  diff-vs-<prevRunId>.json / .md
  work/                temp, deleted unless --keep-work
```

Console output is one line per provider at INFO (`name · repo · deepest-stage · verdict · seconds`) and a 10-line progress block every 30 s; detail is in the journal. `--verbose` raises it (R-8 "avoid excessive verbosity").

### 10.2 Records (sketch — final names are the implementer's, shape is the contract)

```ts
type Outcome = 'pass'|'fail'|'unsupported'|'skipped'|'inconclusive'|'blocked';
interface StageRecord {
  runId: string; providerId: string;        // `${archive.internalName}/${provider.name}`
  archiveSha256: string; repoId: string; version?: string;
  stage: 'S0'|'S1'|…|'S10';
  candidate?: { seedFrom: 'mainpage'|'bank'; titleRef: string };  // titleRef hashed for adult
  outcome: Outcome;
  reason?: string;                           // closed set: 'head-rejected' | 'range-ignored' | …
  owner?: Owner; cause?: FailureKind; groupingForm?: string;
  evidence: Record<string, unknown>;         // stage-specific, redacted
  shapeFingerprint?: string;                 // hash of key+type structure of the bridge JSON (G-15)
  bytes: number; ms: number; retries: number; at: string;
}
```

Every record carries the four **blame dimensions** (`archiveSha256`, `RUNTIME_GENERATION`+fingerprint, app sha, site-status at S2) so §10.3 can attribute a change.

### 10.3 Regression comparison (R-7, R-10.3 #9)

Join on `providerId` (fall back to `internalName`+normalised name). Compare deepest stage and per-stage outcomes. Classes:

`REGRESSED` · `IMPROVED` · `NEW_BROKEN` (new provider already failing) · `NEW_SUPPORT` (new capability: subtitles, a second audio track, DASH…) · `FLAKY` (differs across the run's own retries — never reported as a regression) · `SHAPE_DRIFT` (same outcomes, different `shapeFingerprint`) · `GONE`.

Each change lists **which blame dimension moved**: plugin build changed → provider's doing; runtime/app sha changed with plugin identical → *our* regression; only S2 site-status changed → the site. That single line turns "something broke" into an owner.

### 10.4 What is committed

Nothing under `runs/`. A maintainer may promote a **dated, redacted `summary.md`** into `docs/audits/` (precedent: `docs/audits/2026-10-14-codebase-audit.md`), which is documentation, not data.

### 10.5 Expectations file

`corpus/expectations.json`: per provider/repo/stage an expected outcome with `owner`, `reason`, `since`, **`expires`**. An expected failure that now passes is flagged `IMPROVED (unexpected)`; one past `expires` is re-asked. This stops a known-dead site from drowning regressions and keeps the list from rotting.

---

## 11. Execution modes and CLI (contract, not implementation)

```
node --experimental-strip-types tools/audit/provider-audit.mjs <mode> [filters] [options]

modes
  full                           everything eligible; resumable
  target                         with filters below
  retry-failed <runId>           only providers whose last verdict was not compatible/verified, same candidates
  resume <runId>                 continue an incomplete/cancelled run from its journal
  diff <runIdA> <runIdB>         comparison only
  list                           discovery only: archives, providers, types, hosts, shared-host groups

corpus      --corpus installed|catalogue|both   (default installed)  --repo <id|substr>  --archive <internalName>
filters     --provider <name…>  --type Movie,Anime,Live,…  --lang hi,ta,…  --extractor <source>  --format hls|dash|mp4|mkv|…
            --verdict <v>  --quirk N-2  --since-failed
stages      --stages S0-S9 (default)   --verify none|element|ffmpeg|mpv|all (default none; S10 is opt-in)
budgets     --max-hours 3  --concurrency 4  --per-host 2  --budget-source 16MB  --max-bytes 4GB
runtime     --sidecars 1  --java <path>  --webview (host the WebView/clearance channel)  --reuse-translation-cache <dir>
safety      --include-adult  --torrents  --keep-raw  --keep-work
profiles    --renderer plain,hevc  --host software,qsv  --native off,auto
reporting   --out <dir>  --compare <runId>  --json  --verbose  --vantage-tag <free text>
exit code   0 = ran to completion (even with failures)  ·  1 = ran with regressions vs --compare  ·  2 = could not run (no sidecar, no java)
```

Scheduling (R-7): the tool is invoked by a person or by an external scheduler the maintainer owns (Task Scheduler / cron / a manually dispatched workflow). Nothing in the app or default CI invokes it (N-10). A `workflow_dispatch`-only job is an acceptable later addition; a nightly one is not.

### 11.1 Time budget `[estimate — not measured; replace with the first real run]`

344 providers (~260 non-adult) × median ~35 s for S1–S9 ÷ 4 in flight ≈ **40–60 min**, plus S8 on 3 sources each, plus first-run DEX translation of ~400 archives (cached by SHA-256 thereafter). With a long tail of 180 s timeouts the **1–3 h** envelope in the brief is realistic. `--max-hours` ends the run cleanly (`incomplete`, resumable) rather than overrunning.

---

## 12. Acceptance criteria

Maps the brief's 12 items (`R-10.3`) to testable, measurable gates.

| # | Criterion | How it is checked |
|---|---|---|
| AC-1 | Discovery is complete and conserved: `tested + skipped + unsupported + inconclusive + blocked == discovered` for archives and for providers; every skip has a reason code | unit test on the reducer; `summary.json` assertion at end of every run |
| AC-2 | Every provider has a classified verdict from §6.3 and a deepest-stage label | schema test |
| AC-3 | S6–S8 capture video, audio, subtitle, resolution/variant data where present, and mark absent data `unsupported`/`not-offered`, never `fail` | fixtures (§12.2) |
| AC-4 | N-1…N-17 detectors fire on fixtures and stay silent on clean ones | table-driven tests per code, mutation-verified (revert the detector → test fails) |
| AC-5 | **No full downloads**: a fixture origin serving an endless/huge body is cut at the cap (±64 KB) at every level L0–L3 and the stage is `inconclusive: budget-exhausted`, never `fail`, never a bigger read | test with a counting origin; also asserts the meter closes the socket (origin sees client abort) |
| AC-6 | **No side effects**: SHA-256 manifest of the user-profile directory, installed `extensions/`, datastore and ledgers is identical before and after a run | integration test against a temp profile |
| AC-7 | One provider hanging / throwing / leaking never delays or fails another; the JVM is recycled on leak | fault-injection test with a stub sidecar |
| AC-8 | Reports separate: provider answered · source extracted · reachable · metadata detected · streams identified · engine-compatible · playback verified | structure test; summary table has one column per stage |
| AC-9 | `retry-failed`, `target`, `resume`, `diff` work; a run killed with `SIGKILL` resumes with no duplicate or lost records | integration test (kill mid-run, resume, compare reduced output to an uninterrupted run) |
| AC-10 | Diff names regression/improvement/flaky/shape-drift and the moved blame dimension | pure tests |
| AC-11 | No secret appears in any file under the run dir: scan for `cookie`, `authorization`, `token=`, JWT shape, signed-URL query values, in a run built from fixtures that contain them | grep-based test |
| AC-12 | Failure-path coverage: malformed JSON, truncated manifest, expired URL (410/403 with `Expires` in the past), 4xx/5xx, unsupported format, missing `Referer`, HEAD refused, Range ignored, Range refused, timeout, partial metadata (`probeIncomplete`) | §12.2 fixtures |
| AC-13 | Existing behaviour intact: `bun run typecheck`, `bun run test --fast` unchanged; no production module modified except to **export** something already there (listed in the PR) | CI + review |
| AC-14 | Repeatable: same seed ⇒ same candidate selection (selection is a pure function of seed + catalogue snapshot) | unit test |
| AC-15 | Parity: for a fixture set, the audit's S8 result equals the app's `PlaybackEngine` capability for the same URL | test that fails if the harness's inspection path diverges from the shipping one |

### 12.1 Verification discipline

Per `AGENTS.md` §14: "typechecks with `tsc -b`" is not "tested". The implementation PR reports separately what was **run live** (a real partial audit, with counts) and what is covered only by fixtures. **Electron cannot launch in a headless cloud container**; the net-worker and S10 are verified on a Windows dev machine, and the PR says so.

### 12.2 Local fixture origin (one tiny HTTP server in the test suite)

Routes serving: MP4 named `.jpg` (N-1) · same with `Content-Type: text/html` (N-2) · HLS with `.png` segments and PNG-wrapped TS (N-3/4) · endless chunked body with no length (AC-5) · `Range` ignored (200) · `Range` refused (416) · bounded-only (403 on open-ended) · `HEAD` → 405 · 403 unless `Referer` matches (N-13) · URL carrying `Expires=<past>` and `410` · 302 chains · XML error page (H-01) · HTML interstitial with `<iframe>` (N-7) · gzip media · ClearKey DASH · truncated MP4 (moov absent) · slow-loris (timeout) · JSON-envelope link (N-6). Synthesise media with ffmpeg as `desktop/electron/media/pipeline.test.mts` already does (skips itself without ffmpeg).

---

## 13. Enhancements the research already justifies (separate PRDs, not part of this work)

Ordered by expected value; each is evidence-driven and none presumes the audit's outcome.

| ID | Enhancement | Gap/hypothesis | Notes |
|---|---|---|---|
| **E-01** | **Tell the player what the body is**: when upstream `Content-Type` disagrees with the sniffed class, the proxy states the sniffed type | H-02, N-2 | One-line behaviour, large blast radius → fixture + audit confirmation first |
| **E-02** | Tighten `classifyBody`: `dash` only on `<MPD`; other XML → `unknown` | H-01 | Pure function, trivially testable |
| **E-03** | Seed `providerRanking`'s unmeasured criterion ("Supplies subtitles… Not yet measured", `providerRanking.ts:307`) from audit evidence via an **explicit, reviewed import**, never automatic | N-6 | Closes a placeholder with measurements |
| **E-04** | **Per-extractor health**: if an extractor/host fails everywhere, demote its links in source lists; one fix helps every provider that uses it | G-07 | The biggest leverage on "works for one, fails for another" |
| **E-05** | Distinguish **site down** from **plugin broken** in the Extensions UI ("this site has not answered since …") | H-06, S2 | Reduces false "extension is broken" reports and support load |
| **E-06** | A generated, redacted **community compatibility matrix** (per extension: stage reached, strategies, last audited) published in `docs/` — helps users choose and gives maintainers reproducible evidence, **without asking any maintainer to do anything** (the project's founding constraint) | whole audit | Opt-in publication of a maintainer-reviewed summary |
| **E-07** | Contract test: `ProviderBridge.encodeLink`/`encodeSubtitle` field set vs upstream 4.8.0 `ExtractorLink`/`SubtitleFile` — catches the "bridge discards data" class before a provider does | G-15 | **Needs the upstream submodule** (`_cloudstream_ref_android`, empty in a fresh clone); `[not verified]` here |
| **E-08** | Golden *shape* tests for a few stable providers using the recorded `shapeFingerprint` (drift becomes a failing test, not a user report) | G-15 | Small, curated set only |
| **E-09** | Auto-triage output: one issue-ready markdown per root cause with affected providers, minimal repro, owner, suggested action | §8 | Generated by the audit (§10.1) |
| **E-10** | **Worldwide vantage**: run from several networks (DoH on/off, different regions) and diff — geo-blocks and ISP DNS blocks (2,454 `ERR_NAME_NOT_RESOLVED` in one install's logs) look like dead providers from the wrong place; expectation tags by region tie to PRD-54 | G-05, environment owner | Needs real vantage points the maintainer controls |
| **E-11** | Non-Latin query coverage (ar, ta, hi, bn, uk, zh): search encodes/decodes correctly end-to-end through the bridge | S4 | Seed bank in `corpus/seeds.json` |
| **E-12** | Locale-sensitive parsing canary (`jdk.localedata` trap, `AGENTS.md` §3): date/year fields null across **all** items of a provider ⇒ flag | S3/S5 | Cheap heuristic over data S3/S5 already collect |
| **E-13** | Feed S7 range/head behaviour into `MediaProxy` hints so first playback of a known-Range-ignoring origin starts `sequentialInput` without discovering it live | N-12 | Only if the audit shows it is common |

---

## 14. Implementation plan (for the engineer)

### 14.1 Read first, in this order (≈1 hour; do not skip — R-10.1)

1. `AGENTS.md` §3 (build traps), §5 (rules: provider load serial, stdout = RPC only, `RUNTIME_GENERATION`, adult gate), §6 (inspect→decide→execute; proxy rules), §12 (net.fetch, `describeError`, no URL decisions).
2. `tools/e2e/provider-e2e.mjs` whole (the RPC client `Sidecar` `:245`, `resolveLinks :530`, repository resolution `:359-476`).
3. `tools/e2e/native-engine-matrix.mjs` `:44-50` (what it imports), `:310-390` (`playInMpv`), `:443-527` (`evaluateLink`).
4. `tools/e2e/links-play.cjs` (Chromium fetch, HLS walk) and `catalogue-e2e.mjs`.
5. `sidecar/…/Main.java:280-383` (RPC surface), `PluginHost.java:646` (`searchProviders`, provider pool), `ProviderBridge.kt:386-530` (what crosses the boundary).
6. `desktop/electron/cs3/providerLinks.ts`, `media/mediaInspector.ts` (`MediaInspector :966`, manifest parsers, `classifyBody :206`), `media/decisionEngine.ts` (`decideStrategy :1098`, `shouldRouteToNativeEngine :968`), `media/playbackEngine.ts` (`PlaybackEngineDeps :68`), `mediaProxy.ts` (`:520`, `wrap :559`, `rangeSupportFor :634`, content-type sites `:1139,:1400-1423,:1703`).
7. `cs3/failureTaxonomy.ts`, `logging/redact.ts`, `cs3/extensionIssues.ts` header comment (the "count before fixing" rationale), `docs/agents/extensions.md`, `docs/agents/media.md`, PRD-38.

### 14.2 Baseline to capture before writing code

Run the existing harnesses once and keep the numbers: `node tools/e2e/provider-e2e.mjs --list`, `bun run test --fast` (expect 120 suites, ~66 s as of 2026-10-08), and the registry counts in §3.1. Any later claim of "audit parity" is measured against these.

### 14.3 Milestones (each ends in something runnable and reviewable)

| M | Deliverable | Exit criterion |
|---|---|---|
| **M0 Spike (½ day)** | Prove the three hard unknowns: (a) `MediaProxy` + `MediaInspector` run headless in Node with a `FetchLike` backed by the Electron net-worker; (b) the meter aborts sockets; (c) one archive load→test→`unload` leaves no handle (`EBUSY`/`EPERM` check on Windows). Decide `PlaybackEngine`/`MediaTranscoder` headless feasibility (constructor deps) — if not cheap, S10-T2 stays a later milestone | Written finding appended to `docs/agents/field-notes/extensions.md`; §16 questions 1–3 answered |
| **M1 Skeleton** | `discover`, journal, resume, `list`, sidecar lifecycle (recycle), S0–S2, summary reducer, `manifest.json` | AC-1, AC-9 pass on a stub sidecar; real run over the installed corpus reaches S2 for every archive |
| **M2 Content stages** | S3–S6 with seeding from `getMainPage`, round-trip search, shape fingerprints, host limiter, retries/taxonomy, attribution | AC-2, AC-7, AC-14; a real partial run (one repo) |
| **M3 Source stages** | `sourceSniff.ts`, S7 ladder + meter, S8 via production proxy/inspector, N-codes, extractor roll-up | AC-3, AC-4, AC-5, AC-11, AC-12, AC-15 |
| **M4 Routing + reports** | S9 profile matrix, verdicts, `summary.md`, `causes/*.md`, `diff`, expectations file | AC-8, AC-10; first **full** run recorded (time, bytes, counts) replacing §11.1's estimate |
| **M5 Verify + hardening** | S10 tiers (opt-in), `--webview`, `--torrents`, `--include-adult` metadata-only, adult tests | AC-6, AC-13; docs capsule in `AGENTS.md` + field note |

Commit scope per `AGENTS.md` §14: `feat(audit): …`, `docs: …`; branch is the assigned feature branch, never `master`, no PR unless asked.

### 14.4 Traps this work walks into (from the repo's own history)

- **The runtime you run is not the one you built.** Record `RUNTIME_GENERATION` + the runtime jar fingerprint in `manifest.json`, and choose deliberately between the app-managed copy (what users have) and the repo build (`sidecar/runtime/`); never mix. Comparing results across the two is a feature (`--runtime app|repo`), not an accident.
- **Provider loading is serial.** Never `load` two archives concurrently into one JVM; calls *after* loading may overlap (the provider pool does). With `--sidecars N`, each JVM gets its own data dir.
- **Sidecar stdout is RPC only.** Reuse the existing client's handling of unparsable frames.
- **Windows file handles.** Wait for JVM exit before deleting `work/` (`provider-e2e.mjs` `stop()` and `maxRetries` rationale).
- **`mvn package` rewrites the tracked shim jar** — don't commit it; the audit does not build anything.
- **`.ts` import extensions are load-bearing** under type stripping; `electron` imports make a module unloadable there (`cs3/diagnostics.ts` is the cautionary example). Keep `cs3/audit/*` free of `electron`.
- **Node `fetch` ≠ `net.fetch`** (G-03). Source-bytes requests go only through the net-worker; Node `fetch` is allowed for repository JSON and nothing else.
- **A catch that reassures is worse than no catch**; use `describeError`; empty answers carry reasons.
- **Don't invent `bundled: true` from a cloud run** — cloud egress 403s provider hosts; a result from there is `environment`, never evidence about a provider.

---

## 15. Risks

| Risk | Mitigation |
|---|---|
| Audit pressure bans the maintainer's IP | per-host limits, cooldowns, identical request shapes, `--max-hours`; first runs use `--repo` slices |
| False negatives from the audit's own limits (WebView, Range, geo) | `inconclusive` taxonomy; an `inconclusive` rate over ~10 % is itself reported as an audit defect |
| The audit drifts from the product | AC-15 parity test; shipping modules imported, not copied |
| A 10–15 MB production probe vs "no big downloads" | explicit L2 cap with `probeIncomplete` recorded (§6.5); the tension is documented, not hidden |
| Result files become another unversioned pile (G-08) | run id, schema version in `manifest.json`, journal as source of truth, promotion path to `docs/audits/` |
| Over-reading green results | headline is "deepest stage reached"; `verified-playback` requires S10; `AGENTS.md` honesty rules apply to the PR description |
| Seeds from `getMainPage` bias toward a provider's best-case content | also test one search-only bank title; compare — disagreement is a finding (H-05) |
| Legal/ethical exposure from scraping | read-only, bounded, adult off by default, no redistribution of content, reports redacted, no commit of runs |

---

## 16. Decisions needed from the owner (each has a recommended default)

1. **JVM pool size.** One sidecar (simple, slow) vs `--sidecars 2–3` (faster, more memory, isolated data dirs). **Recommend: default 2**, M0 measures heap.
2. **WebView host in v1.** Without it, every challenge-gated provider is `inconclusive: needs-webview` (honest but uninformative); with it, the audit exercises the real clearance path (PRD-49) and needs a display. **Recommend: include as opt-in `--webview` in M5**, default off.
3. **Default corpus.** Installed set (what this user has) vs catalogue (what a new user would get, ~55 repos, includes uninstalled). **Recommend: `installed` default; `catalogue` for the periodic run.**
4. **`PlaybackEngine`/`MediaTranscoder` headless.** If M0 shows heavy constructor deps, S10-T2 (ffmpeg first-chunk) is deferred; S10-T1/T3 and S9 still ship. **Recommend: accept the deferral.**
5. **S10 default.** Off. Playback verification costs time and bytes; the maintainer opts in per run or per slice. **Recommend: keep off.**
6. **Where promoted summaries live.** `docs/audits/<date>-provider-audit.md` (precedent exists). **Recommend: yes, maintainer-curated only.**
7. **Adult metadata run.** Allowed at all, even metadata-level? **Recommend: yes, behind the explicit flag, with hashed titles.**

---

## 17. Appendix — what this PRD did *not* verify

- **No live network run was made.** Every timing here is an estimate; every defect marked `[hypothesis]` is a reading of code, not an observation.
- **The upstream Android source was not consulted** (submodules are empty in this checkout). Statements about upstream `ExtractorLink`/`SubtitleFile` fields (E-07) rest on the bridge's own comments and `docs/docs_cs3/`.
- **Headless construction of `PlaybackEngine`/`MediaTranscoder` was not attempted** — only `MediaProxy` and `MediaInspector` were confirmed constructible from their signatures.
- **Whether Chromium sniffs through a wrong `Content-Type` for `<video>`** (H-02) was not tested; the audit and its S10-T1 are what settle it.
- Counts in §3.1 come from the local profile (`cs3-provider-registry.json`, the `extensions/` tree) and the repo's catalogue; another machine will differ, which is why discovery reports them rather than assuming them.
