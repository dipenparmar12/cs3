# PRD-48 — Multi-Engine Download & Verified Resume Subsystem

> **Document ID**: `PRD-48-MULTI-ENGINE-DOWNLOAD-RESUME`  
> **Status**: Active / Implemented  
> **Scope**: CloudStream 3 Desktop Application (`cs3_windows`)  
> **Source Files**: `electron/downloadService.ts`, `fastDownloader.ts`, `aria2Engine.ts`, `ytdlpEngine.ts`, `httpDownloader.ts`, `mediaDownloadResolver.ts`, `download/resumePlan.ts`, `download/resumeWindow.ts`, `src/utils/downloadIdentity.ts`  
> **Test Suites**: `electron/download/resumePlan.test.mts` (17 cases), `electron/download/resumeWindow.test.mts` (10 cases), `src/utils/downloadIdentity.test.mts` (18 cases)  
> **Date**: 2026-09-17  

---

## 1. Executive Summary

Media streaming sources across community extensions present drastically different transport characteristics: direct progressive HTTP files, segmented HLS streams (`.m3u8`), dynamic DASH manifests, cyberlocker video hosts requiring token manipulation, and BitTorrent swarms. A single download mechanism cannot reliably handle this spectrum.

The **Multi-Engine Download & Verified Resume Subsystem** coordinates five specialized download engines under a unified task queue. Crucially, it implements an **independent Range probe and verified resume state machine** (`resumePlan.ts`, `resumeWindow.ts`) that verifies server resume capabilities before writing bytes, preventing the catastrophic "100% false completion" and "full-file probe download" traps.

```text
                                User Clicks Download
                                         │
                                         ▼
                         +───────────────────────────────+
                         |  MediaDownloadResolver        |
                         |  (Classifies stream shape)    |
                         +───────────────────────────────+
                                         │
                 ┌───────────────────────┼───────────────────────┐
                 │                       │                       │
                 ▼                       ▼                       ▼
      Progressive HTTP File       HLS / DASH Playlist        BitTorrent
                 │                       │                       │
                 ▼                       │                       ▼
    +─────────────────────────+          │             +───────────────────+
    |  ResumePlan & Window    |          │             |   TorrentEngine   |
    |  Probe: Tests Range &   |          │             |  (Sequential P2P  |
    |  ETag stability via     |          │             |   Piece Cache)    |
    |  lightweight sockets    |          │             +───────────────────+
    +────────────┬────────────+          │
                 │                       │
        ┌────────┴────────┐              │
        ▼                 ▼              ▼
+───────────────+ +───────────────+ +───────────────────+
| FastDownloader| |  aria2Engine  | |    ytdlpEngine    |
| (Pure Node/TS | |  (aria2c RPC, | |  (Segment walk &  |
| 4-Connection  | |  Dynamic Port | |   concatenation,  |
| Chunk Hashing)| |  Allocation)  | |   Cyberlockers)   |
+───────────────+ +───────────────+ +───────────────────+
```

---

## 2. Engine Routing & Capabilities

The orchestrator (`downloadService.ts`) inspects the source URL and metadata to select the optimal engine:

| Source Transport | Assigned Engine | Technical Rationale |
|---|---|---|
| **Direct Progressive HTTP** (Aria2 Available) | `aria2Engine.ts` | Multi-connection accelerated chunk downloading via portable `aria2c.exe`. |
| **Direct Progressive HTTP** (Native Node) | `fastDownloader.ts` | Custom pure TypeScript 4-connection segmented downloader with chunk hashing and zero binary dependency. |
| **Simple HTTP Fallback** | `httpDownloader.ts` | Single-connection streaming pipe with backpressure handling for minimal overhead. |
| **HLS (`.m3u8`) & DASH Streams** | `ytdlpEngine.ts` | Dissects manifest playlists, downloads audio/video segment streams concurrently, and remuxes into clean `.mp4`. |
| **BitTorrent / Magnet Links** | `torrentEngine.ts` | Reuses pieces already buffered by the sequential streaming engine; converts swarm directly to target video file. |

