# Extended metadata and trailers — field notes

Dated post-mortems and measurements moved verbatim out of `AGENTS.md` (nothing rewritten). The distilled rules are in `AGENTS.md` §10 and `docs/agents/library-and-ui.md`; read this file when you need the *why* — the measurement behind a number or the failure a rule prevents. Section numbers and cross-references (§5.1, §6.9 …) are unchanged.

## Contents

- Trailers: the catalogues publish an id and nothing else (2026-09-18)
- The cast list was a row of names, and that was as far as it could go (2026-09-14)
- 5.3 The metadata coverage harness — `tools/e2e/metadata-e2e.mjs`

---

### Trailers: the catalogues publish an id and nothing else (2026-09-18)

PRD-45. `ExtendedMetadata.videos` had been assembled by `enrichmentService`,
carried across the IPC boundary and cached **since extended metadata was built,
and rendered by nothing**. That is the fourth direction this repository's
recurring failure has arrived from: a channel invoked and never registered, a
channel registered and never invoked, a component built and never mounted, and
now a *field* populated and never read. No test catches the fourth, because the
data flowed correctly the whole way and simply stopped.

**What the keyless sources actually publish, measured against the live hosts:**

| Source | Videos per title | Type published |
|---|---|---|
| Cinemeta `trailers[]` | 2-5 (Spider-Verse 5, Dune: Part Two 3, Breaking Bad 2) | the literal string `"Trailer"`, on **every** entry including the teasers |
| Cinemeta `trailerStreams[]` | the same ids again | a `title` that is the *film's* name repeated |
| AniList `trailer` | 1 | the site, not the type |

So the type, the ordinal and the season are not fields anybody gives us.
**YouTube's keyless oEmbed endpoint closes that**: 12 ids issued in parallel
answered in **201 ms total**, carrying the real title and channel --
`"Dune: Part Two | Official Trailer 3"`, `"Stranger Things Season 1 Trailer 1 |
Rotten Tomatoes TV"`. `metadata/videoTitles.ts` reads them.

Rules:

- **The describing segment decides the kind, not the whole title.** Measured on
  `Spider-Man: Across the Spider-Verse - Trailer #3 - Only In Cinemas June 2`:
  testing the whole string classified a numbered trailer as a promo, because
  "In Cinemas" matches a rule listed above `trailer`.
- **An unrecognised video is a trailer, never `other`.** These arrive from a
  *trailer* field; filing one under Related Videos hides the thing the viewer
  asked for.
- **Wikidata's `P1651` is not a trailer -- do not use it.** Measured: it resolves
  to the **YouTube Movies rental listing** (`Dune` by *YouTube Movies*). A
  paywalled full film labelled "Trailer" is the wrong-answer-that-looks-plausible
  failure, caught only because it was checked.
- **Duration and publish date are not fetched.** They sit at roughly byte
  **748,000 of a 1.28 MB** watch page -- a megabyte per card to print "2:31". The
  fields exist and are filled opportunistically from yt-dlp's reply when a video
  is played, because that call happens anyway.
- **Nothing settled renders empty.** PRD-45 section 10 asks for both "hide the
  section" and "show a no-trailers state"; those cannot both be right, and
  `metadataSection.ts` settled it already.
- **A trailer plays in its own popup, never in the player** (`TrailerPopup`,
  2026-09-19). It used to go through `onPlay` as a `PlaybackRequest` with no
  `progress`, no `series` and no `sources` and `promo: true` withholding the
  download button -- correct, and still wrong: a two-minute teaser took over the
  app exactly as the film does, and leaving it meant leaving the page being read.
  The popup is a dialog over the detail page with the browser's own controls, so
  it sets none of the player's expectations (pick a source, download, resume,
  next episode). `promo` is gone from `PlaybackRequest`; nothing set it.
- **The popup still calls `media:prepare`, and still refuses `NATIVE_MPV`.**
  INV-RACE-1 is not waived for a short video: `videos:resolve` answers with a
  proxied provider address and the classification decides the transport, never
  the URL string. A prepared session is closed on every step, or six trailers
  hold six ffmpeg processes.
