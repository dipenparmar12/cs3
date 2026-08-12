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
* **Built-in Public Indexers**:
  * `1337x`: General movies, TV shows, anime, multi-audio content.
  * `YTS`: High-efficiency 720p/1080p/4K movie torrents.
  * `EZTV`: TV show episode packs and daily releases.
  * `TorrentGalaxy`: WEB-DL, Bluray, and multi-sub release groups.
  * `Nyaa`: Anime releases, raw subbed episodes, and batch downloads.
  * `LimeTorrents` & `MagnetDL`: General media fallback indexers.
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
* **Sequential Piece Prioritization**:
  * Prioritizes initial video header chunks (moov atom / index blocks) and immediate playback buffers.
  * Spawns an internal HTTP streaming server on `127.0.0.1:PORT`, serving video streams directly to `<video>` in [`src/components/VideoPlayer.tsx`](file:///D:/dipen/cs3/cs3_windows/src/components/VideoPlayer.tsx).

### 2.4 P2P Download Queue & Manager ([`electron/downloadService.ts`](file:///D:/dipen/cs3/cs3_windows/electron/downloadService.ts))
* **Magnet & .torrent Task Handling**:
  * Detects `magnet:?xt=urn:btih:` links and `.torrent` URLs automatically.
  * Enqueues torrent downloads alongside HTTP/aria2c downloads in [`src/components/DownloadCenter.tsx`](file:///D:/dipen/cs3/cs3_windows/src/components/DownloadCenter.tsx).
* **Real-time P2P Telemetry**:
  * Emits live progress events over IPC: `bytesDownloaded`, `totalBytes`, `downloadSpeed` (KB/s or MB/s), `etaSeconds`, and active `seeders` count.
  * Supports `pauseDownload(id)`, `resumeDownload(id)`, and `removeDownload(id)` with state persistence in `cs3_datastore.json`.

---

## 3. Integrated IPC Channels

| Channel | Direction | Payload / Description |
|---|---|---|
| `content:search` | Renderer ➔ Main | `query: string` ➔ Searches metadata + aggregated torrent indexers |
| `content:getSources` | Renderer ➔ Main | `SourceQuery` ➔ Returns ranked `TorrentResult[]` with seeder counts and resolution tags |
| `content:startStream` | Renderer ➔ Main | `TorrentResult` ➔ Spawns `TorrentEngine` streaming handle & returns `http://127.0.0.1:PORT/` URL |
| `download:enqueue` | Renderer ➔ Main | Enqueues magnet link or torrent task into P2P download queue |
| `download:progress` | Main ➔ Renderer | Broadcasts live torrent download speeds, progress %, and seeder counts |

---

## 4. Verification & Build Benchmarks

* **Build Execution**: `bun run build` in `cs3_windows/` compiles 100% cleanly:
  ```text
  ✓ built in 1.20s -> dist/assets/index-CYlypuT-.js
  ✓ built in 408ms -> dist-electron/main.js
  ✓ built in 264ms -> dist-electron/preload.js
  ```
* **Runtime Status**: Torrent indexing, magnet resolution, sequential streaming, and background downloading verified active on Windows.
