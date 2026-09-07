# PRD-45 — The sources worth adding next: measured today, and why the obvious answer is wrong

**Status:** research + proposal. **Nothing in §6–§7 is built.** §3–§5 are counts taken on the
date below, reproducible by the commands beside them.
**Answers:** "which new providers can we integrate today — movies, TV series, documentaries."
**Depends on:** PRD-41 (five lanes, one `Provider`/`Source` contract), PRD-43 (the roster this
re-measures and revises), AGENTS.md §4–§5 (the chain as built).
**Date:** 2026-09-07.

---

## 1. The short answer

The intuitive move is to add more `.cs3` repositories. There are a lot of them, the lanes that
run them (L0 DEX, L1 jar) are already built, and adding one is a row in a JSON file.

**Counting says do the opposite.** Measured today across 32 uncatalogued CloudStream
repositories: 21 have live indexes carrying **1,158 extensions**, of which **19 publish a
cross-platform jar — 1.6%**. The 36 repositories already catalogued run at **12.0%**. So the
uncatalogued long tail is nine-tenths *worse* on the one axis that decides cost, it is heavily
duplicated against what is already installed, and three of its four largest members are
majority-NSFW (`7Escanor/BlackHole` 182/182, `vigarepo2` 190/437, `gameras1010-afk` 116/291).
Adding it buys DEX translation work, adult-gate exposure and a maintenance surface — not titles.

What buys titles is the class of source this app **structurally cannot reach at all**, and the
reason is one gap rather than ten:

> **There is no native searchable provider lane.** `HomeProvider` (`electron/cs3/homeProviders.ts`)
> can supply catalogue *rows* and nothing else — it has no `search`, no `load`, no `loadLinks`.
> Everything that can actually be searched and played is addressed `cs3ext://` and runs through
> `PluginManager` into the JVM. So every source in this document that is not an Android archive
> is currently unreachable, and they are unreachable for the *same* reason.

Close that one gap and six sources land behind it. The first is proven end to end below.

**Recommendation: build `NativeProvider` (§6), then Internet Archive on it (§7.1).** That is one
architectural unit plus one provider, and it ships ~52,000 legally distributable films,
documentaries and classic TV that no extension in the corpus carries.

---

## 2. Evidence markers

| Marker | Means |
|---|---|
| `[measured]` | Run against the live host on 2026-09-07 from this machine. Command or URL given. |
| `[researched]` | Read from a primary source — this repository's code, a published API, upstream. |
| `[proposed]` | A design decision made here. Not built. Arguable. |

Everything in §3–§5 is `[measured]`. Where PRD-43 marked a candidate `[unprobed]`, this document
probes it and says what came back — including the three cases where the answer changed the
recommendation.

---

## 3. What was measured today

### 3.1 The candidates PRD-43 could not reach

PRD-43 §7.6 and §7.7 were written from a container with no egress to these hosts. All of them
were reachable today.

| Candidate | Result `[measured]` | Verdict |
|---|---|---|
| **Internet Archive** | `advancedsearch.php` 200 in 844 ms; `metadata/<id>` 200; range GET **HTTP 206, `video/mp4`, `Content-Range: bytes 0-1048575/3366125`, `ftypmp42`** | **Proven end to end.** §7.1 |
| **PeerTube / SepiaSearch** | 200, keyless. `documentary` 6,641 · `film complet` 19,935 · `full movie` 8,903 videos. 1,781 instances indexed | Live, real catalogue. §7.6 |
| **Odysee / LBRY** | `lighthouse.odysee.tv/search` 200, keyless, returns claims. `api.na-backend` proxy 404 | Search live; resolve path needs work. §7.6 |
| **Simkl** | `api.simkl.com/movies/trending` **200 without a key** | Catalogue-only win. §7.7 |
| **Kitsu** | 200, keyless | Metadata only. §7.7 |
| **Jikan (MAL)** | **504 on both attempts** | Down today. Do not depend on it. |
| **Torrent-Paradise** | 200 — serving a **Hungarian casino site**. Domain is parked | **Dead. Remove from the roster.** |
| **Tokyo Toshokan** | 200, `application/rss+xml`, real results | Live, but see §8 |
| **Real-Debrid / AllDebrid / TorBox / Premiumize** | All 200 and answering (`AllDebrid` `{"ping":"pong"}`, `TorBox` `total_users: 977462`) | APIs live. §7.5 |
| **Pluto TV** | `boot.pluto.tv/v4/start` 200 JSON; `api.pluto.tv/v2/channels` 200 | Reachable — see §9 before building |
| **Roku Channel / Crackle** | 404 / connection refused | Not viable |
| **Plex free** | `discover.provider.plex.tv` **401, token required** | Not keyless |
| **Trakt / TMDB / TVDB** | 403 / 401 / 401 — all key-gated | Excluded, as in `homeProviders.ts` |