- **Autoplay is an offer with a five-second countdown, and it never leaves the
  rail.** `src/utils/trailerQueue.ts` (pure, tested): a trailer follows a
  trailer and a related video follows a related video -- rolling on from the last
  trailer into an eleven-minute cast interview is the exact failure `groupVideos`
  splits the two rails to prevent. Nothing wraps, so autoplay ends by itself.

**And a trailer is never a source.** `resolvePromoVideo` goes nowhere near
`getSources`, the cache, the ranker or the download identity. The standing rule
that a trailer standing in for a feature is a synthetic source is about a trailer
offered when somebody asked for the *film*; here they pressed it, in a section
labelled Trailers.

### The cast list was a row of names, and that was as far as it could go (2026-09-14)

The detail page showed `detail.actors` as grey chips. That is upstream's shape —
`LoadResponse.actors: string[]` — and it is not a UI shortcoming: **a `.cs3`
provider is a site scraper**, so it knows the page it parsed and nothing else. It
has no opinion about who directed the film, what an actor looks like, which
character they played, or what IMDb's 900,000 voters thought. Widening
`LoadResponse` would have added a dozen fields every provider in the corpus
leaves undefined, and the page would look exactly as it does now.

So extended metadata is a **second record on a second schedule**: the provider
answers "what can I play", the catalogues answer "what is this", both keyed on
the same title, merged at the edge. `electron/metadata/` owns the second half and
`src/components/detail/TitleMetadata.tsx` draws it.

**The key constraint eliminates most of the obvious answers.** The user must not
have to obtain an API key — `cs3/discovery.ts` settled this for the home screen
and it binds harder here, because a key embedded in a distributed GPL client is
both a licence violation and a key that gets revoked, taking the feature from
every user at once. That rules out TMDB, Trakt, OMDb, Fanart and TheTVDB as
direct sources, which is most of what a search for "movie metadata API" returns.

Four keyless sources survive, and each answers a different part:

| Source | Answers | Covers |
|---|---|---|
| **Wikidata** (SPARQL, CC0) | cast **with characters**, crew, release date, box office, budget, awards, and the Wikipedia sitelink | film and TV |
| **TVmaze** | cast and crew with real photographs, and the character's own artwork | television only |
| **AniList** (GraphQL) | characters, their voice actors in every language, staff, studios — both name pairs in both scripts | anime |
| **Cinemeta** | director, writer, `released`, country, awards, trailers, IMDb rating | film and TV |
| **Wikipedia** (REST) | "behind the scenes" prose — production, filming, casting, legacy | anything with a sitelink |

Wikidata is the one that made this worth building. Cinemeta's `cast` is
`string[]` — names and nothing else — so before this the app could say Timothée
Chalamet is in Dune and could not say he plays Paul Atreides. Wikidata models
`P161` (cast member) as a *statement* carrying `P453` (character role) as a
qualifier, so the performer and the part are one fact rather than two lists to be
zipped together and got wrong. **Cinemeta is also the cheapest of the five**: the
app already fetches that exact URL on every catalogue detail page and reads nine
of its fields, so `cinemetaExtras.ts` is a new parse of a reply already paid for.

#### Things that are load-bearing

- **Nothing waits for this.** `metadata:getExtended` answers from cache at once
  and `metadata:extendedUpdate` pushes a fuller record as each source lands —
  push-shaped like `search:*` and `playback:*`, for the identical reason. Four
  third-party hosts, the slowest measured in seconds; a blocking version would
  make every detail page as slow as Wikidata's worst day.
- **The enrichment is never on the playback path.** `metadataEnrichment` is
  constructed beside `contentService` in `main.ts`, not inside it. Folding it
  into `ContentService.load` would put four third-party APIs in front of a Play
  press.
