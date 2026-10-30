# PRD: Torrent Streaming Optimization, Storage Management, and Torrent File Export

## 0. Status and Phase 1 findings (2026-10-30)

**Status: Partial.** Phases 1–4 built and measured in the built app; a read-ahead cap (§0.3) and an OS share sheet are not. Rules in `docs/agents/torrents-and-search.md` §7.1a.

### 0.1 Causes found

| # | Cause | Where | Effect |
|---|---|---|---|
| 1 | WebTorrent's store (`fs-chunk-store`) opens plain files; NTFS zero-fills a plain file up to the furthest write | `fs-chunk-store` → `random-access-file` without `sparse` | The first tail-window or seek write allocates the whole file. Raw store, 2 GB file, head then tail piece: **2,048 MB, 1.3 s**; sparse: **8 MB, 5 ms**. An 18 GB film on a disk with less than 18 GB free fails that write (`ENOSPC`) |
| 2 | A failed write destroys the torrent, and the engine's only `error` listener was removed at `ready` | `awaitReady` | The error went to a log line; the player saw "The stream was closed before it started" |
| 3 | Listing an imported magnet's files called `startStream` in download mode | `torrent:resolveMagnet` | Looking at a torrent selected its largest file and downloaded it, rarest first, for the rest of the session |
| 4 | Head (10) and tail (9) windows were layered over a whole-file `select(1)`; WebTorrent 3 merges overlapping non-stream selections into one at the highest priority | `focusOn` | The whole file at priority 10, walked from byte 0, ahead of every player read: the tail was not fetched early, and a seek's read shared every peer with that walk |
| 5 | A kept store re-added without a bitfield is re-hashed before `ready` | WebTorrent `_verifyPieces` | **~2.5 s/GB** (raw store, measured): an 18 GB film reopened after Stop overran the 25 s metadata timeout and read as a dead swarm |
| 6 | Stop released the torrent whatever else held it; a second download in a pack deselected the first | `stopStream`, `focusOn` | Closing the player stopped a download of the same torrent; batch downloads from one pack fetched only the last file |
| 7 | The storage report and the 20 GB cache cap counted file length | `storageCleanup.measure` | Sparse files would read as their full size |

### 0.2 Measured in the built app

`vite build` of HEAD (`f11facd`) and of this change, run with a scratch `--user-data-dir`, driven over CDP: `window.cloudstream` imports the magnet, lists files, plays the file through the real loopback server into a `<video>`, watches, seeks to 70%, stops (keeping pieces, as the player does), quits and reopens. Disk is the cache folder's allocated bytes (`stat.blocks × 512`). Web-seeded Blender films; one run each, so times are indicative.

| Step | Cosmos Laundromat (MP4, 210 MB) before → after | Tears of Steel (WebM, 545 MB), stream only, before → after |
|---|---|---|
| File list fetched, then 30 s | **210 MB → 0 MB** | — |
| Engine says playable | 210 MB → 11.7 MB (stream only, before: 210 MB) | **545 MB → 1.1 MB** |
| Watched (120 s / 15 s) | 210 → 192 MB | 545 → 34 MB |
| Seek to 70%: media resumes after | 2.3 s → 2.3 s (file already local) | **8.8 s → 5.0 s** |
| Stopped, pieces kept | 210 → 210 MB | 545 → 83 MB |
| Reopened after restart: handle after | 1.8 s → 1.8 s | 2.4 s → 0.85 s |

The exported metainfo (`torrent-state/metadata/<hash>.torrent`, what `torrent:exportFile` writes when the torrent is not live) opened in aria2c 1.37 (`--show-files`): same info hash, file list and 23 trackers.

### 0.3 Not done or not verified

- **No read-ahead cap.** The player's read selects to the end of the file, so a fast source downloads ahead of the playhead (Cosmos: 192 MB of 210 MB after 2 minutes). Disk now grows with what arrives, not with the file, but a film can still fill a small disk while it plays. Capping it needs the engine to move a bounded window with the reader.
- **No OS share sheet.** Electron offers one on macOS only; Save `.torrent` writes the file where the viewer chooses.
- The save dialog itself was not clicked through; the bytes it writes were checked as above. Not run: a full disk (`ENOSPC` path), an 18 GB torrent, a season pack with two downloads, a packaged build (`fs-native-extensions` is a native addon; `**/*.node` is unpacked, not checked).
- A download started while its torrent was streaming stays in the streaming cache (WebTorrent cannot move a live store). Cleanup skips it while it is listed; removed from the list with "keep file", it ages out with the cache.

## 1. Objective

Review and improve CS3's internal torrent streaming and storage mechanisms to ensure that torrent content starts playing as quickly as possible, stores only the data required for streaming, and does not consume unnecessary disk space.