### 3.2 iptv-org, re-measured — including a liveness sample PRD-43 never took

```
https://raw.githubusercontent.com/iptv-org/api/gh-pages/streams.json     17,230 streams
https://raw.githubusercontent.com/iptv-org/api/gh-pages/channels.json    31,160 channels
```

PRD-43 §7.4 said "a meaningful share are dead at any moment" and did not count. Counted today,
**random sample of 40 streams**, each fetched with its own declared `user_agent`/`referrer`:

```
alive 28  |  403/451 (geo or hotlink) 3  |  dead or timeout 9      => ~70% answer
```

That is materially better than the document implied, and it changes how the feature should be
presented: a 70%-alive catalogue is a usable product with an honest label, not a warning.

Category counts from `channels.json`: **documentary 510** · movies 1,796 · series 869 · general
7,254 · sports 2,484 · news 2,124. **375 channels are `is_nsfw`-flagged**, which the existing
adult gate can read directly. Only **1,041 of 17,230** streams carry a `user_agent` or
`referrer` — so `MediaProxy` header injection is needed for 6% of them, not all.

### 3.3 The Stremio addon surface

```
https://api.strem.io/addonscollection.json        95 addons  [measured]
  resources: catalog 40 · subtitles 42 · meta 23 · stream 19 · addon_catalog 1
  types:     movie 80 · series 78 · anime 14
```

PRD-43 cited "516 addons" from third-party research. The *official* collection is 95 and is
fetchable as one keyless JSON document — which is the number worth designing against, because it
is the one we can enumerate rather than the one someone counted on a website.

The shape of that table is the argument for §7.2: **42 addons answer `subtitles` and 40 answer
`catalog`, against 19 that answer `stream`.** This app currently consumes `stream` (torrents,
plus direct URLs since PRD-43 item 1) and `catalog` (home screen only). It implements neither
`meta` nor `subtitles`, and `subtitles` is the single most-served resource in the ecosystem while
`subtitleService.ts` hardcodes one host (`ADDON_BASE = 'https://opensubtitles-v3.strem.io'`).

### 3.4 Internet Archive, sized and proven

```
mediatype:movies AND subject:documentary                              49,952
  ... gated: AND format:(MPEG4) AND year:[1900 TO 2026]               15,316
collection:feature_films                                              28,471
  ... gated                                                           12,724
collection:classic_tv (gated)                                          7,661
collection:animationandcartoons (gated)                               11,985
collection:prelinger (gated)                                           7,882
subject:"silent film" (gated)                                          2,009
subject:"film noir" (gated)                                            1,443
```

**~52,000 gated, playable titles** across the rows worth shipping. Every one is legally
distributable, keyless, permanent, and served from range-honouring HTTP that this app's media
proxy and decision engine already handle unchanged.

Two measured findings shape the implementation and would each have been a shipped bug:

**Naive free-text search does not work.** The Solr endpoint ORs terms across all fields and
`sort=downloads desc` then floats whatever is popular:

| Query form | `"apollo 11"` top hit | `"night of the living dead"` top hit |
|---|---|---|
| `AND (apollo 11)` — naive | *Experiments in the Revival of Organisms* (1940) | *Unus Annus* (2019) |
| `AND title:("apollo 11")` | **APOLLO 11 16MM ONBOARD FILM** (1969) | **Night of the Living Dead** (1968) |

