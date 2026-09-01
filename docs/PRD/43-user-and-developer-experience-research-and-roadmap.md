# 43 — User and developer experience: research, and the roadmap it implies

**Status: research + proposal. Most of §6–§8 is not built.**
**Written 2026-09-01. Progress noted inline as items land.**

> **Landed since writing:** UX-3 (catalogue control on the home screen, closing
> F-8) and the second surface of UX-1 (the OTT page's switched-off state now
> offers the fix rather than directions to it). Everything else stands.

---

## 0. What this document is, and what it deliberately is not

PRD **39** and PRD **41** already specify the *machinery* of an extension platform:
wire formats, five lanes, ed25519 signing, the capability sandbox, the metadata model,
the author CLI. Both are thorough and neither is superseded here.

Neither answers the two questions this document exists for:

| | Asked by | Answered in |
|---|---|---|
| "What does using this **feel like**, against the alternatives?" | a viewer | **§3, §5, §6** — nowhere else in `docs/` |
| "What does **writing a scraper for it** feel like?" | an extension author | **§4, §7** — 41 §12 covers the CLI's *shape*, not its ergonomics |

PRD 41 §2 is a superb technical account of the Android ecosystem — repo formats,
`MainAPI`, the extractor registry. It is not a description of how the product behaves
when a provider dies at 11pm, which is the thing users actually experience.

**The evidence base for §5 is unusual and worth stating up front.** It is not a
heuristic review. It is what this codebase measured about itself over one working
session on a real installation: a 6,180-record session log, a 437-problem tally, and
eight defects found and fixed. That is primary evidence about *this* product that no
competitor analysis can supply, and it turns out to be the more useful half.

---

## 1. Executive summary

**The finding.** Our extension *engine* is now competitive — 66 providers load, the
class problem is closed, five lanes are specified. Our extension **experience** is
not, in either direction:

- For a **viewer**, the app repeatedly told the truth and offered nothing to do about
  it. Measured: a warning naming 70 broken sources with no action; a recovery button
  that fixed one third of a four-part gate; an OTT page that opened onto an apology.
- For an **author**, we have no path at all. There is no CLI, no fixture harness, no
  local repository, no way to test a scraper without building the whole desktop app.
  An author who wants to support us today writes an Android `.cs3` and hopes.

**The strategic claim, and it is narrower than "be better than Stremio".** The three
mature systems each made one structural trade, and each trade has a visible cost:

| System | The trade | What it costs the user |
|---|---|---|
| **Stremio** | Addons are *remote HTTP services* | Nothing runs locally, so nothing works offline, and every scrape is someone else's server that can go down or log you |
| **Kodi** | Addons are *local Python*, versioned against the host | Enormous power; a dependency-resolution and breakage surface that made "my build stopped working" a genre |
| **CloudStream** | Addons are *local Android bytecode*, unsigned | Excellent scraping, zero supply-chain protection, Android-only |

We are the only one that can take **local execution** (Kodi/CloudStream) *and* **an
install that is one click and reversible** (Stremio) *and* **a sandbox** (nobody).
That is the position worth building toward, and §6/§7 are the smallest set of moves
that reach it.

**The single highest-value change in this document is not technical.** It is
§6.1: *every message that names a problem must carry the action that resolves it*.
This session found four separate places where it did not, and each read to the user as
the app being broken rather than as the app being blocked.

---

## 2. Method, and the honesty rules applied

Three sources, weighted differently:

1. **Primary — our own instrumentation.** The `Logger`, `DiagnosticsLog` and
   `ExtensionIssueLog` triple already exists (`AGENTS.md` §5). One session's records
   were tallied by cause. This is the strongest evidence here and the only kind that
   is about *us*.
2. **Documented behaviour of other systems.** Read from their own specifications, cited
   in §9. Where a claim is about a spec, it is safe; where it is about how a system
   *feels*, it is marked **[judgement]**.
3. **This repository's own history.** `AGENTS.md` records roughly forty defects with
   causes. It is the best available account of which failure *shapes* recur, and §5's
   taxonomy is largely derived from it.

**Not evidence, and not presented as such:** user interviews (we have none), analytics
(deliberately none — `providerAnalytics` stores aggregates and no viewing history),
and download or retention numbers (the product is not distributed yet).

---

## 3. Research: the viewer's experience, four systems compared

### 3.1 Installing a source

