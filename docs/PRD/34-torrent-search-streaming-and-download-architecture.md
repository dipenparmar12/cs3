# CloudStream 3 Desktop — Torrent Search, Streaming & Download Engine Specification

> **Document ID**: `PRD-34-CS3-DESKTOP-TORRENT-ENGINE`  
> **Status**: Active / Implemented  
> **Scope**: CloudStream 3 Desktop Application (`cs3_windows`)  
> **Last Updated**: 2026-08-12  

---

## 1. Executive Summary

This document specifies the **BitTorrent Search, Sequential Streaming & P2P Download Subsystem** implemented in the CloudStream 3 Desktop application (`cs3_windows`).

The engine integrates P2P torrent discovery, metadata matching, release ranking, sequential HTTP streaming, and background downloading into a seamless desktop media experience without requiring external torrent clients (like qBittorrent or Transmission).

```text
+-----------------------------------------------------------------------------------+
|                                 USER SEARCH / PLAY                                |
|                        (Metadata Query or Magnet / .torrent)                      |
+-----------------------------------------------------------------------------------+
                                          |
                                          v
+-----------------------------------------------------------------------------------+
|                                 ContentService                                    |
|          (Aggregates Public Indexers: 1337x, YTS, EZTV, TorrentGalaxy,            |
|                   Nyaa, LimeTorrents, MagnetDL + Torznab)                         |
+-----------------------------------------------------------------------------------+
                                          |
                                          v
+-----------------------------------------------------------------------------------+
|                              Release Ranker & Parser                              |
|          (Parses Codecs H.264/HEVC/AV1, Audio DTS/Atmos, 4K/1080p,                |
|                    Ranks by Seeders & Minimum Quality Gates)                      |
+-----------------------------------------------------------------------------------+
                                          |
                        +-----------------+-----------------+
                        |                                   |
                        v                                   v
+-----------------------------------------------+ +---------------------------------+
|                 TorrentEngine                 | |          DownloadService        |
|        (Sequential BitTorrent Engine)         | |       (Background P2P Queue)    |
|   Starts local HTTP server: http://127.0.0.1:   | |   Tracks Bytes, Speed, ETA,     |
|          Pipes live stream to <video>         | |       Seeds & Pause/Resume)     |
+-----------------------------------------------+ +---------------------------------+
```

---

## 2. Torrent Subsystem Modules & Architecture

### 2.1 Indexer Registry & Multi-Indexer Aggregator ([`electron/torrent/indexerRegistry.ts`](file:///D:/dipen/cs3/cs3_windows/electron/torrent/indexerRegistry.ts))

Indexers run in parallel, each under its own timeout and circuit breaker, so one
dead site can neither delay nor fail an aggregate search. Results are merged and
deduplicated by infohash, keeping the highest seeder count reported by any
indexer.

