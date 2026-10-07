# Streaming Architecture (end to end)

Authoritative description of how a title becomes pixels. The stages below are the ones that exist in code;
file names are in `cs3_windows/electron/` unless noted.

```
Search / Catalogue ─► Detail (load) ─► Discovery (getSources) ─► Cache ─► Selection
        │                                                                   │
        ▼                                                                   ▼
 searchSession.ts           contentService.ts                 playbackSession.ts
                                                                            │ startStream
                                                                            ▼
                         torrentEngine / mediaProxy  ◄── loopback URL ── contentService.startStream
                                                                            │
                                         renderer: media:prepare ──► playbackEngine.prepare
                                                      inspect → decide → execute
                                                                            │
              ┌────────────┬───────────────┬───────────────┬───────────────┴───────┐
              ▼            ▼               ▼               ▼                       ▼
          <video>       hls.js         shaka-player   mediaTranscoder         MpvEngine (own window)
         (DIRECT)    (HLS_NATIVE)    (DASH_NATIVE)   (remux/transcode fMP4)      (NATIVE_MPV)
```

## 1. Discovery of providers
Providers are *known* at launch without starting the JVM: `ProviderRegistry` (`cs3-provider-registry.json`,
keyed `size:mtime:RUNTIME_GENERATION`) hydrates the list. A provider is *active* only after
`PluginManager.ensureProviderActive(name)` loads its archive (lazy, per-archive, deduped by an in-flight map).
A background `warmProviders()` loads the rest serially after startup. See [extensions.md](extensions.md).

## 2. Detail
`ContentService.load(url)` answers from `DetailCache` and revalidates behind the viewer (`revalidateDetail`);
`fetchDetail` goes to the provider (`loadMedia`) or a catalogue. Every page opened is also recorded by
`PageSnapshotStore` (display copy + routes + origin) so a saved page never opens blank.

## 3. Source retrieval (`ContentService.getSources` → `runDiscovery` → `discover`)
* Input is a `SourceQuery` (media URL, title, season/episode, scope hints). The in-flight key includes scope and
  `autoWiden`, so a prefetch and a Play press **join one run** (`sharedDiscovery`).
* **Scope:** `origin` (default) asks only the providers whose search rows produced this row
  (`alternates`/`alternateRoutes`); `all` asks every enabled provider **and** indexer
  (`cs3/sourceScope.ts`). A `cs3ext://` row was always provider-bound.
