# Search, scope, ranking and source discovery — field notes

Dated post-mortems and measurements moved verbatim out of `AGENTS.md` (nothing rewritten). The distilled rules are in `AGENTS.md` §7–8 and `docs/agents/torrents-and-search.md`; read this file when you need the *why* — the measurement behind a number or the failure a rule prevents. Section numbers and cross-references (§5.1, §6.9 …) are unchanged.

## Contents

- Ranking on the maintainer's own status (2026-08-31)
- Results that resolve to nothing are held back (2026-08-31)
- The search box answers before the network does (2026-09-17)
- Source discovery asks the originating provider first (2026-08-22)
- …and widens itself when that provider has nothing (2026-09-02)
- Search scope: selecting a source is a filter, not a preference
- Sources are found while the page is being read
- Search scope: why it looked empty until you searched
- Provider ranking: measured, arguable, and never silently punitive
- Two lanes that were already paid for (2026-09-03)
- The source cache learns from playback

---

### Ranking on the maintainer's own status (2026-08-31)

On a fresh install every ranking criterion returns `null`, every provider scores
the neutral midpoint, and the order is whatever the map iterated — which is
exactly when a new user forms their opinion of the app.

There is evidence available; it is just not ours. Every CloudStream repository
index carries a per-plugin `status` — 0 down, 1 ok, 2 slow, 3 beta — set by
whoever maintains the scraper. It has been parsed into `SitePlugin.status` all
along and read by nothing.

Quoting it is defensible in a way a hand-written table of "good providers" would
not be: it is the author's own claim about their own extension, it updates when
they update it, and it needs no judgement from us about third-party code. It is
weighted **0.4** and `minSamples` **0** — a declaration is not a sample, and
requiring three would exclude the criterion from every provider forever — and it
loses to the counters the moment those have anything to say. A provider the
maintainer calls healthy that has failed nine of ten searches here must rank
below one marked beta that works.

`ProviderRanking.setContext` supplies it after construction, because
`PluginManager` and the ranking are both built in `main.ts` and each would
otherwise need the other first. A ranking with no context is still correct: the
criterion returns `null` and is excluded from the denominator, exactly as it is
for a repository that publishes no status.

### Results that resolve to nothing are held back (2026-08-31)

`TitleOutcomeStore` already recorded what happened last time a title was opened,
and `PosterCard` already badged it — which stops someone clicking the *same*
dead row twice and does nothing about a page full of them. `src/utils/deadRows.ts`
holds those rows back, and the interesting part is the exclusion:

**`app-error` is never hidden.** It means *our* runtime or transport failed, and
filtering on it would turn one bug of ours into a catalogue that silently
shrinks — reported as "the providers stopped working", by someone with no way to
see that a hundred titles were removed on our own account. This repository has
already had one translation bug come to look like a hundred broken providers.

Two more rules keep the cure from being worse. **The whole page is never
hidden**: a query where everything has failed before is exactly when the list is
needed, to try one anyway or to recognise the title is the problem. And **the
count is stated with the rows one click away**, because a results page quietly
shorter than the search found is indistinguishable from a search that found
less — the same complaint, from the other direction.

### The search box answers before the network does (2026-09-17)

Reported as: autocomplete is too slow. Measured against the live endpoints
rather than reasoned about, in milliseconds:

| query | fan-out | the awaited enrich after it |
|---|---|---|
| `sp` | 935 | 388 |
| `spi` | 437 | 187 |
| `spider` | 290 | 52 |
| `spidrman` | 696 | 315 |

Plus a 250 ms renderer debounce, so the first row appeared **0.6–1.6 s** after
the viewer stopped typing. Three faults, and the fan-out was the smallest:

1. **The enrich was awaited.** Genre and plot on rows that were already correct,
   already ordered and already carried a poster — holding back the whole list.
2. **The fastest two sources waited for the slowest.** TVmaze answers in ~170 ms
   and Cinemeta's movie catalogue in up to 935; `Promise.allSettled` paid the
   935 every time.
3. **Nothing was reused between keystrokes.** `spider` and `spiderm` share every
   answer worth showing, and the second started from nothing.