The title-phrase form is correct on all five test terms and the naive form is wrong on three of
five. **`title:("<query>")` is the only acceptable search form**, and a sort key is mandatory —
passing an empty `sort[]` returns nothing at all, which reads as "no results" rather than as a
malformed query.

**`format:(MPEG4)` is not an optimisation, it is the quality gate.** Ungated, the top
documentary by downloads is an item literally called *Sample 1* (1.25M downloads, a 3 MB test
clip). Gating on a real video derivative plus a plausible year removes it and every item like it.

**The adult gate must apply here too:** 3,920 items in the gated movies corpus carry an adult
subject, 112 of them inside `subject:documentary`.

---

## 4. The `.cs3` long tail — counted, and mostly not worth taking

Method: GitHub search across five queries (`topic:cloudstream`, `cloudstream-extensions in:name,description,topics`,
and three more) → 127 distinct repositories → 122 not in `official_repositories.json` → resolved
32 of them against the same branch×filename probe `pluginManager` uses.

```
live indexes            21 / 32
extensions behind them  1,158
publishing jarUrl       19  (1.6%)
```

Against the catalogued baseline of **36 repositories / 12.0% jar coverage**, this is the tail
being nine times worse on the axis that decides what an install costs.

| Repository | Ext | Jar | Note |
|---|---|---|---|
| `vigarepo2/Cloudstream-Plugins` | 437 | 2 | **NSFW 190** |
| `gameras1010-afk/Kitsugi-Plugins` | 291 | 6 | **NSFW 116** |
| `7Escanor/BlackHole` | 182 | 1 | **NSFW 182 — wholly adult** |
| `Wiojelt/TurkSinema` | 56 | 0 | See the tvTypes trap below |
| `perfecplay/Brosvod-CS3` | 37 | 0 | Movie 22 / TvSeries 17 |
| `neoser1984/cloudstream-extensions` | 29 | 0 | TvSeries 25 / Movie 19 |
| `GD2021/CDEScript` | 25 | 0 | Anime 15 |
| `brusus/tv` | 18 | 0 | **Documentary 6** — genuinely mixed |
| `MrXtron/CloudStream-Extension` | 17 | **3** | Indian, jar lane |
| `sevouz/cloudstream-extensions-sevouz` | 15 | **3** | Anime, jar lane |

**A declared `tvType` is not evidence.** `Wiojelt/TurkSinema` reports `Documentary:56` across 56
extensions — every extension declaring every type, which is a manifest default rather than a
claim about content. Any future "documentary sources" count taken from `tvTypes` will be inflated
by exactly this pattern. Read it as *permission* to appear under a filter, never as coverage.

**What to take from the tail, if anything:** `MrXtron` and `sevouz` (jar lane, 6 archives between
them, no translation cost) and `brusus/tv` (small, genuinely documentary-weighted). Everything
else fails the bar `official_repositories.json` already sets. The three NSFW-majority repositories
would need `adult: true`, and `officialRepositories.test.mts` already pins that an adult
repository is never `bundled`.

---

## 5. The gap that makes all of this one project

Traced through the code, not assumed:

| Surface | File | Can it search? | Can it resolve a stream? |
|---|---|---|---|
| Extension provider | `pluginManager.ts` → sidecar | yes | yes |
| Torrent indexer | `torrent/indexerRegistry.ts` | yes, but `RawTorrent` requires an infohash *or* a direct URL | torrents + direct (since PRD-43 item 1) |
| Home catalogue provider | `cs3/homeProviders.ts` | **no** — `fetch(HomeCatalogRequest)` only | **no** |
| yt-dlp | `ytdlpEngine.ts` + `ytdlpSources.ts` | no — resolves a known page | yes |

`SearchSession` fans out to exactly three things: `PluginManager`, `IndexerRegistry`, and the two
catalogues (`CinemetaProvider`, `MetadataProvider`). `SearchScope` has exactly two axes —
`providers: string[]` and `indexers: string[]`. **There is no third kind**, so a native source
cannot be searched, cannot be scoped, cannot be enabled or disabled, and cannot be ranked.

PRD-41 calls the missing piece L2 (`.csx`, sandboxed, capability-declared, user-installable) and
scopes it as the largest single item in that document. **This proposal is deliberately not that.**
An in-process, first-party provider interface needs no sandbox, no bundle format, no signing and
no capability model, because the code ships with the app and is reviewed like any other module.
It is the half of L2 that delivers sources, without the half that delivers an ecosystem.