- **The provider's own `actors` stays as the floor.** `TitleMetadata` takes
  `fallbackActors` and renders the old chip list when nothing richer arrived.
  Without that, enrichment would *replace* the names on every title the
  catalogues do not cover rather than adding to them — a large part of this
  corpus, since providers scrape sites rather than databases.
- **Nothing *settled* renders empty, but a lookup in progress says so.** The
  rule was once "nothing renders until there is something to render", and the
  half of it about the settled case still holds: a "Cast" heading over a blank
  space reads as a lookup that failed, and for a title nothing has an entry for
  that impression would be permanent and wrong. The half about the *wait* was
  wrong. Five hosts are asked and Wikidata alone measured 11.3s, and for all of
  it the page said nothing — so a slow fetch and a title no catalogue carries
  produced the same screen, collapsing the exact distinction `empty` vs `failed`
  exists to keep. `metadataSection.ts` owns the four-way decision (`looking` /
  `fallback` / `content` / `nothing`); it is a plain `.ts` beside the component
  because Node's type stripping cannot load JSX, same as `settingsLevel.ts`.
- **`pending` is the caller's flag and `partial` is the record's, and both are
  needed.** `partial` only exists once a record does, and for a page whose
  provider published no IMDb id the lookup *begins* by resolving one from the
  title — so the longest part of the wait happens while there is nothing to read
  a flag off. `DetailView` clears `pending` on every exit from that effect,
  including the no-URL path: a spinner that outlives its request is worse than
  no spinner.
- **There is no "show all" on the cast or the notes.** Everything found is
  drawn. A collapsed list hides what the viewer came to read behind a button
  they have to find; the rail already scrolls and `Poster` lazy-loads, so a
  250-strong anime cast costs its images only as they are scrolled to. The
  heading states the count, because a scroll bar cannot say whether it is
  showing twelve of twelve or twelve of two hundred.
- **Ratings are never normalised on ingest** (PRD-41 §11.5). Value plus
  `scaleMin`/`scaleMax`, as published; `normalisedRating` scales at read time for
  sorting only. Rotten Tomatoes' 91% rendered as "9.1/10" is a misquote, not a
  unit conversion — and a zero answers `null`, because AniList sends
  `averageScore: 0` for an unrated title and scaling it renders a real and
  terrible score.
- **The Wikipedia article is a sitelink, never a search.** A search for "Dune
  production" finds an article, and whether it is about the 2021 film, the 1984
  one, the novel or the desert is a guess — one that attaches the wrong film's
  history to a page in well-written, entirely plausible prose. Wikidata's
  `schema:about` asserts the identity. No sitelink, no prose; that costs coverage
  on obscure titles and is the right trade. Same argument `cs3/titleEnricher.ts`
  makes, one step further.
- **Wikipedia attribution is a required field.** `ProductionNote.attribution`
  carries the source, the deep link and the licence name, so nothing can
  construct a note without one. The text is CC BY-SA; an attribution the UI can
  forget to render is one it will eventually forget to render.
- **Commons images are requested at a width.** `P18` resolves to
  `Special:FilePath/<file>`, which serves the *original upload* — 3–8 MB for a
  professional headshot, up to sixty of them, drawn at 96 pixels. `?width=` is
  always appended and the raw URL never reaches the renderer. TVmaze's `medium`
  is taken over `original` for the same reason.
- **The native name is `P1559`, not a non-English `rdfs:label`.** Selecting a
  label in another language returns one row *per language Wikidata holds*,
  multiplying a 40-person cast by 90 and timing the query out.
- **Spoiler tags never reach the page.** AniList marks them
  (`isGeneralSpoiler`/`isMediaSpoiler`) and they are the one piece of metadata
  that can actively ruin the thing the viewer came to watch.

#### The merge, and why it is its own tested module

`metadata/merge.ts` is pure and pinned by 34 cases, for the reason
`ottPlatforms.ts` and `playedSource.ts` are: every wrong answer is silent and
plausible. The two failure directions are not symmetric —

| Too coarse | Too fine |
|---|---|
| The composer John Williams folds into the bit-part actor John Williams | One person from two sources becomes two rows |
| Rare, wrong, and invisible | Common, harmless, and looks broken |

