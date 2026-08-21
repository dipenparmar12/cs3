# Universal playback: closing the gap with the Android app

> **Status: steps 1, 2 and 4 built 2026-08-21** (commit `5086de2`). Step 3 was
> **declined on inspection** — see the note in §5. Steps 5–7 are open.
>
> This began as the answer to "why is CloudStream on Android seamless and this
> laggy?", researched against the Android app's actual stack, this repository's
> code, and what the desktop ecosystem ships in 2026. §1 is the mechanism and is
> the part worth reading even if the plan changes.

---

## 1. Android is not faster. It is doing something structurally different.

The Android app and this one both scrape a URL out of a `.cs3` extension and then play
it. What happens after that is not the same thing at all.

| | Android CloudStream | CloudStream Desktop (today) |
|---|---|---|
| Demux | ExoPlayer/Media3 extractors (MKV, MP4, TS, HLS, DASH…) | Chromium — MP4/WebM/Ogg only |
| Video decode | `MediaCodec` → the SoC's hardware decoder | Chromium's built-in decoders |
| Audio Chromium/Android cannot decode | `nextlib-media3ext` — bundled FFmpeg **decoders** | *no decoder exists* |
| When a codec is unsupported | falls back to a **software decoder** | **re-encodes the stream with FFmpeg in real time** |
| Torrents | `torrentserver` → `127.0.0.1` → ExoPlayer | WebTorrent → `127.0.0.1` → same |

**That last row but one is the whole story.** Android never transcodes. It cannot — a
phone has no CPU budget for it — so upstream solved the problem the only way that works
on a battery: bundle every decoder it might need and hand the bitstream to the hardware.
`nextlib` exists precisely because budget phones and TV boxes ship no DTS/AC-3/TrueHD
licence, and its answer is a *decoder*, not a converter.

This desktop app inherited the browser's answer instead, which is to convert whatever
the browser cannot read. Converting is correct, produces a playable stream, and is
**quadratically the wrong shape**:

- Measured in this repo: libx264 `veryfast` at 3840×2160 runs **11–13 FPS — 0.47×
  realtime**. Chromium drains its buffer in about three seconds and then buffers
  forever. That is the "lagging" report, exactly.
- The same file in mpv: `hwdec=d3d11va`, full resolution, **zero dropped frames**,
  1–2% CPU.
- And the guard that stops the stall makes it worse in a different way: a software-only
  host under the core threshold gets **4K downscaled to 1080p**, HDR flattened, 5.1
  downmixed to stereo. It plays. It is not what the user asked to watch.

Three separate Chromium limits force this on ordinary provider content, and it is worth
being precise about which is which because they need different fixes:

1. **Container.** Chromium demuxes Matroska only for the WebM subset — VP8/VP9/AV1 +
   Opus/Vorbis. A plain **H.264 + AAC MKV**, the single most common provider release,
   is undemuxable. Nothing is wrong with the codecs; the box is unreadable.
2. **Audio.** AC-3, E-AC-3, DTS, DTS-HD, TrueHD all return `""` from `canPlayType`. A
   1080p WEB-DL with E-AC-3 5.1 is the *modal* release in this corpus. Android decodes
   it with nextlib; we downmix it to stereo AAC, or route it to mpv if the user has mpv.
3. **Video.** No HEVC outside platform-decoder builds, and none of MPEG-2, VC-1,
   MPEG-4 Part 2, WMV, or VVC. HEVC is routine at 4K and in 10-bit encodes.

So "our internal app player did not support high resolution or a special format" is
right, and the fix is not a better transcoder. **It is to stop transcoding**, the same
way Android did.

---

## 2. Why only some extensions stream — three unrelated causes

These get conflated in bug reports and they have nothing to do with each other. Last
full measurement on record (`provider-e2e.mjs --plugins 30`, five bundled repositories):
**66 providers loaded, 24 answering, 18 links resolved, 16 streams delivering bytes.**

> That number could not be re-measured for this document — this session's egress policy
> blocks the scraper hosts, so `provider-e2e.mjs` cannot run. Treat 66/24/16 as the last
> known figure, not a current one.