Measured after, typing `spider man` one character at a time: from the fourth
character on, **every keystroke has rows in 0 ms** (`instant()`, synchronous, no
I/O), and the network's first rows land at 36–430 ms. Debounce is 110 ms.

Rules:

- **`instant()` is synchronous and must stay so.** An `async` signature invites
  a caller to await it beside the network call, which is how the latency it
  removes got there. Exact cache hit, else longest cached *prefix* re-filtered,
  else nothing — and a prefix answer is **never** `done`.
- **One `AbortController` in `main.ts`.** A search box has one current query; a
  new keystroke aborts the previous fan-out. Nine live scrapes against three
  third-party hosts is what a typed title costs without it.
- **A single character asks Cinemeta only.** It identifies nothing, so three
  fan-outs per keystroke buy an unrankable list at triple the cost.
- **`SOURCE_PRECEDENCE` is identity, not decoration.** Sources now publish as
  they land, so `found` accumulates in *arrival* order; the merge keeps the
  first candidate's title and URL, and that URL travels as `ExactMedia.url`.
  Without a fixed order the same query names the same work differently between
  runs — measured on *One Piece*, which Cinemeta spells `One Piece` and TVmaze
  spells `One Piece!`.
- **A prefix match is not charged for the untyped remainder.** Bigram overlap
  scores `dune` against `Dune: Part Two` at 0.50 and against `Dune Drifter` at
  0.67 — purely a length difference — and with the word-count penalty on top,
  an obscure 2020 film outranked the film the query obviously meant while
  Cinemeta had ranked the franchise 0, 1, 2 in the reply. Prefix matches floor
  the similarity and skip the penalty, and `rankBonus` (the row's position in
  its own catalogue) breaks the tie. Verified: `dune` now surfaces Part Two,
  Part One and Part Three in that order, and `dune part two`, `breaking bad`,
  `the office`, `inception`, `naruto` and `avatar` are unchanged.
- **Matching is against every name a row answers to** — title, native title and
  synonyms — and against the *collapsed* spelling, so `spiderman` matches
  `Spider-Man`. Verified live: `spiderman`, `spidrman`, `Spider Man`,
  `shingeki` (→ Attack on Titan), `brakin bad` and `atack on titn` all resolve.

`electron/searchSuggestions.test.mts` (18 cases) pins it, mutation-verified:
restoring the awaited enrich, the batched publish, the full single-character
fan-out, the prefix cache, the source precedence and the prefix scoring each
fail a test. The two ordering tests use a **gated** stub rather than a timer —
a timing test for a latency fix passes on the machine that wrote it.

### Source discovery asks the originating provider first (2026-08-22)

The recurring report is "some of the sources didn't work". The cause was not the
sources; it was how many were being asked.

**Android returns one search row per provider.** Opening a row binds you to the
provider that produced it, and pressing play calls `loadLinks` on that provider
alone. There is no fan-out and no torrent-indexer step at all.

This app merges search rows, and that merge is right — four providers and three
catalogues returning one film should be one row, not seven. What it lost was the
binding. `searchMerge.primacy()` makes the *catalogue* row win, so the merged row
is addressed by its `cs3meta://` URL, and `runDiscovery` took that as licence to
ask **every enabled provider and every enabled indexer**. A title carried by two
providers drew answers from two hundred sources: most had nothing, some were
slow, some were dead, and all of them appeared in the list as sources that did
not work.

`cs3/sourceScope.ts` restores the binding without undoing the merge. The
providers whose rows were merged are already recorded as `alternates`, and
`ContentService.alternateRoutes` already remembered them — they were simply being
used as *one more* input to a full fan-out rather than as the scope.

| Scope | Who is asked |
|---|---|
| `origin` (default) | Only the providers whose search results produced this row. No indexers. |
| `all` (explicit) | Every enabled provider and every enabled indexer. |

Four things are worth keeping straight:

- **A `cs3ext://` row was always right.** It is a provider's own result and has
  always resolved from that provider alone. The divergence only ever existed on
  the merged catalogue row.
