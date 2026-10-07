# Library, downloads, UI, settings and lifecycle — field notes

Dated post-mortems and measurements moved verbatim out of `AGENTS.md` (nothing rewritten). The distilled rules are in `AGENTS.md` §9–11 and `docs/agents/library-and-ui.md`; read this file when you need the *why* — the measurement behind a number or the failure a rule prevents. Section numbers and cross-references (§5.1, §6.9 …) are unchanged.

## Contents

- The window took three seconds, and none of it was the app's own code (2026-09-21)
- A component built and never mounted (2026-08-31)
- Cards remember what already happened to them (2026-09-18)
- Standard mode, and where the app was narrating itself (2026-09-18)
- The second pass: the screens PRD-47 did not reach (2026-09-19)
- The mini player: the `<video>` element is never remounted
- The home screen is discovered, not hardcoded
- Floating playback: three mechanisms, not one setting (2026-08-31)
- Downloads: the state machine, and why 100% was not "done"
- A download is addressed by its source variant, not by its title
- A partial download has to be *proved* to match before it resumes (2026-08-31)
- Pressing Download is a request, not a command
- The library remembers which source actually played
- A source list has to say where it came from, and hand over its link
- The range probe was downloading the whole file
- Shipping: the box has to contain everything
- A links handle is not a page address (2026-08-27)
- "A title I saved now opens blank" (2026-08-27)
- Backing up an installation (2026-08-27)
- Settings: a level, not an Advanced tab (2026-08-31)
- Settings (2026-08-27)
- Seven IPC channels were strings that had stopped matching (2026-08-27)
- Lifecycle: closing a window is not quitting (2026-08-27)
- Navigation, shortcuts and the menu (2026-08-27)
- `aria2` was pinned to port 6800 and told nobody when it failed (2026-08-27)
- The font was fetched from Google on every launch (2026-08-27)
- Licensing (2026-08-27)
- Shared renderer primitives added in the same pass

---

### The window took three seconds, and none of it was the app's own code (2026-09-21)

Reported as: slow to start, and Windows marks it **Not Responding** for a few
seconds during launch. Measured rather than reasoned about, and every obvious
explanation was wrong — the provider warm-up, the torrent client and the
bootstrap were already deferred (see the section above), and none of them was
on the path.

The cost was **before `app.whenReady()` ever resolved.** Every `import` in
`main.ts` is evaluated first, with no message pump running, and four
third-party packages sat in that graph for features nobody had asked for yet:

| Evaluated before the window existed | warm | cold |
|---|---|---|
| `webtorrent` (+ `node-datachannel`, `utp-native`, `bittorrent-dht`) | 604ms | **2762ms** |
| `cheerio` (+ parse5, css-select, htmlparser2) | 242ms | **1740ms** |
| `fast-xml-parser` | 43ms | 710ms |
| `chardet` | 16ms | 16ms |
| 17.4MB of synchronous JSON read + parse across 9 stores | 87ms | far worse |
| `refreshFfmpegOptionSupport()` — two child processes, from a top-level call | — | **4654ms** |

That is the "Not Responding" window, exactly: Windows reports a process
unresponsive when it stops pumping messages, and none of the above can be
interrupted by anything.

**Measured end to end, spawn to a visible top-level window**, same machine,
same seeded 7.10MB profile, `MainWindowHandle` polled from PowerShell:

```
before   3128 3013 4563 2937 3013 3982 2919   median 3013ms
after    2713 1662 1546 2425 1754 1706 1692 1546 1803   median 1706ms
```

Five changes, and the first three are the whole of it:

- **Every heavy package is behind the feature that needs it.** `webtorrent`
  resolves in `listenOn`, where the client was already being constructed;
  `cheerio` in the three scrapers, all already behind an awaited fetch;
  `fast-xml-parser` through `lazyXmlParser` in `indexers/base.ts`, because the
  two call sites need different options and only the loading is shared. Each
  loader is deduped — a search fans out across adapters at once, and three
  concurrent evaluations of the parse5 graph is the expensive half paid three
  times. `chardet` is a lazy `createRequire`, not an `await import`: its caller
  is synchronous with half a dozen callers of its own, and 16ms does not buy
  turning the subtitle path async.
- **`DatastoreManager` stopped writing 7.1MB synchronously on every setter.**
  Measured on the development install: 52 keys, of which `source_cache_v1` is
  3.18MB and `media_history_events_v1` 2.15MB, and `save()` was
  `writeFileSync(JSON.stringify(everything, null, 2))` called from `setString`,
  `setBool` and `setInt` — ~29ms of serialisation plus the write, for one
  `setBool`. Now coalesced on 250ms and written temp-file-plus-rename, which
  also fixes something that was already true: a 7MB write interrupted by a
  crash left a truncated file, and a truncated datastore is every preference,
  the whole library and the watch history. This was the store that never went
  through `util/jsonFileStore.ts` when five others did.
- **The debugging-exhaust stores hydrate on first use.** `DiagnosticsLog`
  (5.53MB) and `PageSnapshotStore` (1.10MB) both read and parsed in their
  constructors, which run at module scope. Every entry point calls the
  hydrator, **including the write-only ones** — hydrating after a record had
  been appended would replace the live array with the file's copy and lose it.
- **The ad-hoc warm-up timers became a queue.** `util/startupQueue.ts`: tasks
  declare a priority, run one at a time with the loop given a turn between
  each, and a failure is retried on a backoff and then recorded without
  stopping anything behind it. The delays were previously the *only* thing
  keeping a JVM class-load pass, a DHT bootstrap and two ffmpeg probes off each
  other, and a delay is a guess about how long the task before it takes.
  **Serial is the default and that is not conservatism** — provider loading
  cannot be parallelised (§5), so a queue that ran everything concurrently
  would reintroduce the 176-mis-attributed-providers defect by default.
- **The renderer stopped shipping as one chunk.** 2.11MB of JS had to be parsed
  and evaluated before the first paint, and the window waits on `ready-to-show`
  — so the two media libraries, the 4,152-line player, `shaka-player`,
  `hls.js`, the extensions manager and the settings screen were all in front of
  a home screen that uses none of them. `React.lazy` per route, one `Suspense`
  inside `<main>` so the sidebar stays live, and `manualChunks` for the three
  big libraries: **first-paint JS 2061kB → 311kB.**

Two things found by writing the tests, both of which had shipped broken:

- **Stall attribution never worked for a synchronous stage.** A stage opens,
  blocks and closes inside one turn of the loop, so by the time the monitor's
  timer can run there is nothing open to blame and every stall reported `null`.
  `enteredSinceTick` is what names it. A list of freezes with no owner is what
  the app already had.
- **A named lane was held behind the serial one, in both directions.** The
  first `drain()` asked whether *anything* was busy before starting a serial
  task and broke out of the loop after starting one. Every lane is simply asked
  whether it is free now, including the default one.

