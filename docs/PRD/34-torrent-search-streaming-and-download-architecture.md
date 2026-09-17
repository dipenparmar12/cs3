# CloudStream 3 Desktop — Torrent Search, Streaming & Download Engine Specification

> **Document ID**: `PRD-34-CS3-DESKTOP-TORRENT-ENGINE`  
> **Status**: Active / Implemented  
> **Scope**: CloudStream 3 Desktop Application (`cs3_windows`)  
> **Last Updated**: 2026-09-17  
> **Document Version**: 2.0.0 (Updated to reflect DHT node routing cache, indexer budget management, bot challenge mitigations, multi-file content parsing, and swarm health probes)

---

## 1. Executive Summary

This document specifies the **BitTorrent Search, Sequential Streaming & P2P Download Subsystem** implemented in the CloudStream 3 Desktop application (`cs3_windows`).

The engine integrates P2P torrent discovery, metadata matching, release ranking, sequential HTTP streaming, and background downloading into a seamless desktop media experience without requiring external torrent clients (like qBittorrent or Transmission).

```text
+---------------------------------------------------------------------------------------------------+
|                                        USER SEARCH / PLAY                                         |
|                              (Metadata Query or Magnet / .torrent file)                           |
+---------------------------------------------------------------------------------------------------+
                                                  │
                                                  ▼
+---------------------------------------------------------------------------------------------------+
|                            Multi-Indexer Aggregator & Indexer Registry                            |
|             (Public Indexers: 1337x, YTS, EZTV, TorrentGalaxy, Nyaa, LimeTorrents, MagnetDL       |
|                  + Torznab XML Providers: Jackett / Prowlarr + Stremio Stream Addons)             |
+---------------------------------------------------------------------------------------------------+
                                                  │
                                                  ▼
+---------------------------------------------------------------------------------------------------+
|                        Indexer Budget & Rate Limiting (indexerBudget.ts)                          |
|             (Per-indexer request quotas, exponential backoff, circuit-breaker failovers)           |
+---------------------------------------------------------------------------------------------------+
                                                  │
                                                  ▼
+---------------------------------------------------------------------------------------------------+
|                          Release Parser, Ranker & Multi-File Inspector                            |
|        (releaseParser.ts, ranker.ts, torrentContents.ts: Codecs H.264/HEVC/AV1, Audio Atmos/DTS,  |
|               2160p/1080p, Seeder thresholds, and episode resolution inside season packs)          |
+---------------------------------------------------------------------------------------------------+
                                                  │
                                                  ▼
+---------------------------------------------------------------------------------------------------+
|                            DHT Node Cache & Swarm Health Verifier                                 |
|            (dhtNodeCache.ts: Persistent routing table cache for instant swarm bootstrap;          |
|                   swarmHealth.ts: Fast pre-playback seed and readiness probing)                   |
+---------------------------------------------------------------------------------------------------+
                                                  │
                                ┌─────────────────┴─────────────────┐
                                │                                   │
                                ▼                                   ▼
+-----------------------------------------------+ +-------------------------------------------------+
|          Sequential Torrent Streaming         | |            Background P2P Download Queue        |
|            (TorrentEngine / WebTorrent)       | |              (DownloadService / aria2c)         |
|  Prioritizes head (16 MB) & tail (4 MB) chunks| |   Tracks Bytes, Speed, ETA, Active Seeds,       |
|    Starts loopback HTTP: http://127.0.0.1:    | |     Pause / Resume, Verified Chunk Hashing      |
|      Pipes stream directly to <video> / mpv   | |                                                 |
+-----------------------------------------------+ +-------------------------------------------------+
```

---

## 2. Torrent Subsystem Modules & Architecture

### 2.1 Indexer Registry & Multi-Indexer Aggregator (`electron/torrent/indexerRegistry.ts`)

Indexers execute in parallel, each under its own timeout and circuit breaker, ensuring slow or unreachable hosts cannot delay aggregate search results. Results are merged and deduplicated by infohash, retaining the highest verified seeder count reported.

* **Enabled Default Indexers**:
  * `Torrentio`: Stremio addon aggregating multiple trackers, keyed by IMDb id. Crucially returns `fileIdx`, identifying the exact file to stream within a multi-file season pack.
  * `Knaben`: Metasearch over ~40 trackers with structured JSON API, covering titles without IMDb identifiers.
  * `The Pirate Bay` (apibay): Direct JSON API endpoint.
  * `Torrents-CSV`: Static community dataset resistant to ISP DNS blocking and domain rotation.
  * `AnimeTosho`: Anime-focused indexer supporting absolute episode numbering and batch mappings.
* **Optional / Configurable Indexers (`electron/torrent/indexers/`)**:
  * `1337x`, `BitSearch`, `TheRARBG`, `YTS` (movies), `EZTV` (TV), `Nyaa` (anime), and `MediaFusion`.
  * Mirror lists and markup fallbacks prevent false "zero results" reports when domains cycle.
* **Torznab Protocol Integration (`electron/torrent/indexers/torznab.ts`)**:
  * Direct integration with local or remote **Jackett** and **Prowlarr** instances via Torznab XML APIs.
  * Solves ISP blocking by routing requests through private proxy indexers.
* **Direct Sources (`electron/torrent/indexers/directSources.ts`)**:
  * Discovers direct, non-torrent streaming links where available as high-speed instant-play options.

### 2.2 Indexer Budget & Rate Limiting (`electron/torrent/indexerBudget.ts`)