- **`origin` widens on its own when there is nothing to scope to.** A title
  opened from the home screen was never searched for, so no provider claimed it.
  Narrowing to an empty set there would return zero sources for every catalogue
  item in the app, so it widens and reports `scopeUsed: 'all'` — which is what
  stops the UI offering to widen a search that already did.
- **Widening asks every provider even when routes are known.** The old condition
  skipped the provider search whenever routes existed, which was correct while
  routes were the only way to reach a provider. Under widening it makes "search
  all sources" re-ask the same two providers and appear to do nothing. Already-
  known providers are skipped per result instead, and the merged list is deduped
  on `infoHash`.
- **The scope is part of the cache key and the in-flight key.** Without that a
  widened run is answered by the scoped result that just landed.

The offer appears in two places and only when `canWiden` is true: the source
panel, and the failure overlay — which is where it matters, because the sentence
above it has just said the providers this title came from had nothing.

### …and widens itself when that provider has nothing (2026-09-02)

The section above got the scope right and left one case reading as a dead end.
Reported verbatim from a user's screen:

```
No playable sources found
HDO has no sources for this item.
Try "Find more sources" to ask the other enabled providers.
provider  HDO
address   cs3ext://HDO/{"imdbID":"tt1754656",…,"movieName":"The Little Prince"}
took      1398 ms
```

**Pressing that button found 137 sources** — five extensions (CineStream,
Moviesmod, MovieBoxProviderIN, MovieLinkBDProvider) plus The Pirate Bay and
Torrents-CSV — of which **81 of the 98 distinct HTTP links were still live when
probed** (206 or 200, mostly `video/x-matroska`). So the screen was a dead end
whose only useful action was a step the app was perfectly able to take itself.

`shouldEscalateScope` in `cs3/sourceScope.ts` is that step, and the argument for
it is narrow: `origin` scope is right *while it is paying for itself*. Its whole
value — fewer third-party sites contacted, a faster answer, no dead links from
providers that never carried the title — is a **saving on an answer nobody can
play** the moment it returns zero. So it stays narrow when it finds something and
widens when it does not.

`ContentService.escalateToAllSources` runs it, and five things about it are
load-bearing:

- **It goes through `getSources`, not `discover`.** The widened run then lands in
  the shared in-flight map under its own key, so a viewer pressing "Find more
  sources" while it runs *joins* it rather than starting a second fan-out across
  two hundred sites, and its answer lands in the `#all` cache entry so reopening
  the title is instant.
- **Two guards against recursion**, not one: `canWiden` is already false at `all`
  scope, and the nested call passes `autoWiden: false` anyway. A missing guard
  here does not produce one extra request, it produces unbounded fan-out across
  the whole provider corpus. `sourceScope.test.mts` pins each guard *in
  isolation* — the first draft asserted the scope guard only alongside
  `canWiden: false`, so removing it failed nothing.
- **A failed escalation leaves the narrow answer standing.** `fallback` is a
  thunk producing exactly what the scoped pass would have returned. Letting the
  widened run throw would replace "HDO has no sources for this item" with
  whatever the fan-out hit — and for a **links-handle** address that is
  `loadMedia`'s refusal, a sentence about a call the viewer never made. Same
  rule as the `dataUrl` retry in `extensionSources`: a rescue that makes the
  original failure worse is not one worth having.
- **The fan-out's `load(base)` is now allowed to fail when a title is already
  known.** Escalation is addressed by whatever the viewer was on, which is
  routinely a provider's links blob, and `loadMedia` refuses those by design.
  The detail is enrichment at that point; only the title is required. It still
  throws when there is no `titleOverride`, because then it is not enrichment.
  The `cs3ext://` path also refuses to escalate a links handle with no title —
  the fan-out would have nothing to search for.
- **The prefetcher passes `autoWiden: false`, and it is the only caller that
  does.** Opening a detail page is not a commitment to watch — the same reason
  that module waits `SETTLE_MS`, declines on a cache hit and runs one at a time.
  The flag defaults **on** rather than off so the six real call sites do not each
  have to opt in; the one that got forgotten would be a dead end nobody could
  see. It is part of `sourceKey`, or a prefetch that settled for the narrow empty
  answer would be joined by the play that wanted the wide one.