Rules that came out of it, in §12. The one worth repeating here: **`bun run
test reachability` does not catch a heavy module-scope import.** Nothing did.
Walk the static graph from `main.ts` and look at what is in it.

### A component built and never mounted (2026-08-31)

`ExtensionUpdates` — check, update one, update all, the auto-update policy, live
progress from the `extension:update*` events — was imported by nothing. Every
channel it needs was registered in `main.ts` and exposed in `preload.ts`, so
`ipcSurface.test.mts` was perfectly satisfied: **the IPC surface agreed with
itself and simply had no caller.**

That is the third direction this same failure has arrived from — a channel
invoked and never registered, a channel registered and never invoked, and now a
component built and never mounted. All three are invisible to `tsc` and to every
other test, and all three look identical to a user: a feature that exists and
cannot be reached.

`src/componentReachability.test.mts` closes it lexically, and is verified by
mutation. Three further orphans are allow-listed **with the component that
superseded each** (`MediaComponentsCard` and `RuntimeProvisionerCard` by
`UnifiedComponentManager`, `ProviderSelector` by `SearchScopePicker`), because an
allow-list without reasons becomes precedent for the next one. A second case
fails on a stale entry, so an entry that gets wired up has to be removed.

### Cards remember what already happened to them (2026-09-18)

PRD-46. Every surface draws the same `PosterCard`, and each one used to decide
for itself what to put on it -- search passed an outcome, Continue Watching
passed a percentage, everything else passed nothing. The same film was a
different card depending on which screen you found it on, and a viewer cannot
learn a language that changes between rooms.

`cs3/titleInteractions.ts` is **a join, not a sixth store**. Watch progress is in
`libraryStore`, what happened last time is in `titleOutcomes`, transfers are in
`downloadService`, resolvable links are in `sourceCache`. It owns exactly one
fact nobody else has -- that a details page was opened -- and reads the rest live.

- **Visits could not be derived from `PageSnapshotStore`.** That keeps a *copy of
  the page*, so it is capped; a title would stop being marked visited because a
  few hundred others were opened after it, in an order nobody could explain.
- **Two keys, and both are needed.** `canonicalKey(title, year)` for everything
  about the work -- watched, downloaded, how far through. The *address* for
  everything about one source of it. Folding the second onto the first would mark
  every copy of a film failed because one scraper's page was dead.
- **Failure is always marked, success almost never is.** A tick on everything
  that ever worked is decoration on every card in the library.
- **A failure the viewer has disproved is retired** (`cardState.ts`): watch
  progress newer than the failure, or a completed download, clears the badge.
  PRD-46 section 9 -- the indicator is the latest state, not a permanent verdict.
- **`visited` is a dimming, never a badge**, so it can be true at the same time
  as any other state without competing for the one corner. The poster and the
  title fade; the badge does not, because the reason to notice a visited card is
  usually the badge on it.

### Standard mode, and where the app was narrating itself (2026-09-18)

PRD-47. `src/utils/experienceMode.ts` and its context already existed; what was
missing was the sweep. Now behind developer mode: the transformation plan drawn
over a playing film (`capability.explanation`), the swarm and peer readouts, the
failover attempt list, source ranking scores with their reasons, the codec
columns in a source row and in the library's stored sources, the full
`repository > extension > provider` chain (standard mode shows the provider
alone, via `providerLabel`), and the provider inspector including its F12
shortcut.

Rules:

- **Loading stages are reworded, not removed.** "Connecting to the swarm" becomes
  "Starting playback"; "Searched 7 of 19 indexers" becomes "Checked 7 of 19
  places". The climbing count stays in both, because it is what says the app is
  working rather than stuck.
- **Errors keep their original text**, demoted rather than discarded:
  `plainMessage` gives a viewer a sentence, and developer mode shows the original.
- **The Developer mode row in Settings is deliberately `basic` level.** Every
  other row on that tab is held back in standard mode; if this one were too, the
  only way to turn it on would be a two-word toolbar toggle with no statement of
  what it does.
- **The F12 shortcut is gated with the button it duplicates**, and reads the mode
  through a ref -- the listener is installed once, so closing over the mount-time
  value would leave the shortcut dead until the next reload.

### The second pass: the screens PRD-47 did not reach (2026-09-19)

The sweep above covered the player, the source lists and the library and stopped
at the two screens with the densest jargon in the product. The extensions screen
was **entirely unswept** -- it is the app's own build vocabulary rendered as a
UI, and it is also the screen a new user is sent to first.

Now behind the same one switch, with nothing removed:

| Surface | Standard mode | Developer mode |
|---|---|---|
| `CompatibilityReport` | one verdict -- "Should work", and why | the score, confidence, tier, format, Android API references, network stack, HTML parser, native libs, analyser details |
| `ProvenancePanel` | maintainers, content, version, size, project page | those plus internal id, SHA-256 and the raw catalogue URL |
| `ExtensionCatalog` | "Will it work?" | "Check compatibility" |
| `SearchView` progress | the bar, the count, "N failed" | plus which source answered last and each failure's exception text |
| `SearchView` failure | `plainMessage`, original one click away | the original, already open |
| `ProviderRankingPanel` | score, band, sample count, pin/never-use, **every privacy control** | plus the weighted criteria, their sliders, the per-criterion breakdown and the source's repository |
| `SourceSettings` | "the places searched when an add-on has nothing" | the indexer paragraph, the named sites, Jackett/Prowlarr |

Rules, beyond the four above:

- **`compatibilityVerdict.ts` reads the score; it never re-derives one.** Pure and
  tested, for `providerHealth.ts`'s reason -- a second opinion computed at the UI
  is how a panel and its own summary come to disagree in front of one person. The
  80/50 boundaries are `CompatibilityReport`'s existing badge thresholds, kept
  rather than re-chosen for the same reason.
- **`Unsupported` is an absence of evidence, not the bottom of the scale.** Its
  score is 0 by default rather than by measurement, and the cross-platform jar
  lane spent a release being reported as exactly that -- `Unsupported`, 0% --
  for the one lane that needs no translation at all. It answers `unknown`.
- **Nothing tells a viewer an extension *will* work.** The analyser reads the
  archive and never runs it, so a perfect score and a dead site are identical
  from where it stands. Every band hedges; a test enforces it.
- **A privacy control is never held back.** `ProviderRankingPanel` carries what is
  collected and the button that erases it, and those stay in both modes. Gating
  the whole panel was the obvious move and it would have put a data control
  behind a jargon filter, which is the one thing this level must not do. The
  same argument keeps pin/never-use visible: they are choices, not workings.
- **Jargon with no technical counterpart is reworded once, not branched.** "Delete
  its archive", "No providers registered", "declares upstream's NSFW content
  type" have no audience that needs the original, so they are simply fixed. A
  mode branch is for content a developer genuinely wants back.

### The mini player: the `<video>` element is never remounted