* Extension providers: `extensionSources` → `PluginManager.loadLinksDetailed` (returns links *and* a
  `SourceDiagnosis`). Native providers: `nativeSources` (no escalation — the address names an item in that
  provider's catalogue). Indexers: title/IMDb-id searches, magnets, and Stremio `url` streams (direct links).
* `cs3/titleEnricher.ts` resolves release-name rows to an IMDb id so indexers match well.
* A `cs3ext://` media URL bypasses indexers; a pasted page URL is resolved by yt-dlp (`ytdlpSources.ts`).
* **Auto-widening:** if the narrow scope returns zero, `escalateToAllSources` re-runs as `all`. A failed
  escalation leaves the narrow answer standing. *Self-widened results are offered, never auto-started*
  (`playbackSession.discover`), because they were found by title.

## 4. Normalisation
`cs3/providerLinks.ts` reads a provider reply without guessing: link type (`ExtractorLinkType` is authoritative;
URL heuristics are a fallback only for old archives), DRM (`DrmExtractorLink` fields), playlist parts (numbered
rows `part 2 of 3`), audio-track headers. Magnets keep their real infohash; direct links get
`directSourceIdentity` (`ext-` prefix) so a provider and an indexer returning one file collapse to one row.
Results are ranked by `torrent/ranker.ts` + `releaseParser.ts`, and provider order by `cs3/searchOrder.ts`.

## 5. Caching and expiry
`SourceCache` stores sources with **per-source** expiry (magnets never; links from `Expires`/`exp`/JWT claim
(case-insensitive) else a 20-minute default). A hit may be partially stale and `read()` reports the split.
See [caching.md](caching.md#source-cache).

## 6. Selection and session
`PlaybackSessionManager` (`playbackSession.ts`) owns one "Play" interaction. `playback:start` returns a session id at
once; `playback:update` snapshots carry sources, progress, `widened`, `retryingElsewhere`, `tried`. The player
opens **before** a stream exists. `selectSource`, `skipCurrentSource`, `refresh`, `playNow` drive it; a
`SourceQuery` is retained so refresh needs no navigation. Resume prefers the previously played source
(`cs3/playedSource.ts`: torrents match on infohash; others on provider + release + resolution).

## 7. Proxy, headers, sessions
`ContentService.startStream` wraps every `directUrl` through `MediaProxy` (loopback only), because a browser cannot
send the provider's `Referer`/`User-Agent` and `<video>`/hls.js/ffprobe/mpv all need them.
* Tokens are 16 random bytes; `Host` must name loopback (DNS-rebinding guard).
* HLS playlists and DASH manifests are **rewritten** (every segment/key/variant gets a route; DASH uses
  directory routes because `$Number$` is expanded by the player).
* `Accept-Ranges` is *stated*, not forwarded; a `200` answering a mid-file range is refused.
* `boundedRanges` mode stitches windowed upstream ranges (YouTube DASH).
* Segments disguised as images (PNG header + MPEG-TS) are unwrapped; routes are evicted newest-unserved-first.
* A loopback URL passed to `wrap` is returned untouched.
* Bot walls: `webViewHost.ts` runs an offscreen `BrowserWindow`; `clearance.ts` owns clearances (one solve per
  host, 10-minute cooldown after a failed solve). A block or rate limit never opens a browser — only a real challenge.
* `net.fetch` carries `referrerPolicy: 'unsafe-url'` and honours DoH; all third-party traffic goes through
  `torrent/http.ts`.

## 8. Inspection and decision (`media/*`)
`media:prepare` → `PlaybackEngine.prepare(request)`:
1. **inspect** — `MediaInspector` runs ffprobe; transport (HLS/DASH/progressive) from the first 64 KB of body
   (`#EXTM3U`/`<MPD`); DRM from the provider declaration (which *skips* the probe) or the manifest.
   Probes are cached by **origin** URL in `InspectionStore`; **verdicts are recomputed** (they depend on this
   machine's decoders).
2. **decide** — `decideStrategy(metadata, transport, rendererCaps, hostEncoder)` is pure and returns a plan.
   Renderer capabilities are registered at startup (`media:setCapabilities`) and override the static table in both directions.
3. **execute** — return a URL for the chosen path.

| Strategy | Who plays it |
|---|---|
| `DIRECT` | `<video>` on the proxy/torrent URL |
| `REMUX_CONTAINER`, `AUDIO_TRANSCODE`, `VIDEO_TRANSCODE`, `FULL_TRANSCODE` | `MediaTranscoder` → live fragmented MP4 on loopback |
| `HLS_NATIVE` | hls.js |
| `DASH_NATIVE` | Shaka Player (also the only path for encrypted DASH) |
| `DASH_REMUX` | ffmpeg demux → fMP4 (payload Chromium cannot decode) |
| `NATIVE_MPV` | `MpvEngine`, own window, hardware decode |
| `EME_NATIVE` | ClearKey via EME (`clearKeySession.ts`); Widevine/PlayReady are named as unsupported |

Routing to mpv (`shouldRouteToNativeEngine`) runs *after* the browser decision under policy `off | auto | aggressive`
(`native_engine_policy`). `auto` takes anything that would be re-encoded or downmixed (any channel count above
stereo, plus lossless/object audio). Chromium cannot decode AC-3/E-AC-3/DTS; HEVC needs platform decoders (`PlatformHEVCDecoderSupport` is requested).

Other rules: a dead source (probe reports 4xx) fails over immediately without ffmpeg; the forced retry pass routes
to mpv when available; `-c:v copy` never runs on unverified codec info; HDR re-encodes get the full `zscale`
tone-map chain or none; the software-4K guard is pixels-per-second arithmetic.

## 9. Torrent sources
`TorrentEngine` (WebTorrent, sequential pieces) serves `http://127.0.0.1:PORT/…` with range support; the client is
warmed at launch. `.torrent` bytes are cached by infohash (`torrentMetadata.ts`), the DHT table is persisted
(`dhtNodeCache.ts`; saved contacts via `addNode()`, `dhtPort` 6882). `torrentContents.ts` models seasons/episodes/samples.

## 10. External sources
* **yt-dlp** (`ytdlpEngine.ts`, `ytdlpSources.ts`): requires both audio and video unless a manifest; reports a reason.
* **Local files:** File → Open / drag-and-drop → `MediaProxy.serveLocalFile` → `media:prepare`.
* **External players:** VLC (HTTP interface, per-session password) and mpv are driven; others are launch-only.
  The handed URL is the proxied one.

## 11. Failure handling
`PlaybackErrorPanel` is the single failure surface (Download is the first action when the source is alive).
`describeUnreadableSource` distinguishes a dead source (HTTP status) from an undecodable one. The source cache
learns from playback (`recordFailure/recordSuccess`). See [player.md](player.md) and
[../debugging/troubleshooting.md](../debugging/troubleshooting.md).

## 12. Known gaps (do not assume they exist)
* Widevine/PlayReady playback (no CDM shipped).
* mpv embedded in the app window (it renders in its own window).
* `media/sourceLease.ts` and `media/playbackTelemetry.ts`: `MediaProxy.wrapLease` has **no callers** and only
  type imports exist — leases are not wired (verified 2026-10-07). `media:getPlaybackDiagnostics` reads
  `PlaybackEngine` records instead.
