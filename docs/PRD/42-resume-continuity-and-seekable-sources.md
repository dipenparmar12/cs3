# PRD-42 — Resume, continuity, and sources that cannot seek

**Status:** proposed. Nothing in §6–§9 is built.
**Written:** 2026-08-29
**Supersedes:** nothing. **Depends on:** PRD-37 (inspect→decide→execute), PRD-38 (audio),
the `MediaProxy` design in AGENTS.md §5, and `cs3/libraryStore.ts`'s existing progress model.

---

## 1. The report, and why it is two features rather than one

> "Sometimes we can't skip and jump to the time where the user left the content. We need to
> support that, and also design a way to auto-continue where the user left off, just like the
> Android CloudStream 3 version does."

Those read as one request and are not. **Continuing where you left off is a product feature.
Being able to jump to an arbitrary time is a transport capability**, and this app currently has
a large class of sources where that capability is absent, undeclared, and silently swallowed.

The second one has to be solved first, because a resume feature built on top of it fails in the
worst available way: the viewer clicks *Continue*, the film starts at 00:00, and nothing
anywhere says why. That is indistinguishable from the app having forgotten their place — the
exact failure the feature exists to prevent.

### The evidence

`.temp/sources/reacher-0.md` — a real source list captured from the app for *Reacher* S01E02,
ten sources, all resolved successfully. **Every one of them is
`video-downloads.googleusercontent.com`** (the Driveleech / GDFlix "Instant Download" host,
reached through Moviesmod on CloudStream X).

AGENTS.md already characterises that host, from an earlier investigation into a frozen
timeline:

| Shape | Reply to a `Range` | Seekable |
|---|---|---|
| `sssrr.org`, r2.cloudflarestorage | 206 + `Content-Range` + `Accept-Ranges: bytes` | yes, and says so |
| gdflix `workers.dev` mirrors | 206 + `Content-Range`, no `Accept-Ranges` | yes, and does not say so |
| **`video-downloads.googleusercontent.com`** | **200 + the whole file from byte zero, whatever was asked** | **no, and does not say so** |