Minimising is a **geometry change to an element that stays mounted** — the same node, in the
same place in the tree, with `player--mini` and an inline position. That is not an
implementation detail. The `<video>` *is* the playback: unmount it and the stream stops, the
position is lost and the swarm is renegotiated. Anything that recreates the element to change
its size has broken the feature it was trying to add.

What that buys, and what it costs:

- **Full chrome is hidden with CSS, not conditionally rendered.** Unmounting the controls
  would unmount their state — open panels, scroll positions, the source list — and restoring
  the player would drop all of it. The mini window gets its own much smaller control set,
  because at 420px the real seek bar and eleven buttons are unusable.
- **Keyboard shortcuts are disarmed in mini exactly as in hidden**, and it matters *more*
  here: the window is visible, so it looks focused, while the whole point is that the viewer
  is typing somewhere else. A space bar in the search box must not pause the film.
- **The drag/resize gesture is owned rather than delegated to `resize: both`**, which cannot
  hold an aspect ratio and puts its handle in the bottom-right corner — precisely where a
  window parked in the corner of the screen is against the edge. The resize handle is
  top-left for that reason. See `useMiniFrame`, which also clamps on window resize: a player
  parked at the right edge of a maximised window is unreachable once it is restored, because
  the part that has gone off screen is the drag handle.

`MiniPlayerBar` remains for the `hidden` state, but every path in the app now minimises
instead. Stepping out to Downloads used to blank the video and leave a bar saying it was
still playing, which is a strange thing to tell someone about a film they were watching a
second ago.

### The home screen is discovered, not hardcoded

It ran three fixed searches — `Spider-Man`, `One Piece`, `Stranger Things` — against every
installed provider and called the result "Trending". The obvious problem is that the front
page never changed. The real one is that **a site scraper has no opinion about what is
popular**, so the label was a category error, and it cost the slowest scraper's timeout on
every launch.

`cs3/discovery.ts` answers from catalogue services instead. The binding constraint was that
**the user must not have to obtain an API key**, which eliminated TMDB, Trakt, OMDb, Fanart
and TheTVDB outright — a key embedded in a distributed client is both a licence violation and
a key that gets revoked. What survives:

- `cinemeta-catalogs.strem.io/{top,year,imdbRating}/catalog/{movie,series}/…` — keyless,
  IMDb-keyed, filterable by 19 genres, pageable with `skip`. Its popularity numbers come from
  Trakt and TMDB, so the ordering reflects the same signal the keyed services sell.
- AniList's public GraphQL for seasonal anime. Kept separate from the Animation genre on
  purpose: "Animation" on IMDb is mostly Western film, and an anime row built from it returns
  Pixar.

Two behaviours are load-bearing. **Stale-while-revalidate, with the "while" doing the work**:
cached sections render instantly and are replaced a second later, so the page never shows a
spinner after the first launch and still works offline. And **discovery finds nothing
playable** — items are addressed by IMDb id and sources are resolved by the providers when
one is opened. Keeping that boundary is what lets the page be fast and current at once.

Personalised rows come from genres counted out of the local library. Nothing about the user
leaves the machine: the genre picks which public catalogue URL to fetch, and the catalogue is
not told who asked.

### Floating playback: three mechanisms, not one setting (2026-08-31)

Minimising meant one thing — a small window inside the app — which stops being
useful the moment CloudStream is not the front window, which is exactly when
someone minimises a film. There are four modes now (`mini`, `floating`, `pip`,
`background`) and they are a **choice rather than a scale**, because they use
different mechanisms with different reach:

| Mechanism | Moves | Works when |
|---|---|---|
| In-app mini window | nothing — a CSS geometry change | always, while this app is the front window |
| Native Picture-in-Picture | the `<video>` element's rendering surface, to an OS window | only while the element is what is playing |
| App window always-on-top | a window level | always, whatever is inside the window |
| mpv `ontop` | a window level | only while the native engine holds the stream |

**The middle row is why this is not simply "pin the window".** PiP is what people
mean by "like Chrome" — a real OS window with the system's own controls,
resizable, above full-screen applications. It is also unavailable for exactly
the content this app most often plays: a stream routed to mpv renders in mpv's
window and a handoff to VLC renders in VLC's, and neither has an element to
detach. So PiP is offered where it can work (`isPipSupported` checks the
document, the element's `readyState` **and** that the native engine is not
holding the stream) and the window pin is what makes the feature exist for a
torrent stream or a 4K HEVC file.

Things that will bite:

- **The element is never remounted, in any mode.** Same rule as the in-app mini
  player and the same reason: recreating it ends the stream, loses the position
  and renegotiates the swarm. Audio-only hides the picture with `visibility`
  rather than `display`, because an element removed from layout loses its
  surface and some builds treat that as a reason to stop decoding — which would
  silence the audio the mode exists to keep.
- **The pin unapplies itself on unmount.** Leaving the app above every other
  window after the player closed is invisible, survives navigation, and is
  undone only by a control inside a player that no longer exists.
- **`audio-only` is asymmetric and says so.** On the native engine it sets
  `vid=no` and genuinely stops decoding — real work saved on a 4K file. On the
  element there is nothing equivalent: an offscreen element keeps decoding what
  it was given, and re-negotiating the source to a track-less stream would be a
  far larger change than the setting is worth. The setting's own help text
  states this rather than implying a saving that is not there.
- **The Media Session record is set, or a PiP window's own buttons are dead
  chrome.** A native PiP window draws play/pause and next/previous and wires
  them to `navigator.mediaSession` action handlers; the OS uses the same record
  for the keyboard's media keys. They are wired to the same `togglePlay` /
  `seekTo` the on-screen controls use, so two sets of controls cannot disagree
  about whether the film is paused.
- **PiP is asked for, never assumed.** `requestPictureInPicture` rejects for
  several ordinary reasons — no metadata yet, no gesture, a platform without it
  — and every one of them looks identical from outside: a button that does
  nothing. The rejection is reported as a sentence.

The mini player also gained a real scrubber on its own row, a volume slider and
the provider name. A mini window is where a source is most likely to fail
unattended, and "it stopped" is only actionable if the row says whose it was.

### Downloads: the state machine, and why 100% was not "done"

**aria2 says `complete`, not `completed`.** `Aria2Progress.status` declared the latter and
`getStatus` passes `raw.status` straight through, so the comparison in `pollAria2Tasks`
could never be true. Every finished aria2 transfer sat at 100% in `Downloading` for the life
of the session, and its gid was never released, so the poller kept asking about it forever.
Verified against a live aria2 daemon: `tellStatus` answers `"active"`, then `"complete"`.
`removed` and `paused` were unhandled too — each a second way for a task to stick with no
poll left that could change it.