---

## 6. The proposal: `NativeProvider` `[proposed]`

One interface, in `electron/cs3/nativeProviders/`, mirroring the three calls `PluginManager`
already exposes so that `ContentService` branches on address scheme and nothing else changes.

```ts
export interface NativeProvider {
  readonly id: string;              // stable; the scope key and the address authority
  readonly name: string;            // display name; unique across native + extension providers
  readonly types: TvType[];
  readonly adult?: boolean;         // routed through the same gate as an NSFW extension
  readonly requiresConfig?: boolean;// true until the user supplies a key/URL (debrid, Jellyfin)

  capabilities(): NativeCapabilities;                    // search / catalog / resolve
  search(query: string, signal: AbortSignal): Promise<SearchResponse[]>;
  load(handle: string, signal: AbortSignal): Promise<LoadResponse>;
  loadLinks(handle: string, signal: AbortSignal): Promise<ExtractorLink[]>;
  catalog?(request: HomeCatalogRequest): Promise<SearchResponse[]>;  // reuses HomeProvider's shape
}
```

Seven rules, each answering a failure this repository has already had:

1. **Address them `cs3native://<id>/<handle>`.** A distinct scheme, not a reused `cs3ext://`.
   `explainMissingProvider` resolves a missing `cs3ext://` name by consulting the extension
   tables; a native provider is not in them, so sharing the scheme would produce "that extension
   was uninstalled" about a module compiled into the app.

2. **They funnel through `PluginManager.enabledProviderNames`.** PRD-43 §6 states this and it is
   the one rule with no exception: that method is the single enforcement point for the
   provider/extension/repository/adult cascade across search, scope, discovery, playback and
   downloads. A lane that registers providers anywhere else re-opens the adult gate *and* the
   disable switch at once.

3. **`SearchScope` gains a third axis**, `natives: string[]`, resolved with the same strictness as
   the other two — a selection is a filter, an unresolvable one is *reported* via
   `missingNatives`, never silently widened. The widen-back bug is documented in AGENTS.md and
   must not be reintroduced through a new field.

4. **A native provider never returns a `cs3meta://` row.** It returns its own addresses, so
   `sourceScope.ts` binds a merged row back to it exactly as it does for an extension.

5. **`loadLinks` returns `ExtractorLink`, so nothing downstream is new.** `providerLinks.ts`
   already reads type, DRM, playlist parts and audio headers from that shape; the compatibility
   engine, `MediaProxy`, mpv routing and the download identity all work unchanged.

6. **Registration is a table, not a switch statement**, for the same reason `providerRanking`'s
   criteria are rows: a provider added to the roster and forgotten in the enable cascade is
   invisible to `tsc` and looks exactly like a working feature.

7. **`componentReachability.test.mts` and `ipcSurface.test.mts` both apply.** Three times now this
   repository has shipped a feature that was built and unreachable — a channel invoked and never
   registered, one registered and never invoked, a component built and never mounted. A native
   provider registered in no roster is the fourth shape of that bug.

**Cost:** the interface, the registry, the scope axis, the `ContentService` branch, and the
extensions-screen rows that show them. Roughly the size of `homeProviderRegistry.ts` plus the
scope change — days, not weeks, and paid once for every provider in §7.

---

## 7. The roster, specified

### 7.1 Internet Archive — build this first `[measured]`

**~52,000 gated titles (§3.4), keyless, legal, permanent, range-honouring.** The only candidate
whose full chain — search → metadata → 206 with `ftypmp42` — was verified today.

It is also the natural first native provider on independent grounds: `InternetArchiveProvider` is
the extension the whole provider chain was first proven against (AGENTS.md §5), so the *content*
is known-good and only the lane is new. And it is the one source in this document that answers
"documentary" as a first-class category rather than incidentally.