| | Stremio | Kodi | CloudStream | **Us, today** |
|---|---|---|---|---|
| Unit | Addon = an HTTPS endpoint | Addon = a zip | Extension = a `.cs3` | Extension = `.cs3` or jar |
| Install | One click from the in-app catalogue, or paste a URL | Add repo zip → browse → install → resolve deps | Add repo URL → browse → install | Add repo URL → browse → install |
| Bytes fetched | **None** | The addon and its dependency tree | The archive | The archive |
| Reversible | Uninstall is instant and complete | Usually | Yes | Yes |
| Fails how | Endpoint 404s or times out | Dependency resolution errors | Download or DEX translation | Same, plus translation |

**The lesson worth taking from Stremio is not "be remote".** It is that installation
carries *no user-visible cost*: nothing downloads, so nothing can half-download, and
uninstall cannot leave residue. Our install is a download plus a DEX translation, and
that is a real cost we should stop pretending is instant — this session found an
extension reported as `Unsupported, score 0` when the truth was that the sidecar ran
out of heap translating it.

**The lesson from Kodi is a warning.** Its `<dir minversion/maxversion>` mechanism
lets one repository serve different addon sets to different host versions — genuinely
good engineering that we lack. It also produced an ecosystem where "which build am I
on" is a question ordinary users have to answer, and that is the failure mode of
putting version negotiation in front of the user instead of behind them.

### 3.2 Finding something to watch

This is where the systems diverge most, and where we are weakest.

- **Stremio** leads with a catalogue. The home screen is Cinemeta plus whatever
  addons contribute, and sources are resolved *only when you press play*. Discovery
  and delivery are separated, which is why its home screen is fast and always
  populated. **[judgement]** this is the single best structural decision in the space.
- **Kodi** leads with whatever addons you installed. There is no unified catalogue,
  so the home screen is a list of tools rather than of things to watch.
- **CloudStream** leads with provider home pages (`getMainPage`), so the front page is
  as good as the providers installed and empty with none.
- **Us**: we already made Stremio's choice (`cs3/discovery.ts`, keyless Cinemeta,
  stale-while-revalidate) and it is the strongest part of the product. As of this
  session the OTT pages make the same split — a keyless per-service catalogue, with
  clicking a row running an all-provider search.

**What we still lack that all three have: a way to change what the home screen shows,
from the home screen.** The setting exists in Settings → Home. Nobody browsing
catalogues is in Settings.

### 3.3 When something fails

The differentiating moment, and the one this session measured hardest.

- **Stremio**: a source that fails is simply absent from the stream list. Clean, and
  it discards the diagnosis — you cannot tell "nobody has this" from "your addon is
  down".
- **Kodi**: a Python traceback in a toast. Maximum information, minimum usability.
- **CloudStream**: usually an empty list; sometimes a raw Kotlin exception.
- **Us**: we are already the best of these on *diagnosis* — `failureTaxonomy.ts`,
  `SourceDiagnosis`, `explainMissingProvider`, `CopyErrorButton`. §5 is about the
  fact that being right about the cause and offering nothing to do about it is only
  half a feature.

### 3.4 The scoreboard, honestly

| Capability | Stremio | Kodi | CloudStream | Us |
|---|---|---|---|---|
| One-click install | ● | ○ | ◐ | ◐ |
| Works offline | ○ | ● | ● | ● |
| Unified catalogue | ● | ○ | ◐ | ● |
| Diagnosis on failure | ○ | ◐ | ○ | ● |
| **Action on failure** | ○ | ○ | ○ | **◐ (this session)** |
| Sandbox | ● (remote) | ○ | ○ | ◐ (process only) |
| Signed extensions | n/a | ◐ (hashes) | ○ | ○ |
| Author can test locally | ● | ● | ◐ | **○** |

The two columns where we are alone are **action on failure** and — if §7 lands —
**a local author workflow with a real sandbox**. Those are the differentiators; the
rest is parity.

---

## 4. Research: the author's experience

### 4.1 What it takes to ship a scraper today

| Step | Stremio | Kodi | CloudStream | **Us** |
|---|---|---|---|---|
| Language | Any (it is HTTP) | Python | Kotlin | Kotlin (via `.cs3`) |
| Scaffold | `stremio-addon-sdk`, ~20 lines | Manual `addon.xml` | Gradle template | **none** |
| Run locally | `node addon.js` → a URL | Drop in `addons/`, restart | Build APK, sideload, restart | **build the desktop app** |
| Iterate | Edit, restart, refresh | Restart Kodi | Rebuild, reinstall, restart | Full rebuild |
| Test | Ordinary Node tests | Ordinary Python tests | Little convention | **none** |
| Publish | `publishToCentral()` | PR to the official repo | Host a `plugins.json` | Host a `plugins.json` |