**Completion is now verified rather than reported.** All three engines route through
`finalizeCompletion`, because "the engine finished" and "there is a playable file" are
different claims and a download list that reports the second knowing only the first is
worthless. It requires: the target exists, no unfinalised `.part` remains beside it, and the
size agrees with expectations where any exist — 1% tolerance, since plenty of sources send
no `Content-Length` and a strict test would fail every one of them. Anything else is
`Failed` **with the reason**, which is retryable.

**Delete is two actions.** `remove(id, deleteFile)` — removing a finished film from the list
and erasing it from disk are unrecoverably different, so the caller decides and
`DeleteDownloadDialog` asks. The "remember my choice" box is off by default (a preference
learned from one click is one nobody knows they set) and Settings → Downloads can put the
prompt back, because a preference settable only inside a dialog you opted out of seeing
cannot otherwise be undone.

### A download is addressed by its source variant, not by its title

Reported as: downloading *The Incredible Hulk* in 2160p and then asking for the 1080p
release answered `Already downloading` and did nothing. Two independent mistakes about
identity sat underneath it, and each would have been enough on its own.

**Duplicate detection matched on the title, by prefix.** `VideoPlayer`'s `currentDownload`
did `norm(t.title).startsWith(norm(title))`, plus a shared `mediaUrl` and a substring test
on the task id. Every release of one film satisfies all three, so a viewer could hold
exactly one copy of a title no matter which source produced it — and the progress badge in
the player showed whichever transfer happened to be first in the queue.

**And the target path was derived from the title too**, so allowing two to start would
merely have moved the collision onto the disk: `Movies/The Incredible Hulk/The Incredible
Hulk.mp4` for both, two engines interleaving bytes into one file, and both reporting
success. A corrupt file that finishes is worse than a refusal.

`src/utils/downloadIdentity.ts` owns the rule, and it is pure and tested because both
halves fail *silently* and in opposite directions:

| Too coarse | Too fine |
|---|---|
| The 1080p release is refused as a duplicate of the 2160p one | Every recovery starts a second download of bytes already on disk |
| Visible, and reads as a broken button | Invisible, and reads as working |

**The key has to be durable, not merely unique** — which is the same problem
`cs3/playedSource.ts` solves for resuming, and it is solved the same way. A provider
stream's `infoHash` is *synthesised* by `ContentService` from its URL, so a re-resolved link
is a different id for a byte-identical file; keying on it produces the right-hand column
above. So torrents key on their real infohash and everything else keys on the durable
description: media + season + episode + provider + release name + resolution + quality +
language + audio.

Four things follow, and each is load-bearing:

- **The provider is stored, not the extractor.** `indexerName` on an extension link is the
  file host the provider picked ("Voe", "Server 3") and it changes between resolves of one
  release. Two of the four call sites that built tasks stored it as `providerName` and two
  stored the provider — which is also why `findMatchingSource`'s tier-1 match so often
  missed.
- **Recovery matches the variant key first, and is resolution-bound after that.** Its last
  tier used to `return directSources[0]` unconditionally, so a failed 2160p download could
  be silently rebound to an unrelated 480p rip, written into the folder labelled 2160p and
  reported as complete. A task that finds nothing of its own resolution is now left
  `Failed` with its reason.
- **The target path carries the variant** (`Movies/<Title>/2160p · WEB-DL · Gdshine/…`).
  `variantPathSegment` keeps it readable — this is a folder a person opens — so it can
  collide between two releases from one provider at one resolution; `DownloadService`
  resolves that at enqueue time with a numbered suffix, because only it can see the rest of
  the queue.
- **The batch downloader stamped its batch id into `providerName`** (`Gdshine
  (batch-1755…)`). Nothing read it, and two things that do read that field broke: recovery
  never matched a provider, and the identity changed on every run — so re-running a season
  queued a second copy of every episode already in it.

### A partial download has to be *proved* to match before it resumes (2026-08-31)

Provider links are signed and short-lived, so a 4 GB film routinely outlives the
URL serving it. `DownloadService` re-resolves the release and gets a different
address for what is usually the same content — and then has to decide whether
the partial file beside it is still the beginning of what that address will
send.

The old answer compared the provider's *declared* size against the task's and
restarted when they differed by more than 20%. Both halves are wrong and they
compound:

- Declared sizes are frequently absent, and with none **the check did not run at
  all** — the partial was appended to unconditionally.
- **20% is enormous.** Two encodes of one film at one resolution differ by far
  less, so appending the tail of encode B to the head of encode A produced a
  file that finalised, reported success, and did not play. A corrupt download
  that completes is worse than one that restarts, because nothing says it
  happened; the viewer finds out when they sit down to watch.

It is proved now. **One ranged request for the 64 KB window ending at the resume
point answers all three questions at once**: `206` proves the server honours
Range, `Content-Range: …/total` gives the real file length, and the body
compares byte for byte against the tail of the `.part`. That is 64 KB against a
multi-gigabyte transfer, and it turns "these look similar" into "these are the
same file up to this offset".

`download/resumePlan.ts` is the decision and is pure. Ordered cheapest-first:
identity (provider, resolution, container) before anything that costs a request,
then exact size equality, then Range support, then the byte comparison. Notes:

- **`sameResolution` reads `parsed.resolution`**, matching `findMatchingSource`.
  A resolution the release name did not state is "no opinion" — most direct
  provider links carry no release name, and treating that as a difference would
  refuse every resume.
- **`containersAgree` only ever rejects on positive disagreement.** Most provider
  links are `?id=…` with no extension, and a container check that refused those
  would refuse nearly every resume — which is how a safety check comes to be
  switched off wholesale.
- **`no-range` is its own cause.** It is the one restart where nothing is wrong
  with either file, and the honest thing to say is that this server sends the
  whole file every time. Checked *after* the size arithmetic, so a real mismatch
  gets the message it deserves.
- **An unreadable window restarts.** A failed comparison is not evidence of a
  match; defaulting it to `true` would put the corruption back with a safety
  check standing in front of it.

`download/resumeWindow.ts` is the socket half, tested against real servers
because everything worth catching lives in the seam. **The `res.resume()` trap
appears here for the third time in this repository** — it discards data and
leaves the transfer running — so both the response and the request are
destroyed. That regression test is verified by mutation, and its first draft was
worthless: it asserted the probe *resolved* quickly, which is true with the bug
present. It asserts the connection tears down now.

Only `restart` is acted on in `markFailed`. `resume` is the default (every engine
continues from a `.part`) and `complete` is carried by machinery that already
exists — the transfer asks for `bytes=N-`, the server answers `416`, and
`httpDownloader` finalises rather than erroring; aria2 routes its own range
errors to that same downloader. Adding a rename there would bypass
`finalizeCompletion`, which is the only thing that checks the file is present and
the right size before claiming success.

### Pressing Download is a request, not a command

The other half of the same report. Every press on a title with any entry in the list
answered `Already downloading`, including when that entry was paused (left paused), had
failed (told to go and find the download panel), or had had its file deleted.