* **Enabled by default** — single stable hosts that survive ISP DNS blocking:
  * `Torrentio` ([`indexers/aggregators.ts`](file:///D:/dipen/cs3/cs3_windows/electron/torrent/indexers/aggregators.ts)): Stremio addon aggregating dozens of trackers, keyed by IMDb id. The only source that reports `fileIdx`, naming the exact file to play inside a season pack.
  * `Knaben`: metasearch over ~40 trackers, JSON API, free-text — covers titles with no resolvable IMDb id.
  * `The Pirate Bay` (apibay): free-text JSON API.
  * `Torrents-CSV`: static community dataset; never CAPTCHAs or rotates domains.
  * `AnimeTosho`: anime, absolute episode numbering.
* **Shipped disabled** — per-site scrapers whose domains rotate and whose markup changes without notice ([`indexers/scrapers.ts`](file:///D:/dipen/cs3/cs3_windows/electron/torrent/indexers/scrapers.ts), [`indexers/builtins.ts`](file:///D:/dipen/cs3/cs3_windows/electron/torrent/indexers/builtins.ts)):
  * `1337x`, `BitSearch`, `TheRARBG`, `YTS` (movies), `EZTV` (TV), `Nyaa` (anime), `MediaFusion`.
  * Each walks a mirror list, and treats a page that parses to zero rows as a failure so the circuit breaker trips rather than the UI reporting "nothing matched".
* **Generic Stremio addon adapter**: any stream addon (Torrentio with a custom tracker selection, Jackettio, Comet, self-hosted or debrid-configured MediaFusion) can be added from Settings → Sources by pasting its URL. One documented `GET /stream/{type}/{id}.json` covers the whole ecosystem.
* **Torznab Protocol Integration ([`electron/torrent/indexers/torznab.ts`](file:///D:/dipen/cs3/cs3_windows/electron/torrent/indexers/torznab.ts))**:
  * Direct integration with local or remote **Jackett** / **Prowlarr** instances via Torznab XML endpoints.
  * Solves ISP DNS blocking on public indexers by routing queries through local proxy indexers.

### 2.2 Release Parser & Quality Ranker ([`electron/torrent/releaseParser.ts`](file:///D:/dipen/cs3/cs3_windows/electron/torrent/releaseParser.ts) & [`electron/torrent/ranker.ts`](file:///D:/dipen/cs3/cs3_windows/electron/torrent/ranker.ts))
* **Release Name Parsing**:
  * Regex tokenizer extracting resolution (`2160p/4K`, `1080p`, `720p`), source (`WEB-DL`, `Bluray`, `HDTV`, `CAM`), video codec (`HEVC/H.265`, `AVC/H.264`, `AV1`), and audio codec (`DDP5.1`, `Atmos`, `DTS-HD`, `AAC`).
* **Automated Source Ranking**:
  * Ranks candidate torrents according to user preferences (preferred resolution, maximum allowed file size, minimum seeder threshold).
  * Automatically filters out fake, low-seeder, or password-protected archives.

### 2.3 Sequential Streaming Torrent Engine ([`electron/torrent/torrentEngine.ts`](file:///D:/dipen/cs3/cs3_windows/electron/torrent/torrentEngine.ts))
* **In-Memory & Disk Piece Allocation**:
  * Configurable cache directory (`%APPDATA%\cloudstream-desktop\torrent_cache\`).
* **Head & Tail Piece Prioritization**:
  * Selects only the requested file inside a season pack; without this the swarm's bandwidth is split across every episode and nothing becomes playable.
  * Requests the leading 16 MB *and* the trailing 4 MB at top priority. The tail matters as much as the head: MP4s muxed for disk keep the `moov` atom at the end, and MKV cues live there too, so a head-only fetch leaves those containers stuck before the first frame.
  * Spawns an internal HTTP streaming server on `127.0.0.1:PORT` (loopback only), serving video streams directly to `<video>` in [`src/components/VideoPlayer.tsx`](file:///D:/dipen/cs3/cs3_windows/src/components/VideoPlayer.tsx).
* **Liveness reporting**: tracks time since the selected file last gained a byte, and reports `isStalled` separately from speed — speed dips to zero constantly between pieces, so only the former distinguishes a slow swarm from a dead one.

### 2.3a Automatic Source Failover ([`electron/contentService.ts`](file:///D:/dipen/cs3/cs3_windows/electron/contentService.ts))

The ranker orders results by how good a release *looks*; whether its swarm is
alive can only be learned by trying. `startBestStream` therefore walks the ranked
list, giving each candidate a budget (25 s) to produce playable data, and returns
the first that does. A candidate that is merely slow — bytes arriving, peers
connected — is kept; one that produced nothing is torn down with its cache before
the next is tried. `autoPlay` combines search and failover in one IPC round trip
and backs the one-click **Play** buttons and in-player episode switching.

### 2.4 Download Queue & Manager ([`electron/downloadService.ts`](file:///D:/dipen/cs3/cs3_windows/electron/downloadService.ts))

Four transport shapes, each routed to the engine that can actually fetch it:

| Source | Engine | Why |
|---|---|---|
| magnet / infohash | `TorrentEngine` | reuses pieces already fetched while streaming |
| HLS (`.m3u8`) / DASH | `yt-dlp` ([`ytdlpEngine.ts`](file:///D:/dipen/cs3/cs3_windows/electron/ytdlpEngine.ts)) | segments must be walked and concatenated |
| progressive HTTP | `aria2c` | multi-connection, fastest when installed |
| progressive HTTP | built-in fallback ([`httpDownloader.ts`](file:///D:/dipen/cs3/cs3_windows/electron/httpDownloader.ts)) | aria2c is optional; a fresh install has none |

* **Built-in HTTP downloader**: pipes rather than buffering (backpressure), resumes from the existing `.part` via `Range`, discards the partial file if the server answers 200 to a range request, follows 301/302/303/307/308 with a hop limit, and promotes `.part` to the final path only on a verified-complete transfer.
* **Concurrency**: at most 3 transfers run at once; the rest wait as `Queued`. A season batch previously opened one swarm per episode.
* **Real-time telemetry**: emits `bytesDownloaded`, `totalBytes`, `downloadSpeed`, `etaSeconds` and stall reasons over IPC.
* **Controls**: `pauseDownload(id)` keeps the partial file, `resumeDownload(id)` continues it (aria2 tasks are `unpause`d rather than re-dispatched), `removeDownload(id)` cleans up the `.part`. State persists in `cs3_datastore.json`; interrupted transfers come back as `Paused` after a restart rather than silently restarting.

---

## 3. Integrated IPC Channels

| Channel | Direction | Payload / Description |
|---|---|---|
| `api:searchAll` | Renderer ➔ Main | `query: string` ➔ Searches catalogue metadata (Cinemeta, TVmaze/AniList) |
| `api:getSources` | Renderer ➔ Main | `SourceQuery` ➔ Returns ranked `TorrentResult[]`, rejected results with reasons, and per-indexer outcomes |
| `torrent:startStream` | Renderer ➔ Main | `TorrentResult` ➔ Spawns a `TorrentEngine` handle & returns a `http://127.0.0.1:PORT/` URL |
| `torrent:startBestStream` | Renderer ➔ Main | `TorrentResult[]` ➔ Tries each in rank order until one delivers playable data |
| `torrent:autoPlay` | Renderer ➔ Main | `SourceQuery` ➔ Searches *and* fails over in one call; backs one-click Play and in-player episode switching |
| `torrent:getStats` | Renderer ➔ Main | `infoHash` ➔ Live peers, speed, ready bytes, `isPlayable`, `isStalled` |
| `download:enqueue` | Renderer ➔ Main | Enqueues a magnet, HLS/DASH playlist, or progressive URL onto the download queue |
| `download:progress` | Main ➔ Renderer | Broadcasts the full task list on every change: progress, speed, ETA, state and failure reasons |

---

## 4. Verification & Build Benchmarks

* **Build Execution**: `bun run build` in `cs3_windows/` compiles 100% cleanly:
  ```text
  ✓ built in 1.20s -> dist/assets/index-CYlypuT-.js
  ✓ built in 408ms -> dist-electron/main.js
  ✓ built in 264ms -> dist-electron/preload.js
  ```
* **Runtime Status**: Torrent indexing, magnet resolution, sequential streaming, and background downloading verified active on Windows.