**The wait is explained while it happens.** `SearchProgress.widened` is stamped
on *every* event the widened run emits, not just the handover — the fan-out
builds its own progress objects, so a one-shot flag appears for a frame and is
overwritten by the next indexer answering. `PlaybackSnapshot.widened` latches it,
and the overlay, the player's source panel and the detail picker each say "no
sources where this title was found — asking every provider and indexer". Without
it the wait silently triples, which is the shape of a hang.

Afterwards `canWiden` is false, so nothing offers a button that would do nothing,
and `explainEmptyResult` takes an `escalated` flag whose only effect is to stop
the generic tail advising a step that has already been taken.

### Search scope: selecting a source is a filter, not a preference

`searchScope.ts` used to widen back to *every* source whenever the stored selection matched
nothing currently installed (`kept.length > 0 ? kept : candidates`). Combined with a picker
that could offer a name no provider actually had — it synthesised a fake provider named
after the extension whenever an extension registered none — the result was the worst
possible failure: the user picks one site, the button reads "1 source", and the app queries
all two hundred. Resolution is strict now, and an unresolvable selection is *reported*
(`missingProviders` / `missingIndexers`) rather than quietly ignored.

The rules, all enforced in `SearchSession.plan()`:

- **Nothing selected** → global: every enabled provider, plus the metadata catalogues.
- **Providers selected** → exactly those, and **no catalogues**. Catalogue rows in a scoped
  search would reintroduce the sources the user just excluded under a different name.
- **Indexers selected** → those indexers are title-searched. They normally answer at
  source-discovery time, so before this a scope of "just this torrent site" had nothing to
  ask and returned a blank page.

The hierarchy is **exactly three levels: repository → extension → provider**, and the
provider is the selectable leaf. There is no fourth entity in the CloudStream model. What
looked like duplication in the picker — `Fivemovierulz > Fivemovierulz` — was the ordinary
case of an archive registering one provider named after itself, rendered at two levels;
`SearchScopePicker` collapses that pair into one row. A provider name is globally unique by
construction (`PluginManager.providers` is a `Map` keyed by name), which is why the name is
also the scope identity, the `cs3ext://` address and the enable/disable key. Two extensions
claiming one name is a genuine collision: the first keeps it and the loser is reported via
`unavailableReason` instead of silently showing zero providers.

### Sources are found while the page is being read

Pressing Play used to begin a fifteen-provider scrape from cold. Meanwhile the viewer had
been on the detail page for several seconds reading the plot — the exact window the work
could have run in. `cs3/sourcePrefetcher.ts` uses it: a moment after a detail page settles,
it runs the same discovery Play would, and the results land in `SourceCache` where Play
finds them.

**The in-flight sharing is what makes this safe rather than harmful**, and it is the reason
`sharedDiscovery.ts` exists as its own module. Warming the cache only helps if pressing Play
a second later *joins* the running discovery; without that it would start a second identical
scrape beside the first, doubling the load on every community site involved and arriving no
sooner. Two rules in there are load-bearing:

- **Cancellation is by consensus.** Each caller brings its own `AbortSignal` and the work
  stops only when *every* caller has withdrawn. Otherwise closing the detail page — which
  happens immediately after Play — would cancel the discovery the player just joined.
- **An aborted run is never joined.** It stays in the map until its promise settles, and
  handing it to a new caller would return a cancelled result.

Both are covered by `sharedDiscovery.test.mts`, along with late-joiner progress replay and
the refresh rule (a cache-bypassing caller may not be served by a run that might have
answered from cache; the reverse is fine).

The prefetch itself is deliberately restrained, because opening a detail page is not a
commitment to watch and speculative traffic is the fastest way to get an IP blocked by a
scraper target:

- nothing runs until the page has been open ~1.2s, so paging through six titles fires zero
  scrapes rather than six;
- nothing runs when `hasFreshSources` says the cache can already answer — a `peek`, so the
  check neither writes nor promotes the entry;