| Call | Implementation |
|---|---|
| `search` | `advancedsearch.php?q=mediatype:(movies) AND format:(MPEG4) AND title:("<q>")&sort[]=downloads desc` — **the phrase form, always** (§3.4) |
| `catalog` | One row per collection: Documentaries, Feature films, Classic TV, Animation, Prelinger, Silent, Film noir. Sizes in §3.4 |
| `load` | `archive.org/metadata/<identifier>` — title, year, description, subjects, `__ia_thumb.jpg` |
| `loadLinks` | Video derivatives from `files[]`, ranked `h.264` > `MPEG4` > `512Kb MPEG4`; URL `archive.org/download/<id>/<name>` |

Rules that came out of measuring rather than from design:

- **`format:(MPEG4)` is mandatory**, or the top documentary by downloads is a 3 MB clip called
  *Sample 1*.
- **A sort key is mandatory.** An empty `sort[]` returns nothing, which is indistinguishable from
  no matches.
- **`is_dark` items are skipped.** They resolve and 403.
- **The adult gate applies** — 3,920 gated items carry an adult subject (§3.4).
- **Multi-file items are episodes, not sources.** A `classic_tv` identifier routinely holds a
  whole season; each video file is an `Episode`, or the season collapses into one row that plays
  whichever file sorted first.
- **`Accept-Ranges` is absent while `Content-Range` is present** `[measured]` — the middle row of
  the three host shapes in AGENTS.md. `MediaProxy` already *states* `Accept-Ranges` rather than
  forwarding it, so seeking works; do not add a special case.

### 7.2 The generic Stremio addon provider `[measured]`

Second, because it is the only item that keeps paying after we ship: what is supported is the
protocol, so every addon published later works with no adapter.

Against §3.3's table, the gap is precise — `meta` (23 addons) and `subtitles` (**42 addons**,
the most-served resource in the ecosystem, against one hardcoded host here). `catalog` exists but
is confined to the home screen; `stream` exists in the indexer registry, where a `RawTorrent`
that answers `catalog` and `meta` does not belong (PRD-43 §6).

One `StremioAddon` native provider reads a manifest, declares from `resources` and `types` what it
can answer, and maps each resource onto the existing contract. The URL is user-supplied, exactly
as a Torznab URL already is, so no host is blessed and no default changes.

**Do not fold it into the indexer registry to save a week.** `RawTorrent` is the wall, and
widening it until it is `Source` with a worse name is how that shortcut ends.

### 7.3 iptv-org live TV `[measured]`

17,230 streams / 31,160 channels, **~70% alive** (§3.2), 510 documentary channels, 375 NSFW flags
that map straight onto the adult gate, and `user_agent`/`referrer` on 1,041 streams that map
one-to-one onto what `MediaProxy` already injects.

`TvType.Live` and `LiveStreamLoadResponse` are already handled end to end (AGENTS.md §5), so the
missing piece is a provider, not player work. Ship it faceted by country and category — a dataset
that can be filtered is the whole advantage over the M3U-wrapper extension the catalogue already
carries. **State the 70% on screen**; a channel list that silently contains dead rows is the
failure this codebase keeps fixing, and 70% measured is a fine number to admit to.

### 7.4 Personal media servers and local folders `[researched]`

Jellyfin, Emby, Plex, and a plain folder or SMB share. Zero matches for any of the four in
`electron/` and `src/`.

Still the strongest *product* case in either document, and unchanged from PRD-43 §7.3: it cannot
exist as a `.cs3` at all, `MediaProxy` already serves local files behind `/local/<token>`, it is
100% legal and 100% reliable, and Jellyfin/Emby are keyless-by-design because the server is the
user's own. It sits below §7.1–§7.3 here only because it serves the library a user already has
rather than adding titles — which is a judgement about *this* request ("which new providers"),
not a demotion.

### 7.5 Debrid `[measured]`

All four APIs answer (§3.1). This is the largest available improvement to **stream success rate**
rather than to source count — a debrid account converts "a torrent with four seeders" into "a
cached HTTP link at line speed", which is what the whole retry ladder exists to paper over.

Route 1 (free) already landed with PRD-43 item 1: a user pastes their configured
Comet/MediaFusion/Torrentio URL and the `url` streams are no longer discarded. Route 2 is a native
provider with a user-supplied key — unrestrict a link, and check cache status for a batch of
infohashes *before* bothering the swarm. Do Route 2 after §7.1–§7.3; it needs an account to test
with, which is the thing this research cannot supply.