| Cause | Share of the gap | Fix |
|---|---|---|
| **Host refuses the scraper** — Cloudflare, Google bot checks, expired signed URLs | the largest, per the vendor matrix: of 72 non-playing streams, *every one* was a host refusing or expiring a link | WebView bridge (doc 36 step 7) — **not a player problem** |
| **Link shapes the bridge discarded** — DRM, torrents, playlists, live channels, per-track audio | was total for those categories: every `TvType.Live` provider, every `MAGNET` link | **fixed on this branch** (commit `41a485c`) |
| **The stream resolves and will not play well** | the 4K/HEVC/E-AC-3/MKV population | this document |

Cause 1 is the biggest and is unaffected by anything below. Any plan that promises
"every extension streams" without a WebView is overpromising, and this one does not.

---

## 3. The finding that matters most: we ship almost none of this

`package.json` → `build.extraResources` contains **one** entry: the JVM sidecar. That
means a freshly installed app has:

| Component | Shipped? | What happens without it |
|---|---|---|
| JVM sidecar + jlinked JRE | **yes**, ~90 MB | — |
| `ffprobe` | **no** — downloaded on first use | no inspection at all; streams are attached unclassified |
| `ffmpeg` | **no** — downloaded on first use | no remux, no transcode, no subtitle extraction |
| **mpv** | **no** — ~32 MB downloaded on demand, **Windows only** | `mpvEngine.isAvailable()` is `false`, so `NATIVE_MPV` is never chosen and *every* stream takes the browser path |
| `aria2c`, `yt-dlp` | **no** — downloaded on first use | downloads fall back to plain HTTP |

And on macOS and Linux `setupMpv` does not even try — it prints
`Install mpv with 'brew install mpv'` and returns `false`.

**So the default experience is the worst path in the codebase, and the good path is
opt-in behind a download the user has to discover.** That is the direct contradiction of
"a universal app that doesn't require anything extra apart from installing it", and it
is a packaging change, not an engineering problem. It is the single highest-value thing
on this list.

---

## 4. What to integrate

Researched rather than assumed; every option below was checked for licence, maintenance
status, and whether it can be bundled without asking the user for anything.

### Tier 1 — JavaScript, bundled with the app, no native work

**Shaka Player** (Apache-2.0, Google-maintained) — *recommended, closes a documented gap*

The only mainstream client that speaks DASH **and** HLS through one API, with EME for
Widevine, PlayReady and ClearKey, plus offline storage via IndexedDB. It is an ordinary
npm dependency: it bundles, it ships, the user installs nothing.

What it fixes here, specifically:

- **DASH under any DRM** — recorded in `AGENTS.md` as the remaining gap after the
  ClearKey work. Chromium cannot demux an `.mpd` without a JavaScript player driving
  MSE, FFmpeg's DASH demuxer rejects `-decryption_key` fatally, and this build ships no
  DASH player. Shaka *is* that player.
- **Plain DASH** — currently remuxed by FFmpeg, which works but collapses the adaptive
  ladder to one rendition. Shaka keeps the ladder and costs no CPU.
- It can replace hls.js as well, or sit beside it; that is a later decision, not a
  prerequisite.

**Chromium switches we simply never set.** `app.commandLine` in `main.ts` sets exactly
one thing (`autoplay-policy`). Chromium has had platform HEVC decoding behind
`--enable-features=PlatformHEVCDecoderSupport` since Chrome 104, and it is free to ask
for. The app already measures what the renderer can actually decode at startup
(`VIDEO_CODEC_PROBES` → `media:setCapabilities`) and overrides its static table **in
both directions**, so enabling the feature cannot cause a wrong decision — it can only
let a machine with a working HEVC decoder skip a transcode it did not need. Cheap, and
the measurement infrastructure to verify it is already there.

### Tier 2 — the native engine, and making it the default rather than the exception

**mpv / libmpv** — already integrated, already the right choice, currently optional.