- one at a time, a new target superseding the old;
- and it can be switched off, with the cost stated, for metered connections.

The detail page shows the state on the artwork ("3 sources ready", "Finding sources…"),
because invisible work is indistinguishable from no work — nobody expects Play to be instant
unless something says so. `waiting` and `idle` deliberately render nothing: announcing the
settle delay would put a badge on every title someone merely glanced at.

Reuse and expiry are `SourceCache`'s existing behaviour, not a second policy: magnets never
expire, provider links carry the deadline in their URL or a short TTL, and a partially stale
entry serves its good half.

### Search scope: why it looked empty until you searched

The picker only fetched when the menu opened, and that fetch loaded **every installed
extension into the sidecar first** — minutes of DEX translation on a bootstrapped install,
with nothing on screen saying so. Users opened it, saw nothing, closed it, ran a search, and
found it populated afterwards. Searching appeared to be the fix because it awaited the very
same load.

Two calls now, and the split is the fix: `getSearchScopeOptions(false)` on mount answers
instantly from whatever is already registered, and `getSearchScopeOptions(true)` on open pays
the cost with a menu on screen to show progress in. `PluginManager` emits
`extension:providerLoadProgress` per archive, so the tree fills in as the pass runs instead of
appearing all at once at the end.

The picker also gained facets — content type, language, and extensions-vs-torrents — derived
from what is installed, counted rather than listed, with **OR within a facet and AND across
facets**. Same rule as the extensions screen; anything else reads as broken.

### Provider ranking: measured, arguable, and never silently punitive

`providerAnalytics` counts, `providerRanking` scores, `providerRecommendations` advises. Four
rules keep it honest:

1. **`empty` is not `failure`.** An anime provider with nothing for *Dune* is behaving
   correctly. Merging them would rank by catalogue breadth and bury every specialist.
2. **Smoothing toward a neutral prior**, or the ranking is self-fulfilling: a provider that
   answered its single search scores 100%, sorts above one with 95% over four hundred calls,
   gets asked first, and stays there.
3. **A criterion with no data is excluded from the denominator**, never scored zero.
4. **Nothing is ever auto-disabled.** Auto-*enable* is opt-in and gated on score *and* sample
   count; a site being down for a week is not consent to remove a source the user picked.

The settings panel shows every number, every criterion's sample count, and the erase button,
because a system that reorders results on evidence nobody can see is one users learn to
distrust the first time it is wrong — and with hundreds of third-party scrapers it will
sometimes be wrong.

### Two lanes that were already paid for (2026-09-03)

Found by counting the roster for PRD-43 rather than from a bug report. Neither was a missing
feature; both were built, funded and unreachable.

**Every non-torrent Stremio stream was being discarded.** `StremioAddonIndexer.search` filtered
its replies to the ones carrying an `infoHash`. A Stremio `stream` carries **either** `infoHash`
**or** `url`, and the `url` half is what every debrid-fronted addon answers with — an
already-cached link at line speed, the most reliable source shape in that ecosystem — plus
everything an HTTP-only addon returns. There was no error and no diagnosis: the addon simply
"found nothing".

The wall was the adapter contract, not the idea. `TorrentResult` has carried `directUrl` since
extension providers started returning HTTP links; `RawTorrent` had nowhere to put one, so
`finaliseResult` returned null. It now has a direct half, finished **before** any of the magnet
derivation — there is no swarm, no piece order and no infohash to validate.

Three rules in it are load-bearing:

- **The identity is `directSourceIdentity`, shared with `ContentService.extensionSources`.** Same
  function, same `ext-` prefix, so an addon and an extension that resolve a title to the same
  file host collapse into one row in `dedupeByInfoHash`. Two schemes would show the viewer one
  stream twice and call it two sources.
- **`seeders: 1`, and no attempt to do better.** Swarm health is meaningless for an HTTP stream,
  and `minSeeders` (1 by default) would hard-reject every direct source in `rankResults`. It
  understates a cached debrid link, which is deliberate: the provider path has ranked its links
  this way all along, and a special case here would make two identical sources sort differently
  depending on which lane found them.