### 7.6 PeerTube and Odysee `[measured]`

Both live and keyless. PeerTube via SepiaSearch is the better of the two — a documented REST API,
1,781 instances, and 6,641 hits for `documentary` alone. Odysee's search endpoint answers but its
resolve path (`api.na-backend`) 404s on the form tried today, so it needs a session of its own
before it is committed to.

Neither is a movies-and-TV catalogue; both are creator-video platforms with a documentary and
conference-talk seam. Worth a provider each **after** the roster above, and worth stating on
screen for what they are rather than filing under Movies.

### 7.7 Catalogue-only, and nearly free `[measured]`

These need no native provider at all — they are `HomeProvider` implementations, which already
exist:

- **Simkl** answers `movies/trending` **without a key** (§3.1). Strong TV coverage, and the
  home-screen registry is built for exactly this.
- **TMDB via the keyless community addon host** (`tmdb.elfhosted.com`, 200, `catalog`+`meta`,
  12 catalogs) — the TMDB catalogue with no key embedded in our client, which is the objection
  `homeProviders.ts` raised against TMDB in the first place.
- **Kitsu** (200, keyless) into `metadataProvider`, complementing AniList's blind spots.

**Not Jikan** — 504 on both attempts today. It may recover; it should not be depended on.

---

## 8. What not to build, and why

- **The `.cs3` long tail.** §4. 1.6% jar coverage, heavy NSFW, duplicated scrapers. Take
  `MrXtron`, `sevouz`, `brusus/tv` and leave the rest.
- **Torrent-Paradise.** The domain is parked and serving a casino site `[measured]`. PRD-43 §7.7
  lists it as a candidate; **it should be struck from that list**, not merely deprioritised.
- **More HTML scrapers of the 1337x/TheRARBG kind.** Unchanged from PRD-43: three are carried,
  each is a rotting mirror list, and none brings new titles.
- **Tokyo Toshokan**, despite being live. Nyaa, AnimeTosho and SubsPlease already cover anime;
  this is a duplicate-row generator, and §4's argument applies to indexers too.
- **Plex free / Roku / Crackle.** 401, 404 and connection-refused respectively `[measured]`.
- **Pluto TV and Tubi.** Both reachable `[measured]`, both undocumented private APIs of an
  ad-supported service, and taking the stream while dropping the ads is the part their terms are
  about. iptv-org gives a legal, structured, larger live-TV catalogue with none of that exposure
  (§7.3). If it is ever revisited, it is a deliberate decision with the terms read, not a
  by-product of this document.
- **Anything key-gated.** Trakt, TMDB direct, TVDB, OMDb, Fanart — all confirmed key-gated today,
  and `homeProviders.ts` already settled the argument: a key embedded in a distributed client is
  both a licence violation and a key that gets revoked.

---

## 9. Legal and honesty

Everything recommended in §7.1–§7.4 and §7.7 is **legally distributable content or the user's own
infrastructure**: Internet Archive is public-domain and openly licensed, iptv-org is free-to-air,
PeerTube and Odysee are creator-published, Jellyfin/Plex is the user's own library, and the
catalogue services are metadata. That is a deliberate property of this roster, not a coincidence —
it is what makes these sources *durable* where a scraper is not.

Two things to keep honest in the UI, both of which this codebase has been bitten by before:

- **iptv-org's 70% must be stated**, not discovered. See §7.3.
- **A catalogue row is not a playable row.** `ottCatalog.ts` already establishes the rule and the
  reason: a grid of posters that silently cannot play is the failure this codebase keeps having to
  fix, and `origin` is what the view labels it from. Any native provider that answers `catalog`
  without `loadLinks` inherits that obligation.

GPL-3.0 applies to everything added here, as everywhere in this repository.

---

## 10. Priority

Ordered by titles unlocked ÷ cost, with the shared cost paid once at the top.