`download:request` → `DownloadService.request` answers from the task's actual state and
returns which of six things it did, so the renderer no longer phrases the outcome from a
list it matched itself:

| State | What a press does |
|---|---|
| `Downloading` / `Retrying` / `RefreshingSource` | nothing, and says so |
| `Queued` | nothing; says it starts when a slot frees |
| `Paused` — including every task after a restart, which `loadQueueFromStorage` parks there | resumes |
| `Failed` | recovers: clears the retry budget, re-resolves the source, retries |
| `Completed` | reports it — **after checking the file is still there**, and re-downloading if it is not |
| nothing yet | starts one |

`Completed` is checked against the filesystem rather than trusted because it is a claim
about a file: a download whose file the viewer has since deleted or moved must be startable
again, and reporting it as finished leaves the only useful action unavailable with the
reason invisible.

### The library remembers which source actually played

The library remembered *what* was watched and `bookmarkStore` remembered *which page* it
came from. Neither remembered **which of thirty sources delivered it**, so returning to a
title meant picking from the list again with nothing recording that the fourth row down is
the only one that ever produced a frame.

`PlayedSource` (in `src/types/library.ts`, stored by `libraryStore`) is one slot per
(title, season, episode) — per episode, because keying on the title alone would have episode
6 overwrite what played episode 5. It holds the full `StoredSource` (provider, repository,
extension, quality, capabilities, the link and its deadline) plus an `origin` query.

**The link is stored but is never the identity.** A provider URL is a signed address on
someone else's CDN, good for minutes; the durable half is `origin`, which is replayed to get
a fresh link for the same release. That is why both are there.

**It is recorded on playback, not on selection.** `SourceMemory` already covers "what the
viewer picked", and the two are different claims — a release chosen and then abandoned
because it would not start is not one that works. `VideoPlayer` records after **10 seconds**
of real playback, which is past every failure that presents as "it started and then stopped".

`library:resolvePlayedSource` returns one of three outcomes, and the caller is told which
because they mean different things:

- `reused` — the stored link still holds; no provider contacted.
- `refreshed` — it had expired, so the same release was re-resolved and the record updated
  in place. Surfaced in the UI, because it explains the pause the viewer just sat through.
- `unavailable` — the provider no longer offers it. The record is **marked, not deleted**
  ("the one that used to work is gone" beats an entry that silently vanishes) and the
  alternatives come back so it is a choice rather than a dead end.

#### Matching a saved source after its link dies

`cs3/playedSource.ts`, and the reason it is its own tested module: **a provider source has
no durable id.** Torrents do — an infohash addresses content. A provider stream's
`infoHash` is *synthesised* by `ContentService` as the SHA-1 of its URL, purely so the
ranker and the dedupe key have something to work with. Re-resolve that release an hour later,
get a freshly signed URL, and the id is different for the identical file. **Matching on it
alone can never re-find a provider source, which is the case this feature exists for.**

So: torrents match on infohash; everything else matches on the durable triple — provider,
normalised release name, resolution. Strict on purpose, because returning the wrong release
is worse than returning nothing: the viewer asked to resume *this* stream, and quietly
starting a different cut, dub or a 480p rip is a failure they will attribute to the app
losing their place. The one concession is containment in either direction, since providers
append and drop decorations (a size, a mirror name, `[Dual Audio]`) between refreshes.

A direct link with **no recorded deadline is treated as expired**, deliberately. The costs
are asymmetric: guessing "still good" spends the ffmpeg startup and the player's timeout
before failing over, while guessing "expired" costs one provider call and produces a stream
that works.

Pinned by `cs3/playedSource.test.mts` (12 cases), including that a provider source is
re-found despite its synthetic id changing, and that nothing matching returns null rather
than a nearby release.

### A source list has to say where it came from, and hand over its link

The in-player list and the detail page both showed a release name, a size, a
seeder count and `indexerName`. For an extension link **`indexerName` is the
extractor** — "Gdshine", "Voe", "Server 3" — a file host the provider picked. It
is not the provider, so a source that started failing could not be traced to
whose code or whose repository to turn off, which is the only action a user can
actually take. Both lists now carry the `repository ▸ extension ▸ provider`
chain beside the host, resolved through `api:getProviderProvenanceMap` — batched
because a thirty-row list asking one at a time is thirty IPC round trips to read
one in-memory Map.

`src/utils/sourceExport.ts` is the shared format, used by the in-player panel,
the detail page and the player's copy menu. **CSV is the default**: the useful
operation on thirty sources is sorting and filtering them, and every machine
already has something that does that. Text and links-only are the other two
destinations — a chat window, and a downloader that wants one URL per line.

**The exported address is always the provider's, never the loopback one.** By
the time a stream is playing its URL is `http://127.0.0.1:<ephemeral>/…`, which
names our own proxy and is dead when the app closes — a link that *looks* like
it should work in a downloader and cannot. `sourceAddress` is the only way to
get it, and `sourceExport.test.mts` (13 cases) pins that along with RFC 4180
quoting, which matters more than it looks: a release called `Dune, Part Two`
does not break an unquoted CSV, it silently shifts every later column by one and
produces a spreadsheet of plausible rows with every link attributed to the wrong
provider.

### The range probe was downloading the whole file

Reported as a stalled download: `Babe Beach`, 4K HDHUB, **2 MB of 5.75 GB at 0 KB/s**. The
link was alive and the source was fine.

`FastChunkDownloader.probeUrl` asks for `bytes=0-0`, reads the headers, and called
`res.resume()` before resolving. `resume()` discards the data — it does not stop the
transfer. Against a server that honours Range that is harmless, because the body is one
byte. Against a server that **ignores** Range it is not, and
`video-downloads.googleusercontent.com` ignores it: measured on the reported link, it
answers `200` with no `Accept-Ranges` and `Content-Length: 6,175,245,105`, so the probe kept
pulling the file after it had already returned its answer — **5.6 MB in the five seconds
after resolving, and still going.** The real download then ran beside it, competing for the
same throttled signed URL. A few megabytes, then nothing.

The probe now destroys the response and the request once it has the headers. Verified
against the same URL: 0 bytes after resolving, where the old code reached 5.6 MB.

Two things worth keeping straight while you are in there:

- **`supportsRange` was never wrong.** It reads `206` or `Accept-Ranges: bytes`, and this
  host offers neither, so `canParallelize` was already false and the sequential path was
  already chosen. The bug was entirely in the abandoned probe connection — which is why it
  looked like a network problem rather than a downloader one.
- **A chunk worker used to accept `200`.** If a host changes its mind between the probe and
  the transfer — signed-URL CDNs do this under load — a ranged request answered with `200`
  is the whole file from byte zero, and writing it at that chunk's offset corrupts the
  output while every worker downloads the entire file. It now fails the chunk with a reason.
  A corrupt file that finishes is worse than a download that says why it stopped.

