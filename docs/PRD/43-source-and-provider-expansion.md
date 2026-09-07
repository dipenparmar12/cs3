# PRD-43 — More sources: the provider roster this desktop can have, and the four we already paid for

**Status:** research + proposal. **Items 1–4 of §8 are built** (see §0). Nothing else in
§6–§9 is. §3–§5 are counts, taken on the date below and reproducible by the commands beside
them.
**Answers:** "find more sources and potential providers that can be scraped or created in the
desktop version, in our own standards."
**Depends on:** PRD-41 (the five lanes and the one `Provider`/`Source` contract), PRD-39
(the lane sketch it replaced), AGENTS.md §5 (the `.cs3` execution chain as built).
**Date:** 2026-09-03.

---

## Evidence markers

Same three as PRD-41, because the failure mode is the same — a roster of candidate sources is
exactly the kind of document that turns into a wish list if the checkable half is not marked.

| Marker | Means |
|---|---|
| `[measured]` | Taken by running the command named beside it, against the live host, on 2026-09-03. |
| `[researched]` | Read from a primary source — this repository's code, a published API, upstream Kotlin. |
| `[proposed]` | A design decision made here. Not built. Arguable. |
| `[unprobed]` | Named from research and **not reachable from the container this was written in**. See §2. |

---

## 0. What has since been built

Priority items 1–4 of §8 landed on 2026-09-03, the same day this was written. The rest of the
document is unchanged and still describes what it described — including the §3–§5 counts, which
were taken **before** these changes and are the baseline they should be read against.

| Item | § | State |
|---|---|---|
| Stop discarding non-torrent Stremio streams | 4.1 | **Built.** `RawTorrent` carries a direct half, `finaliseResult` finishes it, `StremioAddonIndexer` maps both stream shapes. 13 cases in `electron/torrent/indexers/directSources.test.mts`, verified by mutation — restoring the `infoHash` filter fails 9 of them. |
| Give yt-dlp an entry point, fix its two defects | 4.2 | **Built.** `YtDlpEngine.resolve` answers with yt-dlp's own reason; `electron/ytdlpSources.ts` maps its output, taking the transport from `protocol` and refusing video-only formats; a pasted page URL becomes a search row and `discover()` resolves it. The trailer fallback is gone. 16 cases. |
| Catalogue the four repositories; gate the fifth | 5 | **Built.** `xr3ed`, `hexated`, `arabic_extensions`, `indochannel` added; `codegeasse` added as `adult: true`. None is `bundled` — that still needs `provider-e2e.mjs`. |
| Fix the dead catalogue row | 3.3 | **Half.** `pitipitii` is marked `verified: false` with the measurement in its description; its index still 404s, so there is no URL to correct it to. `fstream` is **untouched** — it was unreachable from the container, which is not evidence that it is dead. |

**The catalogue after those additions**, same command as §3.3:

```
node tools/research/survey-repositories.mjs

Catalogue: 34 repositories
TOTAL 918 extensions · 110 publishing jarUrl (12.0%) · 689 distinct names
```

So the addressable corpus went from 558 distinct extensions to 689 (+131 — the five repositories
added, not the eight surveyed), and jar-lane coverage from 10.3% to 12.0%.

`electron/officialRepositories.test.mts` was added with them: 9 rows pinning what this data file
is allowed to claim — unique ids and addresses, https only, a raw document rather than a project
page, an adult repository never bundled, a bundled repository never unverified, and the bundled
set staying small. It fetches nothing; liveness is the survey script, run deliberately.

**Items 5–10 are untouched**, and §9 still applies to all of them.

---

## 1. The short answer

Three things came out of counting, and the order is deliberate — the cheapest sources are the
ones already inside the box.

1. **Four capabilities that are built, paid for, and unreachable** (§4). A Stremio addon's
   non-torrent streams are filtered out before anyone sees them; yt-dlp's 1,800 sites sit
   behind two methods with no caller; one of the four *bundled* repositories can contribute
   nothing here by construction; and subtitles are hardwired to a single addon while the
   protocol that addon speaks is one we already implement elsewhere. None of these is a new
   feature. All four are wiring.
