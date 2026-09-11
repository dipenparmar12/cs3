# Torrents, indexers, search and ranking

Domain notes for CloudStream 3 Desktop, covering §7 and §8.

**Read `AGENTS.md` first.** It carries the repository map, the build and test commands, the
IPC contract, the service table and the rules that cut across every area. This file assumes it.

Section numbers here match `AGENTS.md`'s, so a cross-reference like `§6.10` resolves whichever
file you are in. **If this contradicts the code, the code wins — fix this file in the same commit.**

---

## 7. Torrents and indexers

### 7.0 A failed start walks the list; a chosen source does not

Reported as **"Tried 1 source and none started"** on a title with **70 sources** — the app
tried one 120-seeder torrent whose swarm was dead and stopped, with a 3,564-seeder release
four rows down that was never asked.

`startBestStream` has its own four-candidate walk, but the two paths reaching
`PlaybackSession.beginStream` with `failover: false` hand it a **single** candidate (an explicit
pick, and each step of `skipCurrentSource`). Its `catch` recovered only when the candidate
carried a `directUrl` — the branch written for expired provider links — so a torrent fell
straight through to `phase = 'error'`. The asymmetry was never a decision about torrents; it is
what that branch happened to be written against.

Now a failed start retires what it tried and continues. Three rules hold it together:

- **Retire what was *attempted*, not what was offered.** `startBestStream` is handed a list and
  tries the first `maxAttempts` of it, so the two sets differ. Retiring the offered list walked
  off the end in one pass — measured while building this: a 70-source title retired 64 untried
  sources on its second pass and reported nothing left. The attempts now ride on the thrown
  error (`StreamAttempt.infoHash`), which is the only way a caller can act on them; the message
  alone is prose.
- **Termination is structural.** Retired sources go into the same `unplayable` set
  `skipCurrentSource` keeps — one set, because "skipped by hand" and "failed to start" are both
  *do not offer this again* — so the remaining list strictly shrinks.
- **Bounded by `MAX_AUTO_ADVANCES` (2)**, i.e. at most nine sources, because termination is not
  enough: 70 dead swarms at the 12s bail would walk for half an hour. Running out reports the
  session's own count ("9 of 70 sources were tried"), not the last pass's, which read as the
  list never having been walked.

**The opposite rule is deliberate and tested beside it**: `selectSource` tries exactly what the
viewer picked and stops (`userChoice: true`). Someone who chose a release for its language or
audio has not asked for a different one. A fix for the first rule that breaks this one passes
every case in `playbackFailover.test.mts` except the last.

### 7.1 Startup: the client was cold, it was never the swarm