Unrelated but reported alongside it: a `RefreshingSource` retry on a
`googleusercontent.com` link is usually **correct behaviour, not a bug**. Those URLs are
signed and short-lived; the second reported link answered `HTTP 400` outright, and
re-resolving it from the provider is the only thing that can help.

### Shipping: the box has to contain everything

The target user has used Netflix and has not used a plugin manager. They install
one thing and they stream. Two consequences, both structural:

**The JVM ships inside the app.** `electron-builder` used to package `dist/`,
`dist-electron/` and `node_modules/` and *nothing else* — no sidecar jar, no
provider classpath, no Java — so a packaged build had no extension capability at
all, and no amount of correct runtime code would have changed that.
`tools/package/build-runtime.mjs` assembles `sidecar/dist/` (sidecar + `lib/` +
`runtime/` + a jlinked JRE, ~90 MB) and `extraResources` copies it to
`resources/sidecar/`, which is exactly where `SidecarSupervisor` looks when
`app.isPackaged`.

The jlink module list is curated rather than `ALL-MODULE-PATH`, and the entries
that look optional are the ones that bite: `jdk.crypto.ec` (ECDHE — without it
TLS fails against most sites, one provider at a time), `jdk.unsupported`
(`sun.misc.Unsafe`, reached by coroutines/OkHttp/Jackson), `jdk.localedata` (a
multilingual corpus parsing dates under a C locale silently returns nothing),
`java.sql` (Jackson resolves `java.sql.Date` reflectively). Verify a change to
that list by running the corpus against the linked runtime, not by checking that
the build succeeded:

```
node tools/package/build-runtime.mjs --verify
node tools/e2e/provider-e2e.mjs --java sidecar/dist/jre/bin/java.exe
```

**First launch installs the verified repositories itself** (`cs3/bootstrap.ts`),
in the background, with progress — an app that opens to an empty home screen
until you find the extensions tab and install plugins one at a time has shipped a
construction kit, not a product. It runs once (`BOOTSTRAP_VERSION`), caps at
`PLUGINS_PER_REPOSITORY` because ~170 archives means ~170 DEX translations before
the first search, and never blocks: the catalogues and indexers answer normally
while providers arrive. Repositories opt in via `bundled: true`, which is a claim
that `tools/e2e/provider-e2e.mjs` has driven them end-to-end.

### A links handle is not a page address (2026-08-27)

The single most frequent failure in a user's captured session, and it named the wrong party
every time:

```
VegaMovies: IllegalArgumentException: Expected URL scheme 'http' or 'https'
            but no scheme was found for [{"sou...
  url: cs3ext://VegaMovies/[{"source":"https://vcloud.fit/ubvtmxgdjbx1xxu"}, …]
```

Upstream's `MainAPI` has **two kinds of handle and they are not interchangeable**. `load(url)`
takes a page address and fetches it. `loadLinks(data)` takes an opaque blob the provider built
for itself — and a large part of the corpus puts JSON in it (VegaMovies an array of objects,
HDHub4U an array of strings). Both are `String`, so nothing in the type system separates them,
and `cs3ext://<provider>/<handle>` does not record which kind it is carrying.

Handing a links blob to `load()` reaches OkHttp's `HttpUrl.get`. The throw was recorded at
stage `detail`, **scored against the provider by the ranking**, and shown to the viewer as the
reason their title would not play. The provider was fine and the call should never have been
made.

It reached `load()` from three directions, which is why the guard is one shared predicate
(`cs3/extensionAddress.ts`, `looksLikeLinksHandle`) rather than three local checks:

1. **`resolveExtensionTarget`** looked up an episode list for any address carrying an episode
   number — including one that already *was* the episode, which is what Continue Watching
   hands over.
2. **`extensionSources`** retried through `dataUrl` whenever the first attempt found no links,
   without asking whether the address it had could be opened — **and did not catch the
   throw**, so OkHttp's message replaced the real diagnosis and rejected the whole discovery.
3. **`DetailView`** was handed a playback handle as an item URL. See below.

The test is deliberately narrow: JSON is definitely not a page, anything else might be.
Internet Archive's `load()` takes `https://archive.org/details/<id>` while its `loadLinks`
takes the bare id, so "must start with http" would refuse pages that work.

### "A title I saved now opens blank" (2026-08-27)

The same root cause, persisted. `DetailView` recorded `progress.mediaUrl` as
`episode?.url ?? detail.url` — and `episode.url` is the **playback handle**. That address went
into the library, Continue Watching and any page saved from one of those rows; clicking the row
later called `load()` on it and the detail page came up empty. It reads as data rot, and it is
not: it is the wrong address having been written, and it only ever manifests on the *second*
route to a title.

**Nothing is lost by storing the page instead.** `libraryStore.recordProgress` keys on
`canonicalKey(title, year)` plus season and episode — not on `mediaUrl` — so no progress record
is orphaned by the change, and the season and episode travel in their own fields. The handle
that actually plays is still `request.mediaUrl`.

Rows written before the fix cannot be repaired: the page address is not recoverable from a
links blob. What *is* stored beside them is the title, so the failure screen now offers
**"Find <title> again"**, which is the only thing that turns a permanently dead row back into a
working page.

### Backing up an installation (2026-08-27)

`electron/cs3/backupService.ts`. There were two exports before it and neither answered the
question: `datastore:exportBackup` writes the **Android** format for moving between the phone
app and this one, and library/history each exported themselves — so moving to a new machine
lost the repositories, the extensions switched off, the saved pages and the indexer
configuration.

**Sections are a table, not two switch statements.** A store added to the export and forgotten
in the restore produces a file that looks complete and silently drops those rows on the way
back; one entry cannot be half-added. An export-only section (the download queue) is reported
as `export only` rather than as a restore of zero, so the two are distinguishable.

Deliberately absent, each for its own reason: the `.cs3` archives and downloaded media (large,
re-fetchable — the backup records *which*, which is the part that cannot be); tokens and device
ids (filtered by `DatastoreManager.snapshot` on the way **out**, so they are never written into
a file in someone's Downloads folder); diagnostics and logs (they describe the machine captured,
not the one restored to); caches (everything in them expires, and a stale cache is worse than
an empty one).

**Restore merges rather than replaces**, so a preference added since the backup was taken does
not silently revert; it snapshots the datastore first so the write can be undone; and a section
that throws is recorded while the rest still restore, because a restore that stops halfway
leaves a state neither the backup nor the previous one describes. 12 cases in
`backupService.test.mts`, including that an unrelated JSON file is refused **by its format
marker** — otherwise it would be fed to every section and answer "restored 0 rows from 9
sections" instead of "that is not a CloudStream backup".

### Settings: a level, not an Advanced tab (2026-08-31)