— so the key is **name plus role class**, and two cast credits that *both* state
a character and state different ones are treated as different people. Where only
one source states a character there is no disagreement, and merging is right:
that case is the whole point, since Wikidata has the character and TVmaze has the
photograph. Characters compare by containment in either direction, because
"Tony Stark" and "Tony Stark / Iron Man" are one role.

**Source order in `assemble` is precedence order and is not arbitrary.** The
sources carrying characters and photographs go first so their rows shape the
list; the name-only sources fold onto them. Put Cinemeta first and the merged
cast is ordered by the one source with no images.

**A credit with no billing order is never given one.** Wikidata answers a SPARQL
*set*, in planner order; treating a missing `order` as `0` scatters unbilled
extras through the top of a list TVmaze had ordered correctly. `orderCredits`
puts the unordered ones behind, stably.

#### `empty` is not `failed`, and two bugs of mine proved why it matters

Same distinction `providerAnalytics` draws. Wikidata genuinely has no entry for
many 2024 streaming releases; reporting that as an error puts a red state on a
page that is simply about an obscure title. So `MetadataSourceOutcome` carries
`ok` / `empty` / `failed` / `skipped`, with the reason kept even though the page
shows only one muted line.

**That distinction is worthless if a source swallows its errors, and two of them
did.** `lookupByImdb` caught everything and answered `null`; `fetchWikidata`
settled both queries and returned an empty result whatever happened. The e2e
harness caught both on its first run — reporting *Breaking Bad*, one of the
best-covered series TVmaze holds, as "not a TVmaze title" while the host was
answering 403, and every Wikidata row as `OK — 0 credits` against the same 403.
An unreachable host would have reached the viewer as "this title has no cast
recorded", with the real cause invisible in every diagnostic the app collects.
Only a 404 is a null now, and a total Wikidata failure is raised. Pinned by
`metadata-sources`, verified by mutation.

**This is the same defect this repository keeps undoing** — `probeUrl`'s
`res.resume()`, `BinarySetupModal` rendering a rejection as a friendly notice,
`ensureProvidersLoaded` returning silently. A catch that reassures is worse than
no catch.

#### Verified against live hosts, 2026-09-17

The section that stood here said no part of `electron/metadata/` had ever been
run against a live host, because it was written in a cloud container whose
egress proxy denied every third-party host. That is no longer true and the
claim was the stale half of this file.

`node --experimental-strip-types tools/e2e/metadata-e2e.mjs` — **PASS, 3/3
titles resolved a cast list with characters.** Per-source, measured:

| Title | cinemeta | wikidata | tvmaze | anilist | wikipedia | merged |
|---|---|---|---|---|---|---|
| Dune (2021) | 606ms, 7 | 1553ms, 29 (14 characters, 22 photos) | n/a (a film) | — | 997ms, 5 sections | 33 credits |
| Breaking Bad | 68ms, 4 | 11280ms, 60 | 1240ms, 56 | — | 898ms, 3 sections | 106 credits |
| One Piece | — | — | — | 1038ms, 253 | — | 252 credits |

Note Wikidata's **11.3 s** on Breaking Bad. That is the number the whole
push-shaped design exists for, and it is why nothing on the detail page waits
for this record.

What is still *not* claimed: `tagline` is carried on `ExtendedMetadata` and
**nothing keyless fills it**. It is absent from Cinemeta, TVmaze and AniList,
and Wikidata's `P6338` came back unset on every film checked. It is filled from
the provider or not at all, and the row is simply omitted.

#### Every page gets the same metadata, because the id is resolved

The complaint this answers is "some titles show everything and some show a row
of names", and the cause was not the catalogues. **Four of the five sources are
reached through an IMDb id**, and a `cs3ext://` page from a scraper routinely
has none — the provider parsed a streaming site and the site never printed one.
Those pages recorded four `skipped` outcomes and rendered nothing at all.