Torrent streaming must remain the primary focus. Downloading is a separate feature and should not be required for normal playback.

The implementation must also allow users to export valid torrent files and share them with other applications or users, in addition to the existing magnet link copying functionality.

## 2. Current Problems

### 2.1 Unnecessary disk space consumption

Currently, when users discover or select torrent content, CS3 appears to create or allocate storage for the entire torrent, even when:

- The user has not started playback.
- The user has only inspected the torrent or its metadata.
- The user has not watched any content.
- Only a small portion of the media is needed for initial playback.

For example, a movie with an approximately 18 GB 4K file may consume substantial storage even though the user has not started watching it.

This behavior must be investigated. Determine whether the space is physically allocated, logically reserved, or merely reported as allocated by the torrent engine. Do not assume that every reported byte represents actual disk usage.

### 2.2 Torrent playback does not start correctly

There are cases where CS3 detects torrent files and their metadata, but playback does not appear to begin downloading or buffering the required media data.

The torrent engine may discover the torrent and its files successfully, but the actual streaming pipeline does not appear to receive or deliver playable data.

Investigate why this happens, including:

- Torrent metadata discovery and file selection.
- Peer and seeder discovery.
- Piece availability and prioritization.
- Download scheduling.
- Sequential or piece-priority streaming behavior.
- Buffer readiness and playback handoff.
- Torrent-to-player integration.
- File selection when a torrent contains multiple files.
- Timeout, retry, and stalled-stream handling.

Do not treat successful torrent detection as successful streaming.

## 3. Expected Streaming Behavior

### 3.1 Start playback as early as possible

When a user selects a valid torrent or magnet link:

1. Resolve torrent metadata.
2. Identify the intended media file.
3. Prioritize the pieces required for playback.
4. Begin fetching the required data immediately.
5. Start playback as soon as the minimum playable buffer is available.
6. Continue downloading subsequent pieces while playback progresses.

The player must not wait for the entire torrent or media file to download before starting playback.

### 3.2 Prioritize playback over complete downloading

Normal streaming should fetch only the data needed for playback and buffering.

The engine should prioritize:

- Initial playback data.
- Data near the current playback position.
- Subsequent data required for uninterrupted playback.
- Additional pieces needed for seeking, when requested.

Avoid downloading unrelated files or unnecessary pieces from the same torrent.

Do not automatically convert a streaming session into a complete download.

### 3.3 Support seeking and playback continuity

The streaming implementation must support:

- Forward and backward seeking.
- Buffer replenishment after seeking.
- Recovery from temporarily unavailable pieces.
- Peer disconnections and reconnections.
- Network interruptions.
- Playback resumption where supported.

Piece prioritization should adapt to the current playback position rather than remaining permanently sequential.

## 4. Storage Management

### 4.1 Avoid unnecessary storage allocation

Investigate the torrent engine's current storage allocation and file creation behavior.

The implementation should ensure:

- Merely discovering a torrent does not allocate its complete media size.
- Selecting a torrent does not unnecessarily reserve the entire file.
- Starting playback writes only the data actually downloaded or required by the engine.
- Unselected files are not downloaded.
- Unnecessary temporary files and incomplete data are cleaned up.

Prefer sparse or incremental file allocation where supported by the underlying platform and torrent engine.

Do not introduce a custom storage mechanism if the existing torrent engine already provides suitable allocation and storage controls.

### 4.2 Manage incomplete streaming data

Streaming data should be managed independently from explicitly downloaded content.

Implement a clear lifecycle for temporary torrent data:

- Active playback: retain required downloaded pieces.
- Paused playback: retain data according to the existing session policy.
- Completed or stopped playback: clean up temporary data according to the configured retention policy.
- Application restart: recover or clean up incomplete sessions safely.
- Explicit download: preserve downloaded content according to the download manager's existing behavior.

Streaming cleanup must never delete files that the user explicitly downloaded or chose to retain.

### 4.3 Storage visibility

Provide accurate storage information wherever the application exposes torrent or download storage usage.

Distinguish between:

- Total torrent file size.
- Actual downloaded bytes.
- Buffered or cached data.
- Reserved or allocated disk space.
- Persisted downloaded content.

Do not report the torrent's full size as consumed disk space when only a small portion has actually been written.

## 5. Torrent File Export and Sharing

### 5.1 Existing magnet link functionality

Preserve the existing ability to copy magnet links.

### 5.2 Save torrent files

Users should also be able to save a valid `.torrent` file locally.

Add an appropriate action wherever a valid torrent is available, such as the source selection interface or torrent details.

Expected behavior:

1. User selects the save torrent file action.
2. CS3 obtains the original torrent metainfo or generates a valid equivalent from the available metadata, where supported.
3. User chooses the destination.
4. CS3 saves the `.torrent` file.
5. The saved file can be opened in external torrent applications or shared with other users.

The exported file must preserve the required torrent metadata, including its info dictionary and associated tracker information where available.

Do not create a fake `.torrent` file from a magnet URI containing only an info hash. If complete metainfo is unavailable, explain that the torrent file cannot currently be exported and provide the magnet link as an alternative.

### 5.3 Sharing options

Support the following actions:

- Copy magnet link.
- Save torrent file.
- Share the saved torrent file through supported operating system sharing mechanisms, where available.

Keep these actions accessible without adding unnecessary complexity to the source selection interface.

## 6. Architecture and Implementation Requirements

Before changing the implementation, audit the existing torrent engine, streaming pipeline, storage lifecycle, and download manager.

Identify the exact responsibilities of:

- Torrent metadata resolution.
- Torrent session and client management.
- File selection.
- Piece prioritization.
- Peer discovery.
- Streaming buffer management.
- Local file allocation.
- Player integration.
- Session cleanup.
- Explicit download management.
- Magnet link and torrent metainfo handling.

Reuse the existing torrent infrastructure wherever possible.

Do not introduce a second torrent engine, parallel streaming pipeline, or independent storage subsystem unless the current architecture demonstrably cannot support the requirements.

Streaming and explicit downloading must remain distinct user operations, even if they share the same underlying torrent session and infrastructure.

## 7. Investigation and Testing

### Phase 1: Audit current behavior

Reproduce the storage and playback issues.

Measure actual disk usage before and after:

- Discovering a torrent.
- Resolving torrent metadata.
- Selecting a media file.
- Starting playback.
- Buffering initial data.
- Watching for several minutes.
- Seeking forward.
- Stopping playback.
- Restarting the application.

Identify whether the torrent engine allocates full files, creates sparse files, reserves storage, or writes actual downloaded pieces.

Trace the complete path from torrent selection to the player receiving playable media data.

### Phase 2: Fix streaming behavior

Verify that:

- Valid torrents begin fetching playable data immediately.
- Playback starts without waiting for complete downloads.
- Initial pieces receive appropriate priority.
- Buffering continues while playback progresses.
- Seeking updates piece priorities.
- Multiple files in a torrent are handled correctly.
- Stalled sessions recover or report actionable errors.

### Phase 3: Implement storage management

Verify that:

- Torrent discovery does not consume the full media file size.
- Partial streaming consumes storage proportionate to actual downloaded data, subject to filesystem allocation behavior.
- Unselected files do not consume unnecessary space.
- Temporary streaming data is cleaned up safely.
- Explicit downloads are preserved.

### Phase 4: Implement torrent export

Verify that:

- Magnet links continue to work.
- Valid torrent metainfo can be exported as a `.torrent` file.
- Exported files open successfully in external torrent clients.
- Incomplete magnet metadata does not produce invalid torrent files.
- File sharing works through supported operating system functionality.

## 8. Acceptance Criteria

### Streaming

- [ ] Playback begins as soon as sufficient media data is available.
- [ ] Complete torrent downloads are not required for normal playback.
- [ ] Initial playback pieces are prioritized.
- [ ] Playback continues downloading data in the background.
- [ ] Seeking updates piece priorities correctly.
- [ ] Peer and network interruptions are handled without permanently stalling the session.
- [ ] Torrent discovery and metadata resolution do not falsely indicate that media is ready to play.

### Storage

- [ ] Torrent discovery does not allocate the entire media file unnecessarily.
- [ ] Streaming writes only required and requested torrent data.
- [ ] Unselected torrent files are not downloaded.
- [ ] Actual disk consumption is measured and reported accurately.
- [ ] Temporary streaming data follows a safe cleanup lifecycle.
- [ ] Explicitly downloaded content is never removed by streaming cleanup.

### Export and sharing

- [ ] Users can copy magnet links.
- [ ] Users can save valid `.torrent` files.
- [ ] Exported torrent files work in external torrent clients.
- [ ] Unsupported or incomplete metainfo is handled clearly.
- [ ] Users can share exported files through supported operating system functionality.

## 9. Important Implementation Principle

CS3 is primarily a streaming application, not a torrent downloading application.

The torrent subsystem must optimize for fast playback startup, minimal unnecessary storage consumption, reliable buffering, and uninterrupted playback.

Complete downloads should happen only when users explicitly choose the download functionality.

All changes must preserve existing playback and download functionality, remain compatible with the current architecture, and be validated against real torrent streaming scenarios rather than metadata discovery alone.