The screen accumulated the way settings screens do — every decision worth
exposing became a row — and the result is accurate and unusable. "Providers
searched at once", "Torrent metadata mirrors", "Native engine policy" are all
real controls with real effects and none of them means anything to somebody who
installed this to watch a film.

**The obvious fix does not work, and this screen already tried it.** Moving the
technical rows to an Advanced tab fails because "advanced" is not a category:
the technical controls are *about* the same subjects as the simple ones — how
many providers a search asks is a search setting, the probe budget is a playback
setting. Grouping by audience rather than by subject puts two halves of one topic
in two places, and the reader has to know which half they need before they can
look.

So the grouping stays by subject and a **level** filters within it.
`SettingRow` and `SettingGroup` take `level`, and a group whose rows have all
hidden themselves hides too — otherwise Simple is a page of empty headings that
reads as a failure to load.

**`advanced` means one specific thing: understanding the *label* requires
knowing how this app is built.** Not "rare" and not "dangerous". A control whose
effect a viewer can describe without that — where downloads go, subtitle size,
keep playing when I minimise — is basic however obscure it is.

Applying that test changed the answer twice, both times because
`settingsLevel.test.mts` said so. It refuses a file where over half the rows are
advanced, and it caught rows marked individually inside groups that were already
marked, and a batch of rows hidden for having jargon labels **when the labels
were the problem**. Six are renamed instead — "Detected native players" is now
"Players found on this computer" — and the toolbar-visibility rows came back,
because "show the subtitles button" needs no knowledge of anything.

Two traps in that test are worth keeping:

- Its first tag scanner used "the nearest `<` before the match", which is wrong
  the moment an attribute follows a JSX expression: in
  `<SettingGroup icon={<RefreshCw />} level="advanced">` the nearest `<` is the
  icon. It tracks brace depth now.
- The ratio has to count rows and groups separately, or a marked *group* is
  counted as a marked row and the file looks twice as filtered as it is.

**Simple is the default**, and that is the part that matters: someone opening
this screen is being asked, implicitly, which rows they should have an opinion
about, and the honest answer for most people is about eight. The switch says
what it is holding back, because a filtered list that does not admit it is
filtered is the same failure as a scoped search that does not.

Stored in `localStorage`, not the datastore: it describes how one person reads a
screen, not how the app behaves, and has no business travelling in a backup to a
machine somebody else uses. `shouldShow` lives in a plain `.ts` beside the
provider because Node's type stripping cannot load JSX and the rule is the half
worth testing — its default (**an unclassified row is basic**) is load-bearing,
since backwards it would make Simple mode silently lose every setting added from
then on.

**And splitting it that way is what blanked the whole app (2026-09-01).** The
React half was `SettingsLevel.tsx`, beside the pure `settingsLevel.ts`. On
Windows' case-insensitive filesystem those are **one name**, and module
resolution tries `.ts` before `.tsx` — so `import { useSettingsLevel } from
'./SettingsLevel'` resolved to the pure rule, which exports `shouldShow` and
neither the hook nor the provider.

The consequence is out of all proportion to the cause, and that is the part
worth remembering. A missing named export is an ESM **link** error, not a
runtime one: it does not throw inside a component where `ErrorBoundary` could
catch it and it names nothing on screen. It fails the entire `App.tsx` import
graph, so **the window comes up blank** — every view, not just Settings. The
last successful `dist/` predated the commit by three days and nothing said so,
because `vite-plugin-electron` builds main and preload as separate environments
and those two kept succeeding.

`tsc -b` and `vite build` both refuse it outright, so the tooling was never the
gap — the gap was shipping without running either. The file is
`SettingsLevelContext.tsx` now, and `componentReachability.test.mts` grew a
third case that folds every module path under `src/` and `electron/` to lower
case and requires it to stay unique. It runs inside `test:electron`, which is
what people actually run, and it is verified by mutation. **Never name a `.tsx`
and a `.ts` alike but for their casing** — on the machine it is written on, it
resolves.

### Settings (2026-08-27)

The tab bar was `overflow-x: auto` over a fixed set of eight tabs, so on an ordinary window
reaching "Advanced" meant finding and dragging a horizontal scrollbar. It wraps now, and is
sticky — because the new **All settings** view is one long page, and navigation that scrolls
away is navigation you have to scroll back up to reach.

`all` is a view, not a category: it renders exactly the same groups the tabs do, in tab order,
with a heading before each. No control is duplicated, so the two views cannot disagree.

### Seven IPC channels were strings that had stopped matching (2026-08-27)

Found by diffing the channel literals in `main.ts` against those in `preload.ts` — not by
chasing a symptom, because none of these produces an error anyone would report as an error.
`tsc` cannot see them: the channel is a string on both sides and the two files never refer to
each other. The user-visible form is always a dead button or a silent no-op.

| Channel | Was | Consequence |
|---|---|---|
| `binary:setupBinaries` | invoked, never registered | the first-run component installer **always failed** |
| `runtime:repair` | invoked, never registered | the recovery path for a broken runtime, latent |
| `discover:invalidated` | pushed, no listener | switching home catalogue left the old rows up for 6h |
| `binary:check`, `binary:setup` | registered, unreachable | duplicate spellings of live handlers |
| `extension:getRuntimeReport` | registered, unreachable | no way to say *why* an extension registered nothing |
| `media:get/setProbeConfig` | registered, unreachable | the probe budget, unreachable by the users it affects |

**`ipcRenderer.invoke` on an unregistered channel rejects — it does not return an
`{ ok: false }` envelope.** That is what made the first one invisible: `BinarySetupModal`
caught the rejection and rendered `No handler registered for 'binary:setupBinaries'` as a
friendly-sounding notice with "(HTTP fallback stream active)" after it. The user was told a
fallback was active and had no way to know the button had done nothing. **A catch that
reassures is worse than no catch.** Both halves were needed to hide it.

**`electron/ipcSurface.test.mts` now pins all four diffs** (`bun run test:ipc`, and it runs
first in `test:electron`). It is lexical rather than runtime — loading `main.ts` would boot
the whole service graph, and the strings are what matter. Verified to fail in all three
directions by mutation, because a parity test that passes trivially is worthless. Exceptions
go in the commented allow-lists at the top, and "I will wire it later" is not a reason: an
entry there is indistinguishable from a working feature to everyone who reads the code.

### Lifecycle: closing a window is not quitting (2026-08-27)

`window-all-closed` ran `downloadService.stop()`, `extensionUpdater.stop()` and
`pluginManager.shutdown()` **unconditionally**, with only `app.quit()` guarded by platform.
On macOS the app then stayed in the dock holding a dead sidecar and a stopped queue, and
`activate` opened a fresh window onto all of it — zero providers, every search empty, and
nothing on screen explaining any of it. Every teardown moved into `before-quit`, which is the
event that actually means "we are going away"; `window-all-closed` now only quits.