**Stremio's SDK is the benchmark and the gap is embarrassing.** Twenty lines of
JavaScript gets a running addon and an install URL. That is not merely more pleasant —
it changes *who* can contribute. An author who can try an idea in ten minutes tries
more ideas.

**The measured consequence for us.** Of the repositories this project has driven,
**every single extension is an Android `.cs3`**. Not one was written for desktop,
because there is no way to write one for desktop. PRD 41 §6.3 argues we should host
upstream's cross-platform jar — and we now do (`AGENTS.md`, the jar lane) — but that
lane still requires the Android Gradle toolchain. **We have five specified lanes and
zero of them can be authored without Android.**

### 4.2 The four things Stremio has that we do not

1. **The addon is the smallest thing that can run.** A manifest and one handler.
2. **`serveHTTP` gives an install URL immediately** — the loop is edit → restart →
   click.
3. **`publishToCentral`** makes distribution one function call rather than hosting a
   JSON file and hoping people find it.
4. **`behaviorHints.configurationRequired`** lets an addon declare it needs setup
   *before* being installed, so a user is never handed something inert.

That last one is worth stealing verbatim: it is exactly the "a feature that exists and
cannot be reached" failure this repository has now hit four times from four directions.

### 4.3 What Kodi has that is worth taking

- **`<dir minversion/maxversion>`** — one repository, host-version-scoped. Our
  `RUNTIME_GENERATION` is the same idea, applied only internally. An index that could
  say *"this build of the extension needs runtime generation ≥ 11"* would turn a class
  of silent breakage into a refusal with a reason.
- **`hashes sha256` with a HEAD probe** — the client asks for the hash before the
  bytes, so an unchanged archive is never re-downloaded. Our updater re-downloads.

---

## 5. The UX failure taxonomy, measured

Eight patterns, each with evidence from this codebase. This is the section to design
against, because every one of them is a *shape* that recurs rather than a one-off bug.

### F-1. A true statement with no action attached
> *"Cartoony, Mp4Moviez, SkymoviesHD … [70 names] are selected in the search scope but
> no longer installed or enabled."*

Accurate, and it left the user to fix 70 things by hand in a tree. **Fixed this
session** (bulk fix modal), and it is the template for the rest of §6.1.

### F-2. A control that runs, reports success, and changes nothing
The detail page's *"Enable X & Load"* called `setProviderEnabled` — one third of a
four-part gate. On the common post-restore state it succeeded and changed nothing; on
a fresh machine there was no switch to flip at all. **Fixed this session.**

### F-3. A feature that exists and cannot be reached
Four instances on record: a channel invoked and never registered; a channel registered
and never invoked; `ExtensionUpdates` built and never mounted; and — found this session
— an entire app blanked by a filename case collision. All four were invisible to
`tsc` and to every test. Three now have lexical guards (`ipcSurface`,
`componentReachability`).

### F-4. A message that names the wrong party
`UnsupportedOperationException: Unknown method: providerMainPageSections` — 44
occurrences, and the real cause was that Maven had not been run. Also
`InvocationTargetException: null`, and `TRANSLATION_FAILED: OutOfMemoryError` reported
as an *extension* being incompatible when the heap ceiling was ours.

### F-5. Silent partial success
Restore reported "restored" for sections it had merged when the user asked to replace;
the backup collected a plugin list and never read it; `disabledExtensions` was never
recorded at all. **Fixed this session** — a section that cannot honour a mode now says
so in its own report row.

### F-6. A cost the interface does not admit
Install is a download plus a DEX translation. Nothing said so, so a slow install read
as a hang. Related: the search scope picker loaded every extension into the JVM on
open, with nothing on screen saying why it took minutes.

### F-7. An empty state that is a dead end
The OTT pages with nothing installed: a brand name, a search box, and no way forward.
**Partly fixed this session** via the metadata catalogue.

### F-8. A setting in the wrong room
Home-screen catalogue selection lived in Settings. The person who wants it is looking
at the home screen. **Fixed** — `CataloguePicker` moved it into the home toolbar, and
the same pass found `includeAnime` had been an accepted parameter with no caller since
`discover:sections` was written. That is F-3 arriving through an argument rather than
through a channel or an import, which is a fourth direction and worth recording.

---

## 6. The user-experience roadmap

### 6.1 The one rule — "no dead ends"

> **Every message that names a problem carries the action that resolves it, or says
> plainly why there is none.**

Concretely, three obligations on any failure surface:

1. **Name the cause** — we already do this well (`failureTaxonomy`).
2. **Offer the fix in place** — a control, not a pointer to Settings.
3. **When there is no fix, say that**, and offer the nearest useful thing (search
   elsewhere, pick another source).

A checklist for reviewing any new failure UI:

- Does it tell the user something they can act on?
- Is the action *here*, or does it send them somewhere?
- If nothing can be done, does it say so rather than showing an inert button?
- Does it survive being wrong — i.e. if the diagnosis is mistaken, is the offered
  action harmless?

### 6.2 UX-1 — Extend the fix modal to every surface (M, high value)

`FixProvidersModal` exists and is wired to one warning. The same component should serve:
the OTT page's "nothing serves this platform", the source panel's "no sources found",
the extensions tree's disabled rows, and the playback failure overlay.

*Acceptance:* no screen in the app names a disabled or missing provider without an
in-place control that can enable or install it.

**Progress.** Two of five surfaces done — the search-scope warning and the OTT page's
switched-off state, both through the same `FixProvidersModal`, which is the point: one
place to get this right rather than a bespoke recovery per screen. Remaining: the
source panel's empty state, the extensions tree's disabled rows, and the playback
failure overlay.

### 6.3 UX-2 — Progressive disclosure of cost (S)

Any action that downloads or translates states, before it starts: what it will fetch,
roughly how long, and whether it can be cancelled. Applies to install, bulk fix,
repository "install all", and first-run bootstrap.

*Acceptance:* no operation over ~2s runs without a named, cancellable progress state.

### 6.4 UX-3 — Catalogue control on the home screen (S)

Move (do not duplicate) the catalogue selector onto the home screen as a row-level
control: which catalogues, which genres, reorder, hide. Settings keeps a link to it.

*Rationale:* F-8. Also the single most-requested thing in this session.

**Done.** `src/components/home/CataloguePicker.tsx`. Moved rather than duplicated —
Settings keeps the configuration that has no place on a browsing screen (the key, the
custom URL, the health re-check), and both read the same state so they cannot disagree.

### 6.5 UX-4 — One "sources health" surface (M)

`ExtensionIssueLog` already computes the durable tally. Nothing renders it as a
*health* view: which of my sources worked this week, which are failing, one control to
fix or remove each. This is `providerAnalytics` + `extensionIssues` + `providerRecovery`
composed — all three exist.

### 6.6 UX-5 — Embedded playback (L, and see the caveat)

mpv currently opens its own OS window. Embedding it (`--wid` into a child
`BrowserWindow`) makes the app one window. **This is the highest-risk item here**: its
entire failure surface is visual (blank surface, z-order, resize lag), so it must be
built with a real run between every step, and it should ship behind a setting with the
external window as the fallback until proven. Roadmap detail: `docs/roadmap/support_libmpv.md`.

### 6.7 UX-6 — First-run that produces a populated app (M)

Bootstrap installs repositories in the background today. It should also: pick sensible
default catalogues, explain what extensions are in one sentence, and never leave the
user on an empty screen. Target: **a viewer who installs the app can press play on
something within 60 seconds without opening Settings.**

---

## 7. The developer-experience roadmap

The goal, stated as a target rather than a feeling:

> **A competent JavaScript developer with no Android toolchain can go from nothing to a
> working, installed, locally-tested provider in under 30 minutes.**

Today that number is unbounded, because the path does not exist.

### 7.1 DX-1 — `create-cs3-extension`, the twenty-line scaffold (M) — **do this first**

Modelled directly on `stremio-addon-sdk`. One command produces a working extension:

```
npx create-cs3-extension my-provider
cd my-provider && npm run dev
# → watching src/, extension served at cs3dev://localhost:7000
# → open CloudStream Desktop → Extensions → "Local development" → connect
```

The critical property is the **live local lane**: the app connects to a dev server and
loads the provider from it, so the loop is *edit → save → search*, with no build, no
archive, no reinstall. That is the whole of Stremio's advantage and it is available to
us for one IPC channel plus a watcher.

*Acceptance:* a new provider that returns one hard-coded search result, visible in the
app, in under 10 minutes on a machine with only Node installed.

### 7.2 DX-2 — The fixture harness (M)

PRD 39 §5.3 already argues fixtures matter more than tests, and it is right: a scraper
test that hits the live site fails when the site is merely slow, and that trains authors
to ignore their own suite.

```
cs3 record  --provider MyProvider --query dune   # captures real HTTP to fixtures/
cs3 test                                         # replays them, offline, deterministic
```