- **`fileIdx` is dropped on a `url` stream.** It indexes a file *inside* a torrent, and a direct
  link is already that file.

**yt-dlp had no caller.** `extractLinks`/`searchAndExtract` existed and were referenced by
nothing outside their own definitions — ~1,800 sites, binary already fetched and resolved by
`binaryDownloader`. Same shape as the local-file capability that shipped with no entry point.
Two defects were fixed on the way in, and both are rules this repository had already settled:

- **The transport was read from the URL string** (`url.includes('.m3u8')`) with `fmt.protocol`
  sitting unread in the same object. Nothing is decided from the URL — `cs3/providerLinks.ts`
  exists for exactly this argument.
- **Any format with a video *or* an audio stream was offered.** On every DASH site that means
  the top rows are video-only, and a video-only row plays perfectly, in silence, with no `error`
  event. That is the AC-3 signature, and a viewer diagnoses it as a broken app. `ytdlpSources.ts`
  requires both halves, except on a manifest, which names its own tracks.

The `ytsearch1:<query> official trailer OR full feature` fallback is gone. A trailer standing in
for a film is a synthetic source under another name.

`YtDlpEngine.resolve` answers with a **reason** rather than an empty array, lifted from yt-dlp's
own stderr: "Unsupported URL", "Video unavailable" and a named geo-block are three different
actions a viewer could take, and the old code made them one silent non-answer. It is bounded,
and it passes `--no-playlist` — handed a series page, yt-dlp otherwise resolves every entry,
turning one press into hundreds of extractions against somebody's site.

**Two entry points, and no IPC surface changed**, because both paths already ran end to end: a
pasted page URL becomes its own search row exactly as a pasted magnet does (`searchSession`), and
`ContentService.discover` resolves an `http(s)` base through yt-dlp — where it previously fell
through to a catalogue lookup and ended at "Could not determine a title to search for". The page
is **not** resolved from the search box: typing is not consent to fetch a page, and a search that
spawns a process per keystroke would be its own bug. A page yt-dlp cannot read still falls through
to the ordinary search when a title is already known, so re-opening a history row whose media URL
is an expired CDN address is not answered with a sentence about the dead link.

`bun run test:direct-sources` (13) and `bun run test:ytdlp` (16). The first was verified by
mutation: restoring the `infoHash` filter and removing the direct branch fails 9 of its 13.

**The catalogue grew with them** — `xr3ed` (190 extensions, 47 on the jar lane), `hexated`,
`arabic_extensions`, `indochannel`, and `codegeasse` behind the adult gate. None is `bundled`:
that flag is still a claim `provider-e2e.mjs` has driven the repository end to end.
`bun run test:repositories` (9) pins what that data file may claim — unique ids and addresses,
https, a raw document rather than a project page, an adult repository never bundled, a bundled
repository never unverified. It fetches nothing; liveness is
`node tools/research/survey-repositories.mjs`, run deliberately, and a test that fails when a
third-party host has a bad afternoon is one people learn to ignore.

### The source cache learns from playback

It was already persistent with per-source expiry. What it lacked was any memory of a source
having *failed*: `unplayable` lived on the session and died with the player, so the same
dead link was served first again next time.

`recordFailure` now decides between two responses, and the distinction is the whole policy.
A **definitive** answer — 404, 410, or the host saying the file is gone — drops the source
immediately, because no amount of retrying changes it. Anything else is **counted**: a
timeout, a reset, a 5xx, or a 403 is the network or the host having a moment, and a cache
that forgets everything on the first bad minute is worse than no cache. Three such failures
drop it. `recordSuccess` clears the count, so a source that failed twice on a bad afternoon
is not dropped by an unrelated blip a week later.

403 is specifically **not** definitive: expired signed URLs and hotlink protection both
answer 403 and both are recovered by re-resolving, which the expiry machinery already does.

Pinned by `sourceCache.test.mts` (10 cases), including that removing the last source removes
the entry rather than leaving an empty shell — `hit: true` with nothing in it makes the
caller skip the discovery it needs.