2. **~155 extensions the catalogue does not list** `[measured]`, from eight live repositories,
   after removing every one that duplicates something already catalogued (§5). The largest
   single find publishes 190 extensions with **47 cross-platform jars**, which is the lane that
   skips DEX translation entirely.
3. **Five source *classes* Android structurally cannot have and this app can** (§7): personal
   media servers, the local disk, debrid accounts, an open live-TV dataset of
   **17,046 streams** `[measured]`, and yt-dlp. These are where "our own standards" earns its
   keep — none of them is expressible as a `.cs3`, and every one of them is a `Provider` under
   PRD-41's contract.

---

## 2. How these numbers were taken, and what could not be

Everything in §3–§5 was measured against **raw.githubusercontent.com**, which this container
can reach. Everything else — Stremio addon hosts, torrent indexers, catalogue APIs, subtitle
services — is behind an egress policy that answered `403` to `CONNECT` for every non-GitHub
host tried, so it is marked `[unprobed]` and **must not be reported as verified**.

```
# what the container could and could not do
curl -sS -o /dev/null -w '%{http_code}\n' https://raw.githubusercontent.com/recloudstream/extensions/master/repo.json   # 200
curl -sS -o /dev/null -w '%{http_code}\n' https://v3-cinemeta.strem.io/manifest.json                                    # CONNECT tunnel failed, 403
```

That split is why this document is honest about which half is which, and it is also the single
biggest reason to run the roster in §7 through `tools/e2e/provider-e2e.mjs` on a real machine
before anything here is called done. **An `[unprobed]` row is a lead, not a finding.**

---

## 3. The measured baseline: what the app has today

### 3.1 Indexers — 17, not 7 `[measured]`

AGENTS.md §4 still says "7 built-in public indexers". The registry switch in
`electron/torrent/indexerRegistry.ts` constructs **17**, in three families:

| Family | Adapters |
|---|---|
| Stremio stream addons (`aggregators.ts`) | Torrentio, KnightCrawler, Comet, MediaFusion |
| JSON APIs (`aggregators.ts`, `builtins.ts`) | Knaben, SolidTorrents, Torrents-CSV, apibay (TPB), YTS, EZTV, Nyaa, AnimeTosho, SubsPlease, LimeTorrents |
| HTML scrapers (`scrapers.ts`) | 1337x, BitSearch, TheRARBG |

Plus Torznab (Jackett/Prowlarr), which is a whole ecosystem behind one adapter and is the
reason this list is not the ceiling.

### 3.2 Catalogues, subtitles, metadata `[researched]`

| Surface | What is wired | Where |
|---|---|---|
| Home catalogues | Cinemeta (via a generic Stremio *catalog* adapter), AniList, TMDB (user key only) | `cs3/homeProviders.ts` |
| Search metadata | Cinemeta, TVmaze, AniList | `cinemeta.ts`, `metadataProvider.ts`, `searchSuggestions.ts` |
| Subtitles | OpenSubtitles v3 Stremio addon, one hardcoded base, plus provider-supplied subtitles | `subtitleService.ts:24` |
| Extensions | 29 catalogued `.cs3` repositories, 4 bundled | `electron/official_repositories.json` |

### 3.3 The `.cs3` corpus as it stands `[measured]`

Resolved every catalogued `rawRepoUrl`, followed each `pluginLists`, and counted:

```
node tools/research/survey-repositories.mjs

Catalogue: 29 repositories
TOTAL 614 extensions · 63 publishing jarUrl (10.3%) · 558 distinct names
unreachable: pitipitii (404 at the catalogued URL), fstream (host unreachable from here)
```

Two of those lines are findings rather than statistics:

- **`pitipitii` answers 404 at the URL we ship** `[measured]` — `sarapcanagii/Pitipitii` has no
  `repo.json` on `master`, `main` or `builds`. A catalogued repository that 404s is a row a
  user can click and get nothing from, with the failure attributed to their network.
- **`fstream` is on `git.disroot.org`, which this container cannot reach** `[unprobed]`. It may
  be perfectly alive. It is listed here so nobody deletes it on the strength of this document.