So for this title, *every source the app found is unseekable*. `MediaProxy` already recognises
this and answers `416` with `Accept-Ranges: none` (`mediaProxy.ts`, "Refused to serve byte-zero
data as a mid-file range") — which is correct, and is why the seek bar does nothing. The
proxy is not the bug; it is the only component currently telling the truth.

This is not an edge case. It is one of the most common source shapes in the Indian-content
corpus this app is used with, and it is the shape a *resume* lands on most often, because a
resume is a seek before the first frame.

---

## 2. What is actually built today

Resume exists, partially, and is broken differently on each of five transports. Establishing
this precisely matters, because three of the five failures are silent.

### 2.1 The parts that work

- `libraryStore.recordProgress` persists `positionSeconds` keyed on
  `canonicalKey(title, year)` + season + episode. `RESUME_FLOOR_SECONDS` is 30 (below that,
  playback "did not really start"); `COMPLETION_THRESHOLD` is 0.92 (past that, finished, and
  the row stops offering to resume). `MAX_PROGRESS_ROWS` is 500.
- A **Continue Watching** row exists on the home screen and can be switched off
  (`getContinueWatchingEnabled`).
- `DetailView.resumePositionFrom` and `App.tsx` both supply `progress.resumeAt` into the player.
- `PosterCard` renders a progress bar from it.
- `cs3/playedSource.ts` remembers **which source** delivered a title, and can re-resolve an
  expired link for the same release.

So the *bookkeeping* is in good shape. What is missing is the act of arriving at the position.

### 2.2 The resume path bypasses the seek path

`VideoPlayer.tsx`:

```ts
// Resume from where the last session stopped, once the media knows how long it is.
const resumedRef = useRef<string | null>(null);
useEffect(() => {
  const video = videoRef.current;
  const resumeAt = progress?.resumeAt;
  if (!video || !resumeAt || duration <= 0) return;
  if (resumedRef.current === streamUrl) return;
  resumedRef.current = streamUrl;
  if (resumeAt < duration - 10) video.currentTime = resumeAt;   // <-- the whole implementation
}, [progress?.resumeAt, duration, streamUrl]);
```

Beside it, twenty lines away, sits `seekTo` — which already knows that seeking means three
different things depending on transport:

```ts
if (externalControl?.capability === 'full') { void externalSeek(target); return; }
if (isNativeEngine)                          { void mpvSeek(target);      return; }
if (isConverted && prepared) {
  // A live fragmented MP4 has no index; `currentTime` does nothing. Restart ffmpeg at `?t=`.
  video.src = atTime(prepared.playbackUrl, target); video.load(); return;
}
video.currentTime = target;
```

**The resume effect uses only the last line of that function.** The consequences, by transport:

| Transport | Resume today | Failure is |
|---|---|---|
| Direct progressive, Range-honouring | works | — |
| Direct progressive, **Range-ignoring** (the reacher case) | starts at 0 | **silent** |
| **Transcoded / remuxed** (`isConverted`) | starts at 0 — `currentTime` on a live fMP4 with no index does nothing | **silent** |
| **Native mpv** | not handled here at all; `NativeEngineStage` passes `startSeconds` at open, which mpv turns into `--start=`. On a non-seekable origin mpv correctly declines | **silent** |
| **External player (VLC)** | no resume is attempted at any point | silent |

Three silent failures on the three transports this app routes to most often.

### 2.3 Two smaller defects found in the same read

- **`resumedRef` is keyed on `streamUrl`.** A source switch mid-film changes the URL, so the
  latch reopens and the viewer is thrown back to the *stored* resume point rather than kept
  where they actually were. Switching sources at 01:10:00 to escape a stall drops you at
  00:42:00.
- **A torrent seek is not re-prioritised.** `torrentEngine.focusOn` selects a head window at
  priority 10 and a tail window at 9, both anchored to the file's start and end. Nothing
  updates them on a seek, so jumping to 60% leaves the swarm still buying the opening
  16 MB at top priority while the pieces the viewer is waiting for are ordinary. Seeking a
  torrent works and is much slower than it needs to be.

---

## 3. What Android CloudStream 3 does

From `docs/docs_cs3/06_trackers_sync_and_data_persistence.md`: `DataStoreHelper.kt` owns
"episode playback resume timestamps" alongside bookmarks and watch history, and those
timestamps are part of the backup payload.

Two behaviours are worth copying and one is worth **not** copying:

- **Copy:** resume is per *episode*, not per title, and it is recorded continuously rather
  than at exit — so a crash or a force-quit does not lose the position.
- **Copy:** finishing an episode advances to the next one, and the "next" is resolved from the
  same provider that produced the current one.
- **Do not copy:** Android resumes without asking. That works there because ExoPlayer is
  handed a seekable source or fails loudly. Here, resuming without asking on a source we know
  cannot seek produces the silent restart at 00:00 described above. §7.4 covers the
  difference.

Note that Android has the *same* transport limitation — ExoPlayer cannot seek a Range-ignoring
origin either. Android is the parity target for **continuity**, not for seekability. Nothing
below should be justified as "Android does it" when it comes to §6.

---

## 4. Goals

- **G1** A viewer returning to any title lands where they left off, on every transport, or is
  told plainly why they cannot.
- **G2** Finishing an episode continues to the next one, with the same source lineage, without
  a trip back to the detail page.
- **G3** Seeking works on Range-ignoring origins — the dominant shape in this corpus — rather
  than being refused.
- **G4** No silent failure anywhere on this path. A resume that cannot happen is a sentence on
  screen, not a film that starts at zero.

## 5. Non-goals

- **N1** Cross-device sync of resume positions. Local only; the backup already carries it.
- **N2** Resuming a live stream. `resumePositionFrom` already declines for `isLive` and that
  stays.
- **N3** Making *every* source seekable. Some are genuinely dead or genuinely a stream; the
  goal is to declare the capability honestly, not to fake it.
- **N4** Frame-accurate resume. Keyframe accuracy is the ceiling for anything using `-c:v copy`
  and that is fine — nobody notices two seconds.

---

## 6. Design: seekability is declared, never assumed

The pattern this repo already uses for exactly this problem is `externalPlayerControl.ts`,
which **declares** a `capability` per player instead of pretending every player can be driven,
and downgrades it at runtime when a launched VLC turns out to have no HTTP module. The same
shape applies here, and for the same reason: a seek bar that silently does nothing is worse
than one the viewer was told about.

### 6.1 The capability model

```ts
/** What the transport behind this stream can actually do with a playhead. */
export type SeekMode =
  | 'native'      // origin honours Range, or the container is indexed locally
  | 'restart'     // seeking means re-opening the stream at an offset (ffmpeg `?t=`, HLS/DASH)
  | 'buffered'    // only within what a local cache already holds (see §6.3)
  | 'none';       // forward-only; the origin serves byte zero whatever is asked

export interface SeekCapability {
  mode: SeekMode;
  /** Seconds already reachable. `Infinity` for `native`/`restart`. */
  reachableSeconds: number;
  /** Why, in the viewer's language, when `mode` is `none` or `buffered`. */
  reason?: string;
}
```

This is produced by `MediaProxy` — the only component that has actually spoken to the origin —
and travels on the existing `SourceCapabilityModel` returned by `media:prepare`. It is a
**measurement**, so by the rule in "Probes are remembered; verdicts are not" it belongs in
`inspectionStore` keyed on the origin URL; the resulting *policy* is recomputed each time.

`MediaProxy` already learns everything needed for this and throws it away:

- It sees `Accept-Ranges`, `Content-Range`, and the 200-answering-a-`bytes=N-` case it
  currently converts into a 416.
- `getTargetRoute` already unwraps a loopback URL back to its origin, which is the correct
  cache key.

**One probe, not two.** The classification must reuse the request the proxy is already making
rather than adding a speculative `bytes=1000000-` — AGENTS.md records that trap: an `.mpd` is a
few kilobytes and answers `416` to that probe, which made nine healthy sources look dead.

### 6.2 One resume authority

Delete the direct `video.currentTime = resumeAt` write. Resume becomes a call into the same
`seekTo` every other seek uses, gated on the capability:

```
ResumeController.apply(target, capability)
  ├─ mode 'native'   → seekTo(target)
  ├─ mode 'restart'  → seekTo(target)                    // re-opens at ?t= / --start=
  ├─ mode 'buffered' → seekTo(target) if target <= reachableSeconds
  │                    else offer, do not perform (§6.4)
  └─ mode 'none'     → never seek; offer, do not perform (§6.4)
```

Rules:

- **`resumedRef` is keyed on the media identity, not the URL** — the same
  `(canonicalKey, season, episode)` the progress row uses. A source switch keeps the live
  playhead and hands the new stream the position the viewer was *actually* at, which is what
  `PlaybackSession` already retains for refresh.
- **Resume is attempted once per media identity per session**, and a failure to reach the
  position is reported rather than retried.
- **External players get a resume too.** `externalSeek` exists and is simply never called on
  this path; the capability declaration makes it safe to call.

### 6.3 Making a Range-ignoring origin seekable

This is the substantial piece of engineering, and it deserves its options stated rather than
one asserted.

| Option | What it costs | Verdict |
|---|---|---|
| **A. Discard-to-offset in the proxy** — fetch from 0, throw bytes away until the target | Downloading 450 MB to reach the middle of a 905 MB file, at streaming speed, with nothing on screen | **No.** This is precisely what `--force-seekable=yes` did, and it is the frozen-timeline bug AGENTS.md removed |
| **B. Cache-to-disk, serve ranges from the cache** — the proxy tees the upstream body into a local file; ranges within the cached prefix are served locally, and the file is fully seekable once complete | One disk copy of a file the host is sending in full anyway | **Yes.** See below |
| **C. Prefer a seekable mirror** — re-resolve and rank Range-honouring sources above Range-ignoring ones when a resume is pending | Nothing, when a mirror exists | **Yes, as a cheaper first move** |
| **D. Refuse honestly** — say the source cannot seek, offer to start over or pick another | Nothing | **Yes, as the floor.** Always available, never wrong |

**B is worth building because the cost is already being paid.** This host answers *every*
request with the whole file from byte zero on a single connection. The app therefore already
receives the entire file while streaming it; today those bytes are decoded, displayed and
discarded. Writing them to disk as they pass converts a forward-only stream into a seekable
one for free, and the pieces are all present:

- `MediaProxy` already has a **`/local/<token>` route with full range support**
  (`localRoutes`), built for File → Open and drag-and-drop. A fully cached file is served
  through it with no new capability.
- The download stack already fetches this exact host successfully at 4.2 MB/s
  (AGENTS.md: it is the *downloader* that works on these links while playback does not).

The design, concretely:

- A **tee**: while a `mode: 'none'` origin is streaming, the response body is written to
  `userData/stream-cache/<sha1(origin)>.part` as well as to the client.
- `reachableSeconds` is derived from bytes cached ÷ bitrate (ffprobe already reports both
  duration and size, so this is arithmetic, not a guess), and pushed to the renderer so the
  seek bar can shade what is reachable — the same affordance a buffered range already has.
- A seek **within** the cached prefix is served from the cache. A seek beyond it is refused
  with a reason, not attempted.
- **Bounded and evictable.** A cap (default 2 files / 8 GB, configurable), LRU by last access,
  and it must live somewhere the "clear cache" button can reach — unlike the DHT and metadata
  state, this *is* per-film data.
- **It must be a setting, and the setting must have a writer.** We have just been burned by
  `torrent_http_metadata_cache` being defended as "a setting anyway" while having no UI. This
  writes gigabytes to the user's disk; it is opt-outable from Settings → Playback on day one.

**C is the cheaper first move and should ship first.** When a resume is pending and the current
source declares `mode: 'none'`, `sourceScope` / the ranker should prefer a Range-honouring
alternative from the *same* release before falling back to B. On many titles a `workers.dev`
or r2 mirror sits in the same list; on `reacher-0.md` it does not, which is what makes B
necessary rather than optional.

### 6.4 The UI contract: never silent

Three states, three sentences. This is the whole of G4.

- **Resumed.** A dismissible toast: *"Resumed from 42:15 · Start from the beginning"*. The
  second half is a link. Android resumes without asking; we do too, but we say so and offer
  the way back, because a mis-restored position is the failure people actually complain about.
- **Cannot resume yet** (`buffered`, target beyond the cache): *"This source can't jump ahead
  yet — it's still downloading. You left off at 42:15."* with **Wait** (auto-seeks when
  reachable) and **Choose another source** (opens the panel, filtered to seekable ones).