Compared against a hosted service (~1s vs tens of seconds) with identical peers. The gap is one-time costs a service pays once and a desktop app paid every launch: socket binds, DHT bootstrap (DNS + round trip to `k-rpc`'s 3 hardcoded hosts), converging on an infohash from 3 contacts, reachability from an ephemeral node id/port, and the info dictionary (BEP-9, 5–30s).

1. **`TorrentEngine.warmUp()` 8s after the window opens** (`TORRENT_WARMUP_DELAY_MS`). Never awaited, never fatal.
2. **DHT routing table / node id / port persist** (`dhtNodeCache.ts`, `userData/torrent-state/`). Contacts expire weekly; the node id doesn't. `dhtPort` is pinned to **6882** — WebTorrent's default of 0 quietly cancelled the persisted id.
   **Saved contacts go through `DHT.addNode()`, never `bootstrap`.** `k-rpc` compares the candidate-set length against `bootstrap.length` every lookup round, so 200 saved contacts in `bootstrap` makes that test permanently true: the per-lookup table (the convergence mechanism) is discarded every round and `bootstrap()` fires the whole list in one burst, bypassing the concurrency gate. A test pins `DHT_BOOTSTRAP_NODES.length < 20`.
3. **`.torrent` metadata cached on disk by infohash**, self-verifying (info dict sliced and SHA-1'd; a mismatch is deleted). The bencode reader is hand-written because the hash must cover the **exact original byte range** — a parse/re-encode round trip normalises key order and loses it.
4. **Magnet `xs` mirror links** — WebTorrent already races them against the swarm and discards mismatched infohashes; this module just builds the URLs. Setting `torrent_http_metadata_cache` is a **getter**, consulted per magnet, not read once.
5. **`ut_pex` stated explicitly** (helps when the tracker is slow or dead).
6. **Magnet `tr=` trackers merged into `announce`** — a cached `.torrent` buffer used to discard the magnet's trackers entirely.

Timing: `METADATA_TIMEOUT_MS` 45s→25s plus a 12s dead-swarm bail (measures **known** peers `_peers`, not connected — reachability is `swarmHealth.ts`'s job). `PLAYABLE_THRESHOLD_BYTES` 8MB→4MB (lower and the demuxer runs out, which reads as a stall). The tail window is **container-aware** (`tailPriorityBytes`): MP4/MOV/AVI need a trailing `moov`/`idx1`, Matroska doesn't, MPEG-TS has no trailing index at all (MKV is the modal container here).

**Does not fix**: CGNAT reachability, genuinely dead swarms, host-side 403s.

Two more load-bearing torrent behaviours: **file selection inside season packs** (deselect all, select one, or bandwidth splits across episodes and nothing plays) and **leading-bytes readiness** measured as contiguous leading pieces, not overall percent.

### 7.2 A search costs what its worst indexer costs

Every indexer used to get a flat 20s and they all ran at once; the circuit breaker needed three consecutive failures, so a permanently blocked scraper cost three full timeouts, then three more five minutes later.

`torrent/indexerBudget.ts` (pure, 22 tests) decides from measurement:
- **Deadline = p90 of that indexer's own recent successes × 2.5, clamped [4s, 20s].** No history → the full budget; judging a source before it has answered is how a slow-but-working one gets called dead. p90 not mean, so an occasional 3s tail sits inside the budget. **Only successes shape it** — otherwise timing out buys a longer deadline.
- **A timeout weighs 1.5× an error** toward tripping: a 404 costs one round trip, a timeout costs the whole search.
- **Cooldown escalates** 5m → 15m → 45m → 2h, and **any success resets the ladder**.
- Fastest-first ordering, with **unproven ahead of recovering** — putting the unproven last is how a new indexer never accumulates history.

The aggregate stops waiting for stragglers (`STRAGGLER_GRACE_MS`, floored by `MIN_SEARCH_MS`). **Nothing is cancelled and no result is lost** — every indexer runs to its own deadline and still reports through `onProgress`. This bounds the *wait*, not the work.

### 7.3 A Cloudflare challenge is not a ban

`requestOnce` threw `HTTP 403` for a challenge, a country block and a hotlink refusal alike, and `withRetry` doesn't retry a 4xx. Worse: **Cloudflare's managed challenge is routinely served as HTTP 200** with an interstitial body, so cheerio parsed zero rows and the adapter reported "no results" — a search that silently got smaller.

`torrent/botChallenge.ts` (pure, 17 tests) separates challenge / block / rate-limit, and `WebViewHost` — which has solved these for `.cs3` extensions since 2026-08-24 and which the torrent lane could not reach — now solves the solvable ones once per host via `setChallengeSolver` in `main.ts`.

- **A block or a rate limit never opens a window.** A browser passes neither, and at a rate limit it makes things worse (a dozen subrequests where the scrape made one). `503` + `Retry-After` is checked **before** the challenge markers.
- A 403 behind Cloudflare with **no body to read** gets the benefit of the doubt — guessing "block" costs a working indexer; guessing "challenge" costs one browser window that finds out.
- Challenge markers are narrow: a listing page whose footer says "secured by Cloudflare" is a working page.
- **The clearance is sent with the User-Agent that earned it** (they are bound) and is **held in memory only** — restoring one from disk onto a new IP produces a failure indistinguishable from a fresh challenge.
- **`fetchDocument` is separate from `fetchText`.** HTML scrapes send what Chrome actually sends (`Sec-Fetch-*`, `Upgrade-Insecure-Requests`, a real `Accept`); RSS/JSON endpoints must **not** be asked for a document. The UA had always claimed to be Chrome while the request beside it asked for a wildcard `Accept` with no fetch metadata — a combination no Chrome produces, and exactly what bot detection scores.

TokyoTosho and AniDex were added **off by default**: the anime lane had one broad source (Nyaa) plus a spare that aggregates it, so one outage took both, and Nyaa's `c=1_2` filter removes raws and non-English releases before a query is typed. **Neither has been driven against a live host.**

### 7.4 Indexer adapter rules

`torrent/indexers/base.ts` holds `withEpisodeTerms`/`tryMirrors` (7+6 copies merged) plus `buildMagnet`/`trackersFromMagnet`/`mergeTrackers`. **Zero-padding `S01E02` matters** — drop it and `S1E2` matches nothing, which reads as "the indexer has nothing". Two anime indexers keep their own rule (absolute episode numbering).

**A direct HTTP link is not an indexer result** (PRD-43 §6) — debrid/live/yt-dlp/Jellyfin are *provider* sources regardless of what found them. `StremioAddonIndexer.search` once filtered to `infoHash`-carrying replies only, silently dropping every debrid/HTTP-only addon reply; `RawTorrent` gained a **direct URL half**, finished before magnet derivation. Identity is shared with `ContentService.extensionSources`'s `directSourceIdentity` (`ext-` prefix), else two lanes finding the same host show as two sources. `seeders: 1` is set because swarm health is meaningless for HTTP and `minSeeders` default 1 would hard-reject. `fileIdx` is dropped on `url` streams — it indexes a file *inside* a torrent.

**yt-dlp**: `extractLinks`/`searchAndExtract` existed with no caller. Transport detection was `url.includes('.m3u8')` with `fmt.protocol` sitting unread (nothing is decided from URLs); **both** video and audio streams are now required (a video-only DASH format plays silently — the same shape as the AC-3 bug). The `ytsearch1:… trailer OR full feature` fallback was removed — a trailer standing in for a film is a synthetic source. `YtDlpEngine.resolve` answers with a **reason** from stderr (Unsupported URL / Video unavailable / geo-block are three different actionable outcomes). `--no-playlist` is passed, else a series page resolves every entry. Two entry points: a pasted page URL is its own search row, and `ContentService.discover` resolves `http(s)` bases through yt-dlp. **Not** resolved from the search box — typing is not consent to spawn a process per keystroke.

---

---

## 8. Search, scope and ranking

### 8.1 Scope: a selection is a strict filter, not a preference

An unresolvable stored selection used to silently widen back to *everything* (`kept.length > 0 ? kept : candidates`), and the picker could offer fake provider names for extensions registering none — the user picks 1 source and the app queries 200. It is strict now, and unresolvable selections are **reported** (`missingProviders`/`missingIndexers`).

`SearchSession.plan()`: nothing selected → global (every provider + metadata catalogues); providers selected → **exactly those, no catalogues** (catalogues would reintroduce excluded sources under another name); indexers selected → title-searched directly.

The hierarchy is exactly **repository → extension → provider**. The provider is the selectable leaf: its globally-unique name is the scope identity, the `cs3ext://` address and the enable/disable key. A name collision is real — first wins, and the loser is reported via `unavailableReason`.

**`SearchScopePicker` filters on `effectivelyEnabled`, not `enabled`** — a repo-disabled provider offered by name would search nothing.

### 8.2 Discovery scope: ask the originating provider first

Android returns one search row per provider, binding Play to that provider alone. This app merges rows across providers (correct — one film shouldn't be seven rows), but `runDiscovery` used the merge as licence to fan out to **every** enabled provider and indexer, drawing 200 sources for a title 2 providers actually carried.

`cs3/sourceScope.ts`: default scope **`origin`** = only the providers whose results produced this row, no indexers; explicit **`all`** = everything. `origin` widens to `all` automatically when nothing claimed the title (home-screen items).

**Auto-widen when origin finds nothing** (`shouldEscalateScope`): a reported case found 137 sources (81/98 live) behind a dead-end "Find more sources" button the app could have pressed itself. It goes through `getSources` so it joins the shared in-flight map (a manual press during auto-widen doesn't double the fan-out); two independent recursion guards; **a failed escalation leaves the narrow answer standing**, never surfacing a worse error; the fan-out's `load(base)` may fail when the title is already known (escalation is enrichment, not discovery, once titled); the prefetcher passes `autoWiden:false` (opening a detail page isn't a play commitment) and it is part of `sourceKey`, else Play would join a settled-for-narrow prefetch. `SearchProgress.widened` explains the up-to-3× longer wait live.

### 8.3 The fan-out order is measured

The order was the provider registry's, i.e. install order — and that order decides how long the screen stays empty, since a lane timing out on a dead provider is a lane not spent on one answering in 350ms. `ProviderAnalytics` had been measuring success rate and latency all along and `ProviderRanking.rank` turning them into an order that **only a settings panel read**. `searchEach` reads it now.

`cs3/searchOrder.ts` is a module rather than one line because of its guard: **an ordering that is not the same set** — one dropped, added, duplicated behind a plausible length, or a throw — falls back to the original. A ranking is scored from noisy scrapes through stored weights and a smoothing prior; that is more machinery than a search should trust with "which providers am I searching". **Silently searching fewer sources and reporting it as "no results" is the worst failure this app has**, and reaching it through an optimisation is worse.

### 8.4 Ranking rules

1. **`empty` ≠ `failure`.** An anime provider with nothing for *Dune* is correct; merging the two buries specialists.
2. **Smoothed toward a neutral prior**, else it is self-fulfilling — one lucky 100% beats 95%-over-400-calls and gets asked first forever.
3. **No-data criteria are excluded from the denominator**, never scored zero.
4. **Nothing is ever auto-disabled.** Auto-*enable* is opt-in and score+sample-gated. A week-long outage is not consent to remove a user's chosen source.
5. The maintainer's declared `status` (0 down / 1 ok / 2 slow / 3 beta) is weighted **0.4** with `minSamples` **0** — a declaration isn't a sample, but requiring samples would exclude it forever; it loses to real counters the moment those exist. `ProviderRanking.setContext` supplies it post-construction, avoiding a construction-order cycle with `PluginManager`.

The settings panel shows every number and sample count plus an erase button — opaque reordering breeds distrust.

**Providers must not be scored for things that are not their fault.** The guards used to live in the *callers*: `loadLinksDetailed` wrote `if (kind !== 'provider-missing')` by hand and `searchEach` had none, so whether the ranking followed its own rules depended on which call site produced the failure. `UNSCORED_FAILURE_KINDS` now lives in the taxonomy (§5.5). Measured on one real search: Disney, Marvel, Pixar and Star Wars are catalogue-only providers that each answered "does not implement that operation" and were each recorded as a **failed search** — four permanent penalties per query against providers working exactly as designed. They have their own `SearchSourceOutcome` state (`unsupported`), read "Browse only — this source has no search", and `explainEmpty` excludes them when deciding whether *all* sources failed.

Two related traps:
- **A cancellation with no message was filed as an extension crash.** `kotlinx.coroutines.JobCancellationException` — the bare class name, which is what `describe()` produces when the exception carries none, and a cancelled coroutine carries none. The word-boundary regex needed a non-word character after "Cancellation" and found `E`. **Found by writing the test, not by reading the regex.**
- **A guess we made was blamed on the provider.** `extensionSources` calls `loadLinks` before `load` — correctly, since plenty of providers' link handle is a page address. For those whose handle is their own JSON, that first call throws inside the provider (`JsonParseException: Unrecognized token 'https'`). The retry works and the viewer gets their film, while the doomed first call was logged at error level as "the site has probably changed" and counted against the provider. `looksLikePageAddress` marks that call **speculative**: still made, still diagnosed (when the retry also fails it is the only account of what the viewer asked for), logged as a guess at `warn`, never scored. A test pins that the two predicates can never both be true.

### 8.5 Provider health, shown where it is chosen

`src/components/search/providerHealth.ts` (pure, 12 tests) puts Excellent / Good / Average / Poor on the provider rows in the scope picker. It reads `score.band` rather than re-deriving one — **two places computing "is this any good" is how the settings panel and the source list come to disagree in front of one user.** `unproven` keeps its own answer and is never folded into the middle of the scale: on a fresh install that is every provider, and a label reading as mediocre is the silently-punitive behaviour the ranking exists to avoid. Unmeasured rows draw **no badge at all**. A pinned or blocked provider is described as a choice, not measured as a quality.

### 8.6 Source profiles — All sources is a mode, not an erasure

The All-sources button was `persist(new Set(), new Set())` — an *erasure*, so eleven providers picked out of two hundred vanished on one press with no undo.

`cs3/sourceProfiles.ts` (pure, 30 tests) holds three things that can drive the scope: All sources, a saved profile, or the unnamed draft — and **the draft survives every switch**.
- Editing while a profile is active edits **that profile**; editing under All sources writes to the **draft**, never into whichever profile was last used.
- Deleting the active profile falls back to **All sources**, never to the next in the list — silently searching a different user-defined set is worse than searching everything, because only one of those is obvious from the button.
- **A facet filter alone is not a narrowed scope.** Facets decide which rows the picker shows; a button reading "1 source" over a search of two hundred is the lie `SearchScopeStore` was fixed to stop telling.
- A profile may narrow the adult gate and can **never** widen it.
- A corrupt stored record degrades to empty rather than throwing.
- An upgrading user's existing selection is adopted as the draft on first use (`adoptExistingScope`), deliberately **not** at construction — doing it at startup would silently widen the next search.

### 8.7 The scope picker

`search/SourceScopeDialog.tsx` (presentation) + `search/sourceScopeModel.ts` (pure, tested); `SearchScopePicker.tsx` keeps all data and state and is the trigger. Two distinctions were invisible in the old 330×300px dialog:

1. **A filter is not a selection.** Chips narrow what the list *shows*; a ticked box narrows what the search *asks*. As adjacent rows of similar pills they read as one mechanism — someone who filtered to "Hindi" believed they had scoped their search to Hindi providers. Separate panes, separate headings, one line in the rail saying which is which.
2. **Which facet a chip belongs to.** Twelve language chips beside six type chips separated by a hairline does not express **OR within a facet, AND across facets**. Each facet is a labelled group.

Plus: the current scope is a strip of chips that each remove their own source — a count answers "how many", never "which".

Real `tree`/`treeitem` with roving focus via `aria-activedescendant`, arrows stepping over label rows, Left/Right collapse/expand, Space to tick, focus trap, focus restored on close. **Escape is handled in capture phase.** Viewport height is **measured** (`ResizeObserver`), not a constant — the dialog is sized in `vh` and a constant mounts invisible rows on a laptop or leaves a blank band on a large display.

**`stateOf`'s vacuous case is the tested one**: a row with **no members** must read `off`, never `on` — an extension that registered nothing would otherwise draw as ticked, advertising a scope that queries nothing.

The picker's menu-open fetch used to load **every installed extension into the sidecar first** (minutes of DEX translation, no progress shown); searching "fixed" it only because search awaited the same load. Now `getSearchScopeOptions(false)` on mount (instant, from what's already registered) vs `(true)` on open (pays the cost with visible progress via `extension:providerLoadProgress`).

### 8.8 Prefetch, and sharing in-flight work

Play used to start a 15-provider scrape from cold; the detail-page reading window is free time to do it in. `cs3/sourcePrefetcher.ts` is safe **only because of in-flight sharing** (`sharedDiscovery.ts`) — else Play would double every scrape. Cancellation is by **consensus** (every caller's `AbortSignal` must withdraw); an aborted run is never joined (it stays in the map until settled). Restrained: waits ~1.2s to settle, skips on `hasFreshSources` (a `peek`, which doesn't promote), one at a time (supersedes), togglable for metered connections. The detail page shows state; `waiting`/`idle` render nothing — no badge for a mere glance. `SourcePrefetcher.schedule` is safe to call from anywhere (it declines/dedupes/supersedes internally; the player calls it at 70% of an episode).

### 8.9 Results, catalogues, OTT

- **The home screen is discovered, not hardcoded.** It used to be 3 fixed searches ("Spider-Man"/"One Piece"/"Stranger Things") against every provider, called "Trending" — a category error (scrapers have no popularity opinion) plus the slowest scraper's timeout on every launch. Now keyless Cinemeta (`cinemeta-catalogs.strem.io/{top,year,imdbRating}`, IMDb-keyed, 19 genres, pageable via `skip`) + AniList seasonal anime, kept separate from the Animation genre (IMDb's "Animation" is mostly Western film). **No API key ever** (TMDB/Trakt/OMDb/Fanart/TheTVDB all eliminated — an embedded key is a licence violation and gets revoked). Stale-while-revalidate. **Finds nothing playable** — sources resolve only when a title opens. Personalised rows come from local-library genre counts; nothing about the user leaves the machine.
- **Results that resolve to nothing are held back** (`src/utils/deadRows.ts`). **`app-error` is never hidden** — our own failures must stay visible, or a translation bug looks like a hundred broken providers. The whole page is never hidden, and the count is stated with the hidden rows one click away.
- **OTT platforms** (`cs3/ottPlatforms.ts`) map provider names → Netflix/Prime Video/Disney+/Sony LIV/ZEE5/JioCinema by **name matching only** (no other identity exists). Too-loose is far worse than too-tight (silent wrong-content fill vs. a renamed provider merely disappearing): exact names win first, patterns are anchored against known false positives (`PrimeWire`, `Ahashare`, `Netfilm`). Four availability states (`ready`/`disabled`/`aggregate`/`missing`) — collapsing to "no content" would tell a user who disabled a provider that the platform doesn't exist. A platform is a **set** of providers. Search from a platform page uses `SearchOptions.providers` override, **never written back to the stored scope**. Browse asks **one** provider (editorial "Trending" rows from two providers would interleave into neither's meaning); paging is a button, since each page is a live scrape. Sony LIV/ZEE5/JioCinema have no dedicated provider and fall back to aggregate scrapers — **fallback never merges**. **A platform needs a catalogue, not just a provider**: Hotstar had four provider names and nothing to browse (no service code in `PLATFORM_CATALOGS`, no provider publishing `getMainPage`), so its page was a brand name over a search box and the row was removed. The providers stay installed and searchable. `Disney+ Hotstar` and `JioHotstar` now match **nothing** — which is why `disney`'s pattern stays anchored and `jiocinema`'s stays `^jiocinema`: one loosened pattern would file a Hotstar library under the wrong heading.

### 8.10 The extensions screen (`src/components/extensions/`)

- **Disable ≠ uninstall, and both work.** `removeRepository` used to delete only the URL, leaving installed extensions running. Removing now cascades to uninstall; `setRepositoryEnabled`/`setExtensionEnabled` are the reversible alternative.
- **The enable cascade lives in `enabledProviderNames` only.** `getProviderTree` recomputes the identical predicate as `effectivelyEnabled` — **if they disagree, the screen lies about what a search will ask.**
- `enabled` vs `effectivelyEnabled` are deliberately separate: a provider off because its repo is off must show the responsible ancestor, not look self-disabled.
- Tag filters are multi-select and derived from installed data — the old hardcoded 3-option `<select>` silently omitted NSFW/Live/Documentary. **OR within a facet, AND across facets.**
- Install progress is real (`onExtensionInstallProgress`); the old code faked a scripted 250ms `setTimeout` sequence plus 500ms of invented delay per action.
- Provenance (`repository ▸ extension ▸ provider`, maintainers, version, types, hash) on every row.
- Browse is a full-width panel under the repo's own card, not a third tab that discarded scroll and filter state. Two tabs: **Installed** / **Browse**.
- The Providers tab was removed — it was a second, desyncing copy of the tree's leaves.

---