| # | Item | § | Cost | Unlocks |
|---|---|---|---|---|
| 0 | **`NativeProvider` interface, registry, scope axis, enable cascade** | 6 | M | The lane every item below needs |
| 1 | **Internet Archive provider** | 7.1 | S *after 0* | ~52,000 legal films / documentaries / classic TV |
| 2 | **Generic Stremio addon provider** (`meta` + `subtitles` + user-supplied URL) | 7.2 | M | 95 enumerable addons — incl. 42 subtitle sources against our 1 |
| 3 | **iptv-org live TV** | 7.3 | M | 17,230 streams, ~70% alive, 510 documentary channels |
| 4 | **Simkl + keyless TMDB addon + Kitsu** (`HomeProvider` only) | 7.7 | XS | Catalogue breadth, no new lane needed |
| 5 | **Jellyfin / Emby / Plex / local folders** | 7.4 | M | The library the user already owns |
| 6 | **Debrid, direct** | 7.5 | M | Stream success rate, not source count |
| 7 | **PeerTube; then Odysee** | 7.6 | M each | Documentary and talk corpus |
| 8 | **Three jar-lane repositories** (`MrXtron`, `sevouz`, `brusus/tv`) | 4 | XS | ~50 extensions, 6 translation-free |

Item 4 is XS and independent of item 0 — it can ship at any time, including first.

**Milestone M0 = items 0 + 1.** That is the unit worth building before anything else is committed
to: it proves the lane against a source whose chain is already measured, and if the interface is
wrong, it is wrong once and cheaply.

---

## 11. Acceptance

For M0, and the same shape for each provider after it:

1. `bun run test:electron` green, including a new pure suite for the native registry and the
   scope axis — **verified by mutation**, per this repository's standing rule that a parity test
   which passes trivially is worthless.
2. `tsc -b` clean and `bunx oxlint` clean.
3. `componentReachability.test.mts` passes with the new provider rows mounted — no orphan.
4. `ipcSurface.test.mts` passes: any new channel registered *and* invoked.
5. **A native provider disabled in the extensions screen returns nothing from search**, proving
   it funnels through `enabledProviderNames` rather than around it.
6. **A scoped search naming only the native provider asks only it**, and an unresolvable native
   selection is reported through `missingNatives` rather than widened.
7. For Internet Archive specifically: search `night of the living dead` returns the 1968 film in
   the top three; opening it resolves to a `video/mp4` that answers HTTP 206; the adult gate
   suppresses adult-subject items when off.
8. AGENTS.md updated in the same commit — the IPC surface, the new module table rows, and the
   native lane's rules.

---

## 12. One thing to settle before implementation

The working tree is **mid-merge** (`MERGE_HEAD` = `9e529d3`, "Merge branch
`claude/cloudstream-android-providers-f5nzq6`"). `AGENTS.md`, `cs3_windows/electron/contentService.ts`
and `cs3_windows/package.json` are staged `UU` but contain **zero conflict markers** — the
resolutions are already in the working tree and simply have not been `git add`ed. That merge
should be completed and committed before any of this lands on top of it.

---

## 13. Sources

- This repository: `electron/cs3/homeProviders.ts`, `homeProviderRegistry.ts`, `ottCatalog.ts`,
  `searchSession.ts`, `searchScope.ts`, `contentService.ts`, `pluginManager.ts`,
  `torrent/indexerRegistry.ts`, `torrent/indexers/aggregators.ts`, `ytdlpSources.ts`,
  `subtitleService.ts`, `official_repositories.json`; AGENTS.md §4–§5.
- PRD-41 §6 (five lanes, one contract), PRD-43 §4–§9 (the roster this revises).
- Live probes, 2026-09-07, from the development machine: `archive.org/advancedsearch.php` and
  `/metadata/`, `raw.githubusercontent.com/iptv-org/api/gh-pages/`, `api.strem.io/addonscollection.json`,
  `sepiasearch.org/api/v1`, `instances.joinpeertube.org/api/v1`, `lighthouse.odysee.tv`,
  `api.simkl.com`, `kitsu.io/api/edge`, `api.jikan.moe/v4`, the four debrid APIs, and
  `api.github.com/search/repositories`.
- Repository index resolution replicates `pluginManager`'s branch×filename probe
  (`master|main|builds|repo|gh-pages` × `repo.json|plugins.json|repo|index.json`).