- **Cannot resume** (`none`, no cache, no alternative): *"This source plays from the start
  only. You left off at 42:15."* with **Start over** and **Choose another source**. The
  position is **never discarded** — the row keeps it, so a later source that can seek still
  lands correctly.

### 6.5 Auto-continue

- At `COMPLETION_THRESHOLD` (0.92) the existing up-next card already appears
  (`UP_NEXT_LEAD_SECONDS` = 40). Continuation resolves the next episode **through
  `playedSource`**, so it comes from the provider that worked, not from a fresh fan-out.
- `SourcePrefetcher.schedule` is already called at 70% of an episode for exactly this; the
  continuation should consume that warm cache rather than starting cold.
- Auto-play of the next episode is **on by default with a visible countdown and a cancel**,
  and switchable in Settings → Playback. Bingeing is the expected behaviour; a surprise is not.
- **A finished episode's progress row is marked complete, not deleted.** A deleted row makes
  "watched" indistinguishable from "never opened" on the next visit.

---

## 7. Data model

`WatchProgress` (in `cs3/libraryStore.ts`) gains three fields, all optional so existing rows
load unchanged:

```ts
/** How the position was last reached, for reporting rather than for logic. */
lastResumeOutcome?: 'resumed' | 'unavailable' | 'startedOver';
/** Set when a source could not seek, so the UI can explain a restart it did not choose. */
lastSeekMode?: SeekMode;
/** Wall-clock of the last position write, so a stale row can be aged out of the row. */
updatedAt?: number;
```