The **10.3% jar coverage** is the number to watch. AGENTS.md records 5/79/67 across three
repositories on 2026-08-28; corpus-wide it is 63 of 614, concentrated almost entirely in
`phisher` (46/80), `saimuelrepo` (10/10) and `recloudstream/extensions` (5/5). The L1 lane is
real and it is still a minority of the corpus — which is the argument in PRD-41 §6.3 for being
the host that *rewards* setting `isCrossPlatform`, restated with a bigger denominator.

---

## 4. Four sources we have already paid for and cannot reach

Each of these was found while counting the roster, not while chasing a bug report. Each is a
source of streams that the app funds — in code, in a bundled binary, or in a bundled
repository — and does not receive.

### 4.1 Every non-torrent Stremio stream is discarded `[researched]`

`electron/torrent/indexers/aggregators.ts`, in `StremioAddonIndexer.search`:

```ts
return (response.streams ?? [])
  .filter((stream): stream is StremioStream => Boolean(stream?.infoHash))
```

A Stremio `stream` object carries **either** `infoHash` (a torrent) **or** `url` (a direct
HTTP link). The filter keeps the first and drops the second silently. What is on the other
side of it:

- **Every debrid answer.** Comet, MediaFusion, Torrentio and Jackettio with a Real-Debrid,
  AllDebrid, Premiumize or TorBox key configured return `url` — an already-cached, full-speed
  HTTP link. That is the single most reliable stream shape in the whole ecosystem and this app
  discards 100% of it. The module header two lines above the filter *anticipates* debrid users
  ("a user who has a working addon URL should be able to paste…"), which makes this a gap
  between intent and code rather than a decision.
- **Every HTTP-only addon.** A large share of catalogue-plus-stream addons never return a
  torrent at all, so to this app they return nothing and read as broken.

It is not a one-line fix, and the reason is structural rather than incidental: `RawTorrent` in
`indexers/base.ts` requires `infoHash` or `magnet`, so the indexer contract itself cannot carry
an HTTP source. That is what §6 is about — a direct link belongs on the **provider** path, not
the indexer path.

### 4.2 yt-dlp is installed, and its 1,800 sites have no caller `[measured]` `[researched]`

`electron/ytdlpEngine.ts` already implements `extractLinks(url)` and `searchAndExtract(query)`,
returning `ExtractorLink[]`. Grepping the whole renderer and main process for either name finds
**only their own definitions** — `downloadService.ts` imports the class and calls `download()`
and nothing else. yt-dlp supports on the order of 1,800 sites `[researched]`, the binary is
already fetched on first use and already resolved by `binaryDownloader`, and none of it is
reachable from any screen.