**Shutdown is raced against a 5s deadline.** WebTorrent's `destroy()` and an unresponsive mpv
both hang in the wild, and `before-quit` calls `preventDefault()` — so when one hung the
window was gone, the process was not, and the only recourse was Task Manager, after which the
next launch hit the locked cache directory this handler exists to prevent. Which service was
still pending is logged as `shutdown_timeout`; that is the fact that makes the next fix
possible and it costs one line. The old `if (!torrentEngine) return;` guard was dead (it is
constructed eagerly) and would have skipped mpv, external players, the WebView host and
`logger.shutdown()` if it had ever fired.

### Navigation, shortcuts and the menu (2026-08-27)

**A dropped file used to replace the app.** `setWindowOpenHandler` covers `window.open`; it
does not cover a top-level navigation, and Electron's default is to perform one. Dragging a
video onto a media player's window is the most natural gesture a user has — and with
`setApplicationMenu(null)` there was no View → Reload to get back, so the app was bricked
until relaunch. `will-navigate` and `will-frame-navigate` refuse it now, and the gesture does
the useful thing instead: the renderer's `drop` handler routes the file through
`media:prepare` like any other source. **`MediaProxy` could always serve local files
(`/local/<token>`) and the engine is source-agnostic — the capability was built and had no
entry point,** so the app could finish a download and then not play it from disk. File → Open
and drag-and-drop are both that entry point.

**F12 was bound twice and the app's own binding could never fire.** `before-input-event`
toggled DevTools *and* called `preventDefault()`, which suppresses the page keyboard event —
so `App.tsx`'s F12 handler never ran and `ProviderInspector`, which has no other entry point,
was unreachable. DevTools is `Ctrl+Shift+I` only now. **Reload is gated on `app.isPackaged`**:
`Ctrl+R` is browser muscle memory and in a packaged build it destroys the renderer — playback
stops, the open page is lost, an in-flight search is abandoned.

**`Menu.setApplicationMenu(null)` cost more than chrome.** On macOS, Cut/Copy/Paste/Select-All
are menu *roles*, not native text-field behaviour, so `Cmd+C` did nothing in the search box —
and there was no Quit, no About and no zoom reset anywhere. A real menu is back, hidden behind
Alt on Windows and Linux via `autoHideMenuBar`. It is also what makes any shortcut
discoverable at all.

### `aria2` was pinned to port 6800 and told nobody when it failed (2026-08-27)

6800 is aria2's documented default, so the people most likely to collide with it are the ones
already running aria2 — which is this app's technical audience. `stdio: 'ignore'` discarded
the reason, and `start()` returned `true` the moment `spawn` returned: **a port conflict is
not a spawn error.** aria2 starts, fails to bind and exits a few milliseconds later, so
`isRunning()` answered true for a dead process and every `addUri` after it failed with a
message about the *download*. It now probes upward from 6800 by test-binding, captures stderr,
and reports success only once the RPC actually answers (`getVersion`). `getLastError()` carries
the reason. A silent downgrade to the slow HTTP path is the failure mode this repo keeps
having to fix.

### The font was fetched from Google on every launch (2026-08-27)

`src/index.css` opened with `@import url('https://fonts.googleapis.com/…Inter…')`, so a
*packaged desktop app* sent the user's IP and User-Agent to a third party on every start —
invisibly, in an app whose users frequently run a VPN precisely to avoid that. It also failed
silently offline and hung before falling back where the host is blocked. Inter is vendored
into `src/assets/fonts/` (seven variable-font subsets, 213 KB; the non-latin ones stay because
provider titles are not English even though the interface is) and `src/assets/inter.css` is
generated from the Google CSS with the URLs rewritten. **Verify with
`grep -oE 'https://fonts[^)"]*' dist/assets/*.css` after a build — it must find nothing.** This
also unblocks a CSP, which would otherwise have to allow a third-party style and font origin.

### Licensing (2026-08-27)

The repository had **no `LICENSE` file** while being a port of a GPL-3.0 Android application,
vendoring 26 community extension repositories and bundling FFmpeg, mpv, aria2, yt-dlp and a
JRE. `LICENSE` (GPL-3.0, fetched from gnu.org rather than reproduced from memory) and
`THIRD-PARTY-NOTICES.md` now exist at the root, and `settings/AboutPanel.tsx` makes them
reachable from a *packaged* build where the repository is not — GPL-3.0 §6 asks that whoever
holds the binary can find the source. **The bundled FFmpeg builds are the GPL variants, not
LGPL**, and the notice says so; "FFmpeg" unqualified would be the kind of accurate-sounding
omission that file exists to avoid.

### Shared renderer primitives added in the same pass

- **`src/utils/useFlash.ts`** — twenty-odd call sites wrote `setToast(m); setTimeout(() => setToast(null), N)`
  with no cleanup. Two bugs: the timers **cross**, so flashing a second message two seconds
  later has the *first* timer clear it early (which reads as the app dropping a confirmation,
  exactly when someone is doing several things quickly); and every one set state after unmount,
  which these views do constantly. Durations stay per call site — they range 1500–5000 ms and
  unifying them would change what several screens do, the same argument `utils/format.ts` won.
  Note `flash` is stable but the linter cannot know that the way it knows a `useState` setter
  is, so it goes in dependency arrays.
- **`src/components/Poster.tsx`** — `PosterCard` handled a *missing* `posterUrl` and had no
  `onError`, so it handled the case that never happens and not the one that happens constantly:
  scraped poster URLs expire and 403 on hotlink checks, and the result was Chromium's broken
  image icon in the most-repeated component in the product. `HistoryView` had answered it with
  `display: none`, which is an empty bordered box instead. Each call site keeps its own
  `fallback`; flattening them to one glyph would be a worse screen, not a tidier one.
- **`src/components/EmptyState.tsx`** — every list route was one sentence of body text, so an
  empty library, an empty history and a search that found nothing were the same blank page. For
  a new user **every screen except Home is empty**, which makes this the cheapest onboarding in
  the app. The *action* is why it is a component: the search empty state now offers "Search all
  sources", which clears the stored scope and re-runs — previously reachable only by finding
  the scope picker and clearing it by hand.

Also: a global `:focus-visible` floor in `index.css` (eight `outline: none` sites, only some
with replacements — in a full-screen dark app a missed one means the keyboard user simply
loses the cursor); `prefers-reduced-motion` in `index.css`, which owns the `.spin` keyframe
every loading indicator uses and was the one stylesheet of four not honouring it; the poster
card is keyboard-reachable (`.poster-card:focus-visible` had been styled all along, which says
someone meant it to be); window bounds persist and are clamped to a display that still exists;
and an offline banner, because offline every provider fails separately and thirty honest
errors are less useful than one true sentence.

**Backlog:** `docs/roadmap/product-hardening-backlog.md` carries the remaining items with
evidence, fixes and acceptance checks. Items marked `needs-app-run` there have not been
verified in a running Electron app and should not be reported as done.