### 2.1 Portable aria2 Engine Lifecycle (`aria2Engine.ts`)
* Automatically binds to a **dynamically allocated available localhost port** (preventing collisions with default port 6800).
* Communicates over authenticated JSON-RPC using a cryptographically random session secret token.
* Supervises process lifecycle, health heartbeats, and graceful teardown on application exit.

### 2.2 Pure Node Fast Downloader (`fastDownloader.ts`)
* Divides file length into concurrent byte ranges (`Range: bytes=start-end`).
* Streams chunks in parallel into pre-allocated sparse disk files.
* Calculates SHA-256 chunk hashes on disk writes to detect corruption without re-downloading entire files.

---

## 3. Verified Resume Architecture & The Range Probe

### 3.1 The 100% False Completion Trap
In naive download managers, an interrupted HTTP stream that closes connection without error is assumed finished, truncating a 2 GB movie at 400 MB and renaming `.part` to `.mp4`. The user opens an unplayable or truncated video.

**Resolution in `cs3`**:
1. Every task is downloaded to a temporary extension file (`.part`).
2. The orchestrator verifies that `bytesDownloaded === expectedContentLength` **and** that the container header/trailer are intact before atomic rename.
3. If an EOF arrives unexpectedly, the task moves to `Paused` or `Error(Incomplete)` rather than `Complete`.

### 3.2 The Range Probe (`resumeWindow.ts`)
Naively probing whether a server supports `Range` requests by initiating a fetch often results in servers ignoring the range header and streaming gigabytes of unwanted data.
* `resumeWindow.ts` executes a raw socket request sending `Range: bytes=0-1`.
* It inspects the HTTP status code (`206 Partial Content` vs `200 OK`) and parses `Content-Range`.
* Immediately closes the socket upon header receipt, consuming $<1$ KB of network bandwidth.

### 3.3 The Resume Decision Engine (`resumePlan.ts`)
Before resuming an existing `.part` file, `evaluateResumePlan` verifies:
* **Server Support**: Did the origin return `206 Partial Content` and declare `Accept-Ranges: bytes`?
* **ETag Stability**: Does the remote `ETag` or `Last-Modified` match the original task metadata?
* **Action Resolution**:
  * `RESUME_FROM_OFFSET`: Append from existing byte length.
  * `RESTART_FROM_SCRATCH`: Remote file changed or server ignores ranges; clean `.part` and restart at offset 0.
  * `UNSUPPORTED`: Non-seekable live stream; notifies user.

---

## 4. Download Identity & Task Model (`src/utils/downloadIdentity.ts`)

* **Source Variant Addressing**:
  * Downloads are keyed by `(titleId, season, episode, sourceUrlHash, qualityVariant)` rather than title alone.
  * Allows users to download a 1080p copy and a 4K copy of the same film without key collisions.
* **Collision Resolution**:
  * Appends clean disambiguation suffixes (`(1)`, `(1080p)`) if destination files already exist in user's downloads folder.
* **Concurrency Gates**:
  * Limits active concurrent network transfers to **3**; additional tasks wait in `Queued` state to preserve user bandwidth.

---

## 5. IPC Interface

| Channel | Direction | Payload & Action |
|---|---|---|
| `download:request` | Renderer ➔ Main | Requests download action for a title (inspects existing tasks, resumes or prompts) |
| `download:enqueue` | Renderer ➔ Main | Adds new download task to queue with engine selection |
| `download:preview` | Renderer ➔ Main | Returns calculated destination filepath, estimated size, and collision status |
| `download:pause` | Renderer ➔ Main | Suspends active transfer while preserving partial `.part` file |
| `download:resume` | Renderer ➔ Main | Resumes paused download via verified `resumePlan` check |
| `download:cancel` | Renderer ➔ Main | Cancels task and deletes partial `.part` files from disk |
| `download:progress` | Main ➔ Renderer | Emits real-time progress snapshots (speed, bytes, ETA, active engine) |
| `download:getConfirmPreference` | Renderer ➔ Main | Returns user prompt preference (`ask` vs `immediate`) |
| `download:setConfirmPreference` | Renderer ➔ Main | Sets confirmation prompt preference |