Public torrent indexers frequently employ aggressive rate limiting or Cloudflare protections. The `IndexerBudgetManager`:
* Allocates dynamic request tokens per indexer host.
* Implements exponential backoff on HTTP 429 (Too Many Requests) or HTTP 503 (Service Unavailable).
* Tripping circuit breakers temporarily isolates failing indexers without terminating the overall search session.

### 2.3 Bot Challenge Detection & Bypass (`electron/torrent/botChallenge.ts`)

* Detects Cloudflare Turnstile, Cloudflare IUAM, and DDoS-Guard challenge responses.
* Integrates with `electron/cs3/webViewHost.ts` to solve challenges in headless background sessions and extract fresh clearance cookies.

### 2.4 Release Parser, Quality Ranker & Multi-File Parser (`electron/torrent/`)

* **Release Name Parsing (`releaseParser.ts`)**:
  * Regex tokenizer extracting resolution (`2160p/4K`, `1080p`, `720p`), release source (`WEB-DL`, `BluRay`, `HDTV`, `CAM`), video codec (`HEVC/H.265`, `AVC/H.264`, `AV1`), audio codec (`DDP5.1`, `Atmos`, `DTS-HD`, `TrueHD`, `AAC`), and release group.
* **Automated Source Ranking (`ranker.ts`)**:
  * Scores candidate torrents based on user configuration (resolution preferences, size gates, minimum seeder thresholds).
  * Automatically filters out low-seeder swarms, password-protected archives, and fake releases.
* **Multi-File Torrent Inspection (`torrentContents.ts`)**:
  * Inspects torrent contents to identify video streams within multi-file season packs.
  * Uses regex heuristics (e.g. `S01E04`, `1x04`, `Episode 4`) to accurately map episodes to specific file indices (`fileIdx`).

### 2.5 DHT Node Routing Table Cache (`electron/torrent/dhtNodeCache.ts`)

* BitTorrent DHT bootstrapping ordinarily requires contacting public router nodes (e.g. `router.bittorrent.com`), taking 5–15 seconds to populate the routing table.
* `dhtNodeCache.ts` persists active, healthy DHT routing table nodes in `%APPDATA%/<app>/dht_nodes.json`.
* On subsequent cold launches, the DHT engine loads cached nodes instantly, achieving peer discovery in under 500ms.

### 2.6 Real-Time Swarm Health Verification (`electron/torrent/swarmHealth.ts`)

* Probes tracker response times, active seed-to-peer ratios, and initial piece availability before committing the player to a stream.
* Distinguishes between slow active swarms and dead swarms with zero responsive seeds.

### 2.7 Sequential Streaming Torrent Engine (`electron/torrent/torrentEngine.ts`)

* **Head & Tail Piece Prioritization**:
  * High-priority download of the leading **16 MB** and trailing **4 MB** of the selected file.
  * Tail piece fetching is critical: MP4 files store the `moov` atom at the end of the file unless fast-started, and MKV files store cluster seek indexes (`Cues`) at the end. Fetching the tail immediately allows the player to start playback and seek without buffering the entire file.
* **Internal Loopback HTTP Streaming Server**:
  * Spawns an internal HTTP server bound exclusively to `127.0.0.1:PORT`.
  * Pipes decrypted, sequential video chunks directly to the player (`<video>` or mpv).
  * Supports HTTP `Range` requests for smooth seeking.
* **Stall Detection**:
  * Monitors download intervals; if no new bytes arrive within a timeout window, reports `isStalled: true` to trigger automatic failover.

### 2.8 Automatic Source Failover (`electron/contentService.ts`)

* `startBestStream` walks ranked torrent candidates, granting each candidate a 25-second window to deliver playable data.
* If a candidate swarm stalls or fails, it is cleanly torn down and the next ranked release is tried automatically.
* `autoPlay` handles query resolution, ranking, and failover in a single call.

---

## 3. Integrated IPC Channels

| Channel | Direction | Payload & Purpose |
|---|---|---|
| `api:getSources` | Renderer ➔ Main | `SourceQuery` ➔ Returns ranked `TorrentResult[]`, rejected candidates, and indexer outcomes |
| `torrent:startStream` | Renderer ➔ Main | `TorrentResult` ➔ Spawns `TorrentEngine` handle and returns `http://127.0.0.1:PORT/` stream URL |
| `torrent:startBestStream` | Renderer ➔ Main | `TorrentResult[]` ➔ Tries candidate swarms in rank order until one delivers playable data |
| `torrent:autoPlay` | Renderer ➔ Main | `SourceQuery` ➔ Resolves, ranks, and starts best stream in a single call |
| `torrent:getStats` | Renderer ➔ Main | `infoHash` ➔ Returns live peers, download speed, downloaded bytes, `isPlayable`, and `isStalled` |
| `torrent:closeStream` | Renderer ➔ Main | `infoHash` ➔ Tears down HTTP stream server and cleans up temporary torrent cache |

---

## 4. Verification & Automated Test Coverage

The BitTorrent subsystem is verified by dedicated unit and integration suites:
* `electron/torrent/torrentMetadata.test.mts`: Validates release name parsing, season/episode identification, and codec tagging across 28 test cases.
* `electron/torrent/torrentContents.test.mts`: Verifies multi-file torrent inspection and episode mapping across 24 test cases.
* `electron/torrent/indexerBudget.test.mts`: Validates rate limiting and circuit breakers.
* `electron/torrent/botChallenge.test.mts`: Validates Cloudflare challenge detection.
* `electron/torrent/swarmHealth.test.mts`: Validates swarm health estimation.
* `electron/torrent/indexers/directSources.test.mts`: Validates non-torrent fallback indexers.