This is not a new dependency; it is the one we have, under-used. mpv carries its own
FFmpeg and talks to D3D11VA, NVDEC, Vulkan and VideoToolbox directly, which is the
desktop equivalent of `MediaCodec` + `nextlib` in one binary. Every Chromium limit in §1
disappears: it demuxes MKV, decodes HEVC/VC-1/MPEG-2, plays TrueHD and DTS-X, keeps
HDR, keeps 5.1.

Three things have to change for it to be what Android's player is:

1. **Bundle it** (§3). Windows, macOS and Linux, in `extraResources`, resolved before
   any downloaded copy.
2. **Make `aggressive` the default policy**, or introduce a fourth policy that means
   "mpv unless the browser path is strictly better". Today `auto` deliberately leaves
   remuxes in the app; once mpv is guaranteed present, that trade stops making sense
   for anything the browser cannot play natively.
3. **Put the video inside our window.** This is the real work, and there are three
   honest options:

| Option | What it is | Cost | Precedent |
|---|---|---|---|
| **A — separate window** | today: mpv owns its own OS window, driven over JSON IPC | done | — |
| **A+ — `--wid` child window** | pass Electron's `getNativeWindowHandle()` (HWND on Windows) to mpv's `wid`; mpv renders into a child of our window | days | **Stremio Desktop v5 does exactly this** and forwards mpv state to its web UI |
| **B — libmpv render API + N-API addon** | our own native addon owns an `mpv_handle`, `vo=libmpv`, renders into a GPU surface we composite | weeks, per-platform builds and CI | **Jellyfin Media Player** and **Plex Media Player** (Qt + libmpv), and IPTVnator has an Electron/macOS proof of it |

A+ has a known catch worth stating before anyone starts: a native child window always
paints **above** the renderer's content, so React controls cannot overlay the video
("airspace"). The workaround is a second transparent frameless window tracking the
first — which is what the existing roadmap doc rejected as unverifiable in a headless
environment. It is still the cheapest path to video-inside-the-window and it is
production-proven; it just needs a machine with a screen to validate on.

B is what the two most similar products in existence actually shipped. It is the right
end state and it should not be attempted before A+ has proved the compositing model,
because the two share the overlay problem and only B also has a build-system problem.

Note there is no maintained shortcut: **`mpv.js` is dead** (it was a PPAPI plugin;
Chromium removed PPAPI), and **`node-libmpv` was last published seven years ago**. B
means writing and maintaining an addon.

### Tier 3 — DRM, if premium sources matter

**castLabs "Electron for Content Security" (ECS)** — a drop-in fork of Electron that
ships the Widevine CDM and Verified Media Path, with free production signing through
their EVS service. Full support on Windows and macOS, partial on Linux (no persistent
licences).

This is the only route to Widevine in an Electron app; Android gets a CDM from the
device and we cannot. It is a real decision rather than a free win: it replaces the
Electron dependency with a third-party fork, adds a signing step to release, and ties
upgrades to their release cadence. **Recommend deferring** until a measurement says how
many corpus providers actually serve Widevine — the ClearKey work already landed covers
the DRM that community providers overwhelmingly use, and `EME_NATIVE` now reports
Widevine by name rather than as a broken file.

### Considered and rejected

| Option | Why not |
|---|---|
| **libVLC / VLC** | Same class of capability as mpv, worse embedding story and a heavier surface; we already have mpv wired end-to-end with tests |
| **ffmpeg.wasm / libav.js** | Decoding 4K HEVC in WebAssembly is far below realtime — it recreates the transcoding stall inside the renderer |
| **WebCodecs** | Only exposes decoders Chromium already has; does not add HEVC/VC-1/AC-3, and still needs a demuxer for MKV |
| **Bundling a second transcoder / better presets** | Treats the symptom. Android's answer was never a faster encoder |

---

## 5. Recommended order

Ordered by user-visible value per unit of effort, not by architectural appeal.

1. **~~Bundle ffmpeg, ffprobe and mpv~~ — done.** `tools/package/build-media-runtime.mjs`
   stages them per platform; `extraResources` copies them to `resources/media/`;
   `electron:build` runs it and **fails** rather than packaging an app without its
   player. One correction to the assumption above: the resolution order did *not*
   already prefer a bundled copy — it started at `userData/bin`, which is the
   stale-runtime trap in §3 of `AGENTS.md`. It does now, with `yt-dlp` deliberately
   excepted.