This is the same shape as the local-file capability recorded in AGENTS.md ("`MediaProxy` could
always serve local files and the engine is source-agnostic — the capability was built and had
no entry point"), and it should be fixed the same way: give it an entry point.

Two defects to fix while wiring it, both of which this codebase has already ruled on elsewhere:

- **It guesses the transport from the URL string** — `fmt.url.includes('.m3u8')`,
  `fmt.url.includes('.mpd')` — while `fmt.protocol` (`m3u8_native`, `http_dash_segments`) sits
  in the same object. AGENTS.md §5 is explicit that nothing is decided from the URL, and
  `cs3/providerLinks.ts` exists precisely because the provider's own answer outranks a guess.
- **`searchAndExtract` falls back to `ytsearch1:<query> official trailer OR full feature`.**
  Handing a viewer a trailer in a list of sources for a film is a synthetic result in all but
  name, and AGENTS.md's rule is unambiguous: when nothing real is found, return an empty list
  **and a reason**. The URL path is the useful half; the search fallback should go.

### 4.3 A bundled repository that cannot contribute anything here `[measured]` `[researched]`

`megarepo` is one of the four `bundled: true` repositories, meaning first launch installs it
before the user touches a setting. Resolving it:

```
https://raw.githubusercontent.com/self-similarity/MegaRepo/builds/repo.json
  → pluginLists → 1 extension, "MegaProvider"
  description: "This plugin adds all repositories each time the app is opened."
```

It is not a catalogue of providers. It is a *bootstrap plugin* whose entire function is to call
the host back and register other repositories — and on this platform that call cannot land:
`sidecar/bridge/.../plugins/PluginManager.kt` supplies `RepositoryManager.getRepositories()`
returning an empty array and `removeRepository` as a documented no-op, with **no
`addRepository` at all**. The no-op is correct and deliberate (the repository list belongs to
the host, which owns install paths, the hash-keyed translation cache and the datastore) — what
is wrong is bundling an extension whose only purpose is the thing we refuse.

So one of four bundled repositories costs a download, a DEX translation and a row in the
extensions tree, and yields zero providers. **The capability it was standing in for is real and
belongs to the host**: importing a community repository list into
`electron/official_repositories.json` is §7.6, and it is a much better version of the same idea
because a user can see, filter and refuse each entry.

### 4.4 Subtitles speak a protocol we implement, to exactly one host `[researched]`

`subtitleService.ts:24` hardcodes `https://opensubtitles-v3.strem.io`. That host is a **Stremio
addon**, and its `/subtitles/{type}/{id}.json` route is the same protocol
`homeProviders.StremioCatalogProvider` already speaks for `/catalog/…` and
`StremioAddonIndexer` already speaks for `/stream/…`. We have written the client twice and
bound the third use to one vendor. Every keyless community subtitle addon — and there are many,
including the language-specific ones that OpenSubtitles covers badly — is one adapter away, and
the adapter is mostly already written twice over.

---

## 5. `.cs3` repositories the catalogue does not list `[measured]`

Found by searching GitHub, then resolving each candidate the way `pluginManager` does (branch ×
filename probing, then following `pluginLists`). Counted on 2026-09-03.

| Repository | Extensions | `jarUrl` | Net new¹ | Languages | Note |
|---|---:|---:|---:|---|---|
| `xr3ed/xr3ed-Repo` | 190 | **47** | **70** | id 106, en 37, hi 28, de, bn, zh, ta, te, fr, ko, fil | Largest single find. The 47 jars are L1-lane — no DEX step. |
| `hexated/cloudstream-extensions-hexated` | 64 | 0 | 27 | id 24, en 16, de 7, hi, tr, ru, vi, th, uk, zh | A long-standing, widely-forked author. |
| `codegeasse1/codegeasse-cloudstream-repos` | 34 | 0 | 26 | unset | **10 NSFW-tagged** — adult gate applies, never bundled. |
| `xr3ed/M3U-…-Repo-for-Cloudstream` | 23 | 0 | 17 | id 20, en, ms, "live" | Live/M3U-shaped. See §7.4 — the dataset is a better source than the wrapper. |
| `ImZaw/cloudstream-extensions-arabic` | 15 | 0 | 7 | ar 15 | Arabic; complements the catalogued `re_3arabi`. |
| `HatsuneMikuUwU/cloudstream-extensions-uwu` | 29 | 1 | 2 | id 29 | Mostly duplicates `indostream`/`hexated`. |
| `byimam2nd/oce` | 8 | 0 | 3 | id 8 | Prefix-renamed forks; low marginal value. |
| `ExtremeBoyGG/nonton-indo` | 16 | 0 | 2 | id 15, en | Same. |
| `arranoust/MiraiExt-CloudStream` | 5 | 0 | **0** | id | Entirely duplicates catalogued extensions. Listed so nobody adds it twice. |
| `ahmadbhaqi/IndoChannel` | 1 | 0 | 1 | id | One provider. |

Reproduce with:

```
node tools/research/survey-repositories.mjs --candidates \
  xr3ed/xr3ed-Repo hexated/cloudstream-extensions-hexated \
  codegeasse1/codegeasse-cloudstream-repos xr3ed/M3U-Playlist-Player-Repo-for-Cloudstream \
  ImZaw/cloudstream-extensions-arabic HatsuneMikuUwU/cloudstream-extensions-uwu \
  byimam2nd/oce ExtremeBoyGG/nonton-indo arranoust/MiraiExt-CloudStream ahmadbhaqi/IndoChannel
```

¹ **Net new** is the count after removing every extension whose normalised name already appears
in the catalogued corpus, applied cumulatively **in the order the candidates are
given**, so the same extension is never credited twice. Reordering the arguments moves a
shared extension from one row to another and leaves the total unchanged — which is why the
total, not the row, is the number to quote. Normalisation strips case, punctuation, a leading `Provider`/`The`
and a trailing `Provider`/`Pack`/`Plugin`/`Backup`/`XR`/`V2`. **It matches on names, not on the
site scraped** — two extensions scraping one site under unrelated names are counted as two, so
treat 155 as an upper bound on distinct *extensions* and not as a claim about distinct *sites*.

**Total: ~155 extensions net new against 558 catalogued distinct names — a 28% increase in the
addressable corpus, from eight repositories.**

Recommended for the catalogue (`verified: true`, `bundled: false`): `xr3ed`, `hexated`,
`arabic`, `IndoChannel`. Recommended behind the adult gate (`adult: true`): `codegeasse`.
Recommended **against**: `MiraiExt` (0 net new), `oce` and `nonton-indo` (2–3 net new each,
against a per-repository cost of an index fetch on every update check).

**None of them may be marked `bundled: true` on the strength of this document.** That flag is a
claim that `tools/e2e/provider-e2e.mjs` has driven the repository end to end, and this container
cannot run that harness — it needs the JVM sidecar *and* live access to the provider hosts, and
has neither.

---

## 6. Where each new kind of source belongs, in our own standards

PRD-41 defines five lanes and one contract: every lane produces `Provider`, `Source`,
`MediaDetail`, and nothing downstream branches on lane. That contract is what makes this
question answerable at all — "add a source" stops being an architecture question and becomes a
choice of lane.

| Lane | What it is | What it costs us | Where the candidates below land |
|---|---|---|---|
| **L0** `.cs3` (DEX) | Upstream's Android archive | Built. Translation, shims, tiers | §5's repositories |
| **L1** cross-platform jar | Upstream's own `isCrossPlatform` output | Built. No translation step | 47 of §5's finds, free |
| **L2** `.csx` native bundle | **Our standard.** JS/TS, sandboxed, capability-declared | Not built — the biggest single item in PRD-41 | Everything in §7.3–§7.6 |
| **L3** Stremio addon URL | A remote HTTP service with a manifest | Half-built: catalog and stream, no meta or subtitles, torrents only | §7.1 |
| **L4** yt-dlp rules | A bundled binary with ~1,800 extractors | 90% built, no entry point (§4.2) | §7.2 |

Two consequences worth stating plainly, because both are load-bearing and both are easy to get
backwards:

- **A direct HTTP link is not an indexer result.** `RawTorrent` requires an infohash or a
  magnet. Debrid answers, HTTP addon streams, live channels, yt-dlp output and a Jellyfin
  library item are all *provider* sources. Trying to route them through the indexer registry
  means widening `RawTorrent` until it is `Source` with a worse name.
- **The enable cascade is the single enforcement point, and every new lane must funnel through
  it.** `PluginManager.enabledProviderNames` is what makes provider/extension/repository/adult
  gating hold across search, scope, discovery, playback and downloads. A lane that registers
  providers anywhere else re-opens the adult gate and the disable switch at once.

---

## 7. The roster

Ordered within each lane by sources-unlocked ÷ cost, not by novelty.

### 7.1 L3 — one generic Stremio addon adapter `[proposed]`

**What it unlocks:** the community addon directory listed **516 addons** as of August 2026
`[researched]`, plus every self-hosted and debrid-configured deployment, plus anything published
after we ship — because the thing supported is the protocol, not the host.

**What is missing, precisely:**

| Resource | State |
|---|---|
| `/catalog/{type}/{id}.json` | Built, home screen only (`StremioCatalogProvider`) |
| `/stream/{type}/{id}.json` | Built, **torrent-only** (§4.1) |
| `/meta/{type}/{id}.json` | Not implemented |
| `/subtitles/{type}/{id}.json` | Not implemented; one host hardcoded instead (§4.4) |

**Proposal:** one `StremioAddon` provider that reads a manifest, declares from `resources` and
`types` what it can answer, and maps each resource onto the existing contract — `catalog` →
discovery rows, `meta` → `MediaDetail`, `stream` → `Source[]` (**both** `infoHash` and `url`),
`subtitles` → the existing subtitle merge. The addon URL is user-supplied, exactly as a Torznab
URL already is, so no host is blessed and none of our defaults change.

**Do not** fold this into the indexer registry to save a week. A Stremio addon that answers
`catalog` and `meta` is not an indexer, and the `RawTorrent` contract is the wall (§6).

### 7.2 L4 — give yt-dlp an entry point `[proposed]`

**What it unlocks:** ~1,800 sites `[researched]`, already installed. In practice: the free
legal ones (network catch-up services, festival and archive sites, public broadcasters,
YouTube-hosted full features), plus any host a provider hands back that our own extractors do
not know.

**Cost:** small — wire `extractLinks` into the provider path, fix the two defects in §4.2, and
bound it (yt-dlp on a cold extractor is seconds, not milliseconds, so it belongs behind the
same per-source scope discipline as everything else).

**The best first caller is not a new screen.** It is the failure path: when every resolved
source is dead, the app already knows the page URL a provider was working from. Handing that one
URL to yt-dlp before showing "no playable sources" costs one process and rescues a class of
title that currently ends in a dead end.

### 7.3 L2 — personal media servers and the local disk `[proposed]`

**Jellyfin, Emby, Plex, and a plain folder or SMB share.** Zero matches for any of those four in
`electron/` and `src/` `[measured]` — the app cannot see a library the user already owns.

This is the clearest "our own standards" case in the document, on four independent grounds:

- **It cannot exist as a `.cs3`.** An Android extension has no route to the desktop's
  filesystem, and this is a source class Android structurally does not have.
- **The plumbing exists.** `MediaProxy` already serves local files behind `/local/<token>`, the
  compatibility engine is source-agnostic, and File → Open and drag-and-drop already route a
  local file through `media:prepare`.
- **It is 100% legal, 100% reliable and needs no scraper.** Every other source in this document
  can 403, expire or die. A NAS does not.
- **Jellyfin and Emby are keyless-by-design** — the user's own server, their own credentials,
  an HTTP API with no third party in the loop.

**Acceptance:** browse the server's libraries as catalogue rows, resolve an item to a
`Source` with the server's own direct-play URL, and let the decision engine treat it like any
other stream. Resume position should write to `libraryStore` on our side rather than syncing —
two-way sync is a much larger commitment and does not need to be in the first version.

### 7.4 L2 — live TV, from an open dataset rather than a scraper `[measured]`

`iptv-org` publishes a keyless JSON API of free-to-air channels. Measured on 2026-09-03:

```
https://raw.githubusercontent.com/iptv-org/api/gh-pages/streams.json    17,046 streams
https://raw.githubusercontent.com/iptv-org/api/gh-pages/channels.json   31,127 channels
```

Every stream record carries `url`, `quality`, and — this is the part that matters here —
`user_agent` and `referrer`, which map one-to-one onto what `MediaProxy` already injects, and
`channels.json` carries `country`, `categories` and an `is_nsfw` flag that the adult gate can
read directly.

That is a large, legal, keyless, *structured* live-TV catalogue, and it is a far better source
than an M3U-wrapper extension (§5 lists one): a dataset can be filtered, searched, deduped and
country-faceted, where a wrapper is one opaque playlist. `TvType.Live` is already handled end to
end — `LiveStreamLoadResponse` was the fix recorded in AGENTS.md §5 — so the missing piece is a
provider, not player work.

**State it honestly in the UI:** these are third-party stream URLs collected by volunteers, a
meaningful share are dead at any moment, and the provider should say so rather than presenting
17,046 rows as 17,046 working channels.

### 7.5 L2 — debrid accounts, once §4.1 is fixed `[proposed]`

Real-Debrid, AllDebrid, Premiumize and TorBox. Zero matches for any of them in the codebase
`[measured]`. This is the largest available improvement to **stream success rate** rather than
to source count: a debrid account converts "a torrent with four seeders" into "a cached HTTP
link at line speed", which is the difference this app's whole retry ladder exists to paper over.

Two routes, and they are not exclusive:

1. **Free, via §4.1.** A user pastes their already-configured Comet/MediaFusion/Torrentio addon
   URL and the `url` streams stop being discarded. This costs us nothing beyond the fix.
2. **Direct**, as an L2 provider with a user-supplied key: unrestrict a link, check cache
   status for a batch of infohashes before we bother the swarm.

Route 1 first, because it is the fix we owe anyway and it validates the demand.

### 7.6 L2 — open and legal catalogues worth writing ourselves `[unprobed]`

Named from research; none reachable from this container, so each needs a liveness pass before it
is committed to.

| Candidate | Why it is worth a provider | Shape |
|---|---|---|
| **Internet Archive** | Enormous public-domain film/TV corpus, keyless JSON search, direct MP4s. Already proven here: `InternetArchiveProvider` is the extension the whole provider chain was first verified against. | Native L2 gives us range-honouring direct links without the `.cs3` round trip |
| **PeerTube / SepiaSearch** | Federated, documented REST API, no key, thousands of instances | Search API + per-instance video API |
| **Odysee / LBRY** | Open API, keyless, large catalogue | JSON API |
| **FAST services** (Pluto TV, Tubi, Plex free, Roku Channel, Crackle) | Free, ad-supported, legal to watch; widely used by open-source IPTV projects | Undocumented but stable JSON endpoints. **ToS-sensitive — see §9** |
| **Kitsu / Jikan (MAL)** | Keyless anime metadata; complements AniList's blind spots | Metadata only, into `metadataProvider` |
| **Simkl** | Keyless-ish catalogue with strong TV coverage | Home catalogue |
| **SubDL, Podnapisi, SubSource, Wizdom** | Subtitle coverage where OpenSubtitles is weakest (non-English, regional) | Mostly reachable as Stremio subtitle addons → free once §7.1 lands |
| **Community repository index** | The host-side version of what `megarepo` cannot do (§4.3) — a periodically refreshed list of `.cs3` repositories, presented for the user to browse and accept | A JSON file we publish and refresh, feeding the Browse tab |

### 7.7 Torrent indexers not yet adapted `[unprobed]`

Lower priority than everything above, because 17 adapters plus Torznab already cover this lane
and the marginal indexer adds duplicate rows rather than new titles. Worth it only where the
*shape* is new:

- **Bitmagnet** — self-hosted DHT crawler with a GraphQL API. New shape: the user's own index,
  no third-party host to 403 us.
- **Jackettio** — Jackett behind the Stremio stream protocol; free once §7.1 lands, no adapter.
- **Tokyo Toshokan** — anime, RSS/HTML, complements Nyaa and AnimeTosho.
- **Torrent-Paradise** — small keyless JSON DHT index.

**Not recommended:** more HTML scrapers of the 1337x/TheRARBG kind. Three are already carried,
each is a mirror list that rots, and every one of them is a maintenance liability with no new
titles behind it.

---

## 8. Priority

Ordered by sources unlocked per unit of work, which puts every "already paid for" item above
every new one.

| # | Item | § | Cost | Unlocks |
|---|---|---|---|---|
| 1 | Stop discarding non-torrent Stremio streams | 4.1 | S | Every debrid answer + every HTTP addon |
| 2 | Give yt-dlp an entry point, fix its two defects | 4.2 | S | ~1,800 sites, already installed |
| 3 | Catalogue `xr3ed`, `hexated`, `arabic`, `IndoChannel`; gate `codegeasse` | 5 | S | ~130 extensions, 47 on the jar lane |
| 4 | Fix `pitipitii`'s dead URL; re-probe `fstream` | 3.3 | XS | Two catalogue rows that currently fail |
| 5 | Generic Stremio addon provider (catalog + meta + stream + subtitles) | 7.1 | M | 500+ addons and everything published after us |
| 6 | Personal media servers + local folders | 7.3 | M | The library the user already owns |
| 7 | iptv-org live TV provider | 7.4 | M | 17,046 measured streams |
| 8 | Replace bundled `megarepo` with a host-side repository index | 4.3, 7.6 | M | A bundled slot that currently yields zero |
| 9 | Direct debrid providers | 7.5 | M | Stream success rate, not source count |
| 10 | Internet Archive / PeerTube / Odysee native providers | 7.6 | M each | Legal, keyless, durable catalogues |

Items 1–4 are the ones to do first and they are all small. That is not a coincidence — it is
what counting produced, and it is the same result the six-missing-classes count produced in
AGENTS.md §5. **Count before building.**

---

## 9. What must not be claimed, and what to be careful with

- **Nothing in §7 has been run.** No candidate host outside GitHub was reachable from the
  container this was written in (§2). Every `[unprobed]` row needs a liveness pass, and every
  repository in §5 needs `tools/e2e/provider-e2e.mjs` before it is bundled.
- **155 is extensions, not sites.** The dedupe matches names; two extensions scraping one site
  under different names count twice (§5, footnote 1).
- **The adult gate is not optional for §5's `codegeasse`** — 10 of its 34 are NSFW-tagged, and
  `PluginManager.enabledProviderNames` is the only place that may enforce it.
- **FAST services are a different legal question from the rest of §7.6.** Watching Pluto TV or
  Tubi is free and lawful; consuming their private endpoints from a third-party client is a
  terms-of-service matter, not a copyright one, and it is a decision to make deliberately rather
  than to slip in beside Internet Archive. It is listed because it was asked for; it is flagged
  because the two are not equivalent.
- **A larger roster makes ranking more important, not less.** `providerAnalytics` /
  `providerRanking` already exist and already refuse to score `empty` as `failure`; doubling
  the provider count without them would make search slower and noisier, not better.
- **Adding sources does not fix a source that is down.** AGENTS.md's account of the vendor
  matrix stands: of 72 non-playing streams, every one was a host refusing or expiring a link.
  Nothing in this document changes that arithmetic — it widens the set of hosts to ask.

---

## 10. Acceptance checks

| Item | Check |
|---|---|
| §4.1 | A Stremio addon returning only `url` streams produces playable rows; a debrid-configured addon URL yields HTTP sources with headers applied through `MediaProxy` |
| §4.2 | A supported page URL with no working provider source produces a playable `Source`; `isDash`/`isM3u8` come from `fmt.protocol`, never the URL; no result is ever a trailer |
| §5 | `provider-e2e.mjs --repo xr3ed --plugins 25` loads, searches and streams; the 47 jar-lane archives take zero `DexTranslator` invocations (`--lane cs3` for the comparison) |
| §7.1 | One addon URL answers catalogue rows, a detail page and sources; a manifest declaring only `subtitles` is offered only for subtitles |
| §7.3 | A Jellyfin library lists, resolves and plays; progress lands in `libraryStore` |
| §7.4 | Country and category facets work; a dead channel reports as a dead host, not as a provider failure |
| all | `enabledProviderNames` gates every new provider — disabling it removes it from search, scope, discovery, playback and downloads |

---

## 11. Sources

- This repository: `electron/torrent/indexerRegistry.ts`, `indexers/{base,aggregators,builtins,scrapers}.ts`, `electron/ytdlpEngine.ts`, `electron/subtitleService.ts`, `electron/cs3/homeProviders.ts`, `electron/official_repositories.json`, `sidecar/bridge/src/main/kotlin/com/lagradost/cloudstream3/plugins/PluginManager.kt`, AGENTS.md §4–§5.
- PRD-41 §6 (five lanes, one contract), §2.9 (the cross-platform jar), PRD-39 §7.
- Live indexes resolved on 2026-09-03 under `raw.githubusercontent.com`, listed in §3.3 and §5.
- `iptv-org/api` `gh-pages` — `streams.json`, `channels.json`, counted 2026-09-03.
- yt-dlp supported-site count and the Stremio community addon directory total: web research, 2026-09-03, `[researched]` and not independently verified from this container.