`MetadataEnrichmentService` takes `TitleEnricher` and resolves the id from the
title before asking anything. Measured live, from the raw release name
`Dune Part Two 2024 2160p WEB-DL` with **no ids of any kind**: resolved to
`tt15239678` and assembled genres, runtime 167, `US: PG-13`, Legendary Pictures,
three countries, poster, backdrop, `2024-03-01`, an IMDb rating, 6 trailers and
31 credits. Before, that page drew nothing.

Four rules:

- **Awaited, not raced.** Every source below it is addressed *by* the id, so the
  fan-out cannot start first. `TitleEnricher` caches for a week.
- **The resolver's conservatism is the safety.** A disagreeing year disqualifies
  and the similarity bar is high; a wrong match does not degrade a page, it
  replaces it with a different film's cast and nothing marks it as a guess.
- **Anime resolves an AniList id the same way** (`searchAniListId`). An IMDb id
  reaches Cinemeta and Wikidata and neither has characters, voice actors or
  native names, which is the entire reason AniList is in the set.
- **The provider's own answer always wins; enrichment is the floor.** Poster,
  plot, runtime and original title fill gaps and never overwrite — a scraper
  that returned artwork returned it for the *release* being watched, and a
  canonical catalogue value would quietly change what the page is about for
  dubbed cuts and re-edits.

New fields on the record, with where each is measured from: `genres` (Cinemeta,
TVmaze, AniList — **never Wikidata's `P136`**, which answers "action film" and
"drama television series" and would put the word "film" on every chip),
`status`, `seasonCount`/`episodeCount`, `runtimeMinutes`, `posterUrl`,
`certifications` (`P1657`), `networks` (`P449` + TVmaze). `backdropUrl` had been
fetched, cached and sent across the IPC boundary since this module was written
and was **drawn by nothing** — `DetailHero` is the entry point it never had.

**Organisations merge on the name.** Measured, TVmaze and Wikidata both answer
`AMC` for Breaking Bad, and the first version of this rendered "AMC, AMC" under
Network. `mergeOrganisations` is the `mergeStrings` rule for `Organisation[]`;
`studios` had the same latent duplication and goes through it too.

### 5.3 The metadata coverage harness — `tools/e2e/metadata-e2e.mjs`

```
node --experimental-strip-types tools/e2e/metadata-e2e.mjs
node --experimental-strip-types tools/e2e/metadata-e2e.mjs --only wikidata
node --experimental-strip-types tools/e2e/metadata-e2e.mjs --title tt1160419
node --experimental-strip-types tools/e2e/metadata-e2e.mjs --json report.json
```

`provider-e2e.mjs` asks whether the extension corpus still runs and
`native-engine-matrix.mjs` asks whether what it returns can be played. This asks
the third question: **do the keyless catalogues actually answer, and is what
comes back the shape the parsers expect?**

It imports the shipping adapters rather than reimplementing the requests, for
`native-engine-matrix.mjs`'s reason — and here that matters more than usual,
because a wrong SPARQL property fails *silently as an empty result* rather than
as an error. So the gate is that at least one source returned **cast with
characters**, not that a request succeeded: a clean, empty 200 is exactly what a
mistyped property produces, and it is indistinguishable at the transport layer
from a title nobody has an entry for.

Three fixtures, one per routing path — a film (Wikidata + Cinemeta), a series
(TVmaze) and an anime (AniList, two scripts and voice actors) — and it prints,
per source: status, latency, credits, how many carry a character, a photograph
and a native name, then the merged result and five sample rows. The merged line
is the one worth reading: it is the only place several real sources meet, so a
duplicate there is a duplicate on screen.

**It has already paid for itself once.** On its first run it exposed two
swallowed-error bugs in the adapters it drives — see "`empty` is not `failed`"
above. Both were invisible to the unit tests, because both produced a perfectly
well-formed empty result.

Run it before claiming anything about metadata coverage. Under a blocking egress
proxy it correctly reports every source as `FAIL` with the real reason and exits
1, which is the honest answer rather than a pass.