2. **~~Set the Chromium feature switches~~ — done.** `PlatformHEVCDecoderSupport` is
   requested. Still needs re-measuring on real hardware: this session cannot launch
   Electron, so what the probe now answers is unverified.
3. **Default the native-engine policy to `aggressive`** — **declined, and this item was
   wrong.** Under `aggressive` a plain stereo H.264 MKV routes to mpv, which means the
   video leaves the in-app window for a stream the browser plays perfectly after a
   remux that costs a stream copy at ~27x realtime. That trades a working in-app
   experience for CPU nobody was spending. `auto` already routes everything that
   actually degrades — any video re-encode, anything above stereo, lossless and
   object-based audio, and (since the 4K/8K work) any remux above 4K. The premise was
   "mpv is better so use it more"; the measurement is that `auto` already covers every
   case where it *is* better. Revisit when the video surface is embedded (step 5) and
   routing stops costing a window.
4. **~~Add Shaka Player~~ — done.** `DASH_NATIVE`, with ClearKey/Widevine/PlayReady
   configuration. This turned out to require teaching `MediaProxy` to rewrite DASH
   manifests, which **fixed an existing bug**: ffmpeg resolves relative segment URLs
   the same way a player does, so the remux path was already broken for every manifest
   that did not spell its segments out in full.
5. **Embed the video surface — Option A+ first**, validated on a real desktop, with the
   overlay-window compositing proved before committing to it. **This is the next one**,
   and it is the one that cannot be done here: it needs a machine with a screen.
6. **Option B (libmpv addon)** once A+ has shown the compositing model works and the
   product needs the last increment of polish.
7. **WebView bridge** — unchanged in priority and still the largest single cause of
   "this extension does not work". It belongs to a different subsystem
   (`docs/roadmap/support_ext_to.md`) but it outranks 5 and 6 by measured impact.

### What was found while building 1–4

- **The app did not build at all.** `src/components/extensions/` had been swallowed by
  an unanchored `extensions/` ignore rule and never committed, so `App.tsx` imported a
  module no clone contained. Both `tsc -b` and `vite build` failed on every fresh
  checkout. The screen was reconstructed against the real IPC surface; the rule is
  anchored.
- **Subtitles were a second Android-parity gap in the same family as the codecs.**
  ASS/SSA went through the SubRip converter, and every download was decoded as UTF-8
  unconditionally. Both fail silently. Fixed in `electron/subtitles/convert.ts`.

After 1–4, the transcoding ladder becomes what it should always have been: the fallback
for a machine where the native engine failed to start, rather than the default path
that most content takes.

---

## Sources

- [mpv-examples — libmpv embedding (render API vs `wid`)](https://github.com/mpv-player/mpv-examples/blob/master/libmpv/README.md)
- [mpv issue #10189 — detached window with `wid` on Windows](https://github.com/mpv-player/mpv/issues/10189)
- [Stremio Desktop v5 — MPV player integration](https://deepwiki.com/Zaarrg/stremio-community-v5/2.4-mpv-player-integration)
- [Jellyfin Media Player architecture](https://deepwiki.com/jellyfin/jellyfin-media-player)
- [Introducing Jellyfin Media Player](https://jellyfin.org/posts/client-jmp/)
- [IPTVnator — embedded mpv in Electron via a native addon](https://4gray.github.io/iptvnator/blog/embedded-mpv-macos-experiment/)
- [Shaka Player](https://github.com/shaka-project/shaka-player)
- [castLabs Electron for Content Security](https://github.com/castlabs/electron-releases)
- [castLabs ECS — CDM notes](https://github.com/castlabs/electron-releases/wiki/CDM)
- [Enabling Chromium HEVC hardware decoding](https://github.com/StaZhu/enable-chromium-hevc-hardware-decoding)
- [`node-libmpv` on npm — last published seven years ago](https://www.npmjs.com/package/node-libmpv)
- `docs/docs_cs3/05_playback_media_and_torrent_engine.md` — the Android stack, written from source