No migration is required and none should be written. `recordProgress` already keys on
`(canonicalKey, season, episode)`, which is the right identity and is not changing.

---

## 8. IPC surface

Per the four-way rule in AGENTS.md, each of these changes the service, `main.ts`,
`preload.ts` and the renderer caller together, and `ipcSurface.test.mts` pins the parity.

| Channel | Direction | Purpose |
|---|---|---|
| `media:getSeekCapability` | invoke | The declaration for a prepared stream. Also returned inline on `media:prepare`, so this is for re-checks only |
| `media:seekCacheUpdate` | push | `{ token, reachableSeconds, cachedBytes, totalBytes }` while a `buffered` stream fills |
| `playback:resumeIntent` | invoke | Resolve `(mediaId, season, episode)` → `{ positionSeconds, capability, canResume }` in one call, so the player does not assemble it from three |
| `library:markCompleted` | invoke | Explicit completion, used by auto-continue |
| `player:getContinuityPreferences` / `setContinuityPreferences` | invoke | Auto-play next, countdown length, stream cache on/off and its size cap |

`media:prepare` gains `seek: SeekCapability` on its response. It does **not** gain a way to
obtain an unclassified URL — INV-RACE-1 is unaffected by any of this.

---

## 9. Milestones

Ordered so that each one is shippable and the silent failures die first.