*Acceptance:* the suite passes with the network disabled.

### 7.3 DX-3 — `cs3 doctor` — compatibility before publishing (S)

We already have `LinkageAnalyzer` and `PluginCompatibilityAnalyzer` producing tiers.
Exposing them as a CLI turns our best diagnostic asset into author-facing feedback:

```
$ cs3 doctor ./dist/my-provider.csx
  tier      T1_DROPIN
  runtime   requires generation >= 11
  warnings  uses Context.getSystemService("window") — returns null on desktop
```

*Acceptance:* an author learns their extension is `T4_BLOCKED` before a user does.

### 7.4 DX-4 — Local repository + one-click install URL (S)

`cs3 serve` publishes a local `index.json` and prints an install link the app accepts.
Mirrors `serveHTTP`. Removes the "host a JSON file somewhere" step from the loop.

### 7.5 DX-5 — Version negotiation in the index (S)

Adopt Kodi's idea in our own format: each extension version declares
`requiresRuntimeGeneration` and `requiresAppVersion`; the client refuses with a reason
rather than installing something that will fail at load. This is the mechanism that
would have made the `providerMainPageSections` failure a sentence instead of 44
exceptions.

### 7.6 DX-6 — Publish, and be findable (M)

A curated index the app ships with, plus a submission path. **[judgement]** the
`status` field CloudStream repositories already publish — which we now read as a
ranking criterion — is the cheapest form of this and should be kept whatever else
happens.

### 7.7 What we should *not* build

- **Our own scraping DSL.** Sites differ too much; every declarative scraper ends up
  with an escape hatch into code, at which point it is a worse language.
- **A hosted addon service.** That is Stremio's model and it forfeits offline and
  privacy, which are two of our three advantages.
- **A second metadata standard.** PRD 41 §11 already specifies one. Use it.

---

## 8. Sequencing

Ordered by *evidence strength × cost*, not by appeal.

| Phase | Items | Why here |
|---|---|---|
| **A — finish what is started** | ~~UX-3~~, UX-1 *(2 of 5 surfaces)*, UX-2 | All three have measured evidence, all are small, and UX-1's component already exists |
| **B — the author loop** | DX-1, DX-3 | Nothing else in DX matters until someone can write an extension at all; DX-3 is nearly free given `LinkageAnalyzer` |
| **C — make it trustworthy** | DX-2, DX-5, PRD 41 §8 signing | Fixtures and version negotiation are what stop the ecosystem breaking silently as it grows |
| **D — the expensive ones** | UX-4, UX-5, UX-6, DX-4, DX-6 | Each is worth doing; none blocks the others |

**Phase A is roughly a week and is the highest-value week available.** Phase B is the
one that changes the product's trajectory, because it changes who can contribute to it.

---

## 9. Sources

- Stremio Addon SDK — `github.com/Stremio/stremio-addon-sdk`, `docs/README.md` and
  `docs/api/responses/manifest.md`. Read 2026-09-01 for the manifest fields,
  `behaviorHints.configurationRequired`, `serveHTTP` and `publishToCentral`.
- Kodi wiki — *Add-on structure* and *Add-on repositories*. Read 2026-09-01 for
  `addon.xml`, the `xbmc.addon.repository` extension point, `<dir minversion/maxversion>`,
  and the `hashes`/HEAD-probe mechanism.
- CloudStream upstream — as recorded in PRD 41 §2, which was written from source.
- **This installation**, 2026-09-01: 6,180 log records over 36 hours, 437 problems
  tallied by cause; and `AGENTS.md`, which records ~40 defects with their causes.

## 10. Open questions

1. **Does the live-development lane run unsigned code?** It must, or it is not a
   development lane. It therefore needs to be visibly, temporarily distinct from
   installed extensions — probably a persistent badge while any dev extension is
   connected. *Decision needed before DX-1.*
2. **Do we accept Stremio addon URLs as a lane?** PRD 41 §6.5 says yes and budgets a
   week. It would give us a large existing catalogue ecosystem immediately. The cost
   is that those addons are remote, which contradicts the offline advantage — so they
   should probably be marked as such in the UI rather than blended in.
3. **Is `.csx` (PRD 41 L2) still the right target given the jar lane works?** The jar
   lane is real, shipping and needs no new standard from authors. **[judgement]** the
   honest answer may be that L2's value is now mostly the *sandbox*, not the format,
   and it should be justified on that basis or deferred.
4. **Who curates?** DX-6 implies a review step. We have no people for it. A
   status/health-driven automatic listing may be the only sustainable answer.