- **M0 — Stop lying (1–2 days).** Delete the direct `currentTime` write; route resume through
  `seekTo`; key the latch on media identity rather than `streamUrl`; add resume for the
  external-player transport. **This alone fixes resume on transcoded and mpv sources**, which
  is the majority of what the app routes today, and fixes the source-switch regression.
- **M1 — Declare seekability (2–3 days).** `SeekCapability` produced in `MediaProxy` from the
  request it already makes, carried on `media:prepare`, persisted in `inspectionStore`. The
  seek bar renders `mode: 'none'` as disabled with a reason. No new capability yet — this
  makes the existing failure *visible*, which is most of G4.
- **M2 — The honest UI (2 days).** §6.4's three states. Resume toast with "Start from the
  beginning". Position never discarded.
- **M3 — Prefer a seekable source (2–3 days).** Option C. When a resume is pending and the
  chosen source cannot seek, try a Range-honouring alternative from the same release first.
- **M4 — The stream cache (1–2 weeks).** Option B: tee to disk, serve ranges from the cached
  prefix through the existing `/local/` route, `reachableSeconds` pushed to the seek bar,
  bounded + LRU + a real setting with a real writer.
- **M5 — Auto-continue (3–4 days).** §6.5, on top of the existing up-next card and prefetcher.

**Separately, and not blocking any of the above:** torrent seek re-prioritisation (§2.3). It is
a `focusOn` change — recompute the head window from the seek target instead of the file start —
and it is worth doing on its own merits.

---

## 10. Acceptance criteria

Each is a thing to run, not a thing to believe.

- **AC-1** With `.temp/sources/reacher-0.md` source 1, the seek bar is visibly disabled and
  names the reason. Before M1 it is enabled and does nothing.
- **AC-2** A transcoded 10-bit HEVC source with a stored position of 42:15 opens at 42:15.
  Verified by reading `currentTime` after `loadedmetadata`, not by watching it.
- **AC-3** An mpv-routed source with a stored position opens at that position; on a
  Range-ignoring origin it opens at 0 **and the "plays from the start only" panel is shown**.
- **AC-4** Switching source mid-film at 01:10:00 continues at 01:10:00, not at the stored
  resume point.
- **AC-5** After M4, seeking backwards into cached territory on a googleusercontent source is
  instant; seeking forwards past the cache is refused with a reason and auto-completes when
  reached.
- **AC-6** Finishing an episode starts the next one from the same provider, with a visible
  countdown that can be cancelled, and the finished row shows as watched rather than vanishing.
- **AC-7** `bun run test:electron` and `tsc -b` clean. New pure tests for the capability
  classifier (`SeekMode` from a set of recorded header shapes) and for the reachable-seconds
  arithmetic — both are silent-failure surfaces, which is this repo's bar for earning a test.

---

## 11. Risks

- **R1 — The stream cache doubles disk traffic on a metered or small disk.** Mitigated by
  being bounded, evictable, and switchable; and by M3 preferring a seekable source first so
  the cache is the fallback rather than the default path.
- **R2 — `reachableSeconds` from bytes÷bitrate is wrong on a VBR file.** It is an
  *affordance*, not a guarantee: a seek into a region the arithmetic claims is reachable and
  is not must degrade to the "still downloading" message, never to a failure.
- **R3 — Classifying seekability from one request may mis-read a host that behaves
  differently under load.** Signed-URL CDNs already do this (AGENTS.md records a host changing
  its mind between probe and transfer). The capability must be downgradable at runtime, the
  way `externalPlayerControl`'s is.
- **R4 — Scope.** M4 is the large one and is separable. M0–M2 deliver most of the perceived
  fix and touch no new subsystem.
