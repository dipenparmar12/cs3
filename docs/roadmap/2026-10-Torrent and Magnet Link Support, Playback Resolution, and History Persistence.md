# PRD: Torrent and Magnet Link Support, Playback Resolution, and History Persistence

## 1. Problem Statement

### 1.1 Torrent and magnet link playback

When a user pastes a torrent magnet link into the search bar, CS3 may successfully identify the title and display its metadata and poster, but it fails to retrieve playable content. Even when the torrent contains playable video files inside a folder, the application may report that the source did not provide any response.

This indicates that the torrent ingestion, metadata resolution, file discovery, or playback pipeline is not handling the magnet link correctly.

CS3 must support magnet links, `.torrent` files, and the complete torrent lifecycle, from ingestion and metadata resolution through file selection, streaming, playback, and recovery. Displaying the correct title and poster is not sufficient; the application must resolve the torrent into actual playable media.

### 1.2 Torrent playback history and persistence

When a user plays content through a torrent file or magnet link, CS3 must retain enough information to let them return to that content later without finding or pasting the original torrent again.

Currently, if the torrent reference and its associated state are not persisted correctly, users may lose the ability to resume playback or reopen the same torrent conveniently.

The application needs a reliable persistence mechanism for torrent identity, metadata, file selection, playback position, and the information required to re-resolve or resume the torrent.

## 2. Requirements

### 2.1 Complete magnet link and torrent file support

Support the following input types:

- Magnet URIs.
- Local `.torrent` files.
- Torrent metadata containing one or multiple files.
- Torrents containing nested folders and multiple video files.
- Torrents whose metadata must be retrieved from peers before their contents can be inspected.

The application must correctly distinguish between resolving a title for display and resolving a torrent into playable media.

### 2.2 Torrent ingestion and resolution pipeline

When a user submits a magnet link or torrent file:

1. Validate and parse the input.
2. Extract available torrent identifiers and metadata.
3. Initialize the appropriate torrent engine.
4. Retrieve missing metadata from the torrent network when necessary.
5. Enumerate files, including files inside nested folders.
6. Identify playable media files and their paths.
7. Allow the user to select a file when the torrent contains multiple playable files, unless a reliable automatic selection rule applies.
8. Resolve the selected file into the appropriate streaming or playback source.
9. Start playback and report meaningful progress or errors.

Do not report that a source failed to respond simply because torrent metadata has not arrived yet, a file is nested inside a folder, or the torrent contains multiple files.

### 2.3 Error handling and diagnostics

Replace generic torrent failures with actionable error states, including:

- Invalid magnet URI or torrent file.
- Torrent metadata unavailable.
- No peers or insufficient connectivity.
- Metadata retrieval timeout.
- Torrent contains no supported media files.
- Multiple playable files require selection.
- Selected file is not ready for streaming.
- Torrent engine initialization failure.
- File resolution or playback failure.

Each failure should identify the relevant pipeline stage and preserve useful diagnostic information without exposing sensitive data.

### 2.4 Torrent history

Whenever a user opens or plays a torrent or magnet link, create or update a history entry that allows them to return to the same content later.

Persist the following information where available:

- Stable torrent identity, such as the info hash.
- Original magnet URI or a reusable torrent reference.
- Torrent name and metadata.
- File list and relative paths.
- Selected file identity.
- Selected file index when stable and applicable.
- Playback position and duration.
- Last playback timestamp.
- Torrent source type, such as magnet or `.torrent` file.
- Relevant resume and recovery state.

Use the info hash as the primary identity where available so that the same torrent is not duplicated merely because the user opened it through a different magnet URI or torrent file.

### 2.5 Torrent data and cache management

Cache the torrent information needed to reopen content efficiently, including resolved metadata, file listings, and reusable references.

The persistence strategy must distinguish between:

- **Torrent metadata:** name, info hash, file list, and related descriptive information.
- **Torrent reference:** the magnet URI or imported torrent file needed to resolve the torrent again.
- **Downloaded data:** actual media pieces stored locally by the torrent engine.
- **Playback state:** selected file and resume position.

Do not assume that metadata caching means all torrent media has been downloaded.

Reuse existing torrent-engine storage and cache mechanisms where possible. Avoid duplicating large media files or storing redundant copies of torrent data.

Define appropriate cleanup policies for cached metadata, imported torrent files, incomplete downloads, and abandoned torrent sessions. Do not delete downloaded media or resume data unexpectedly while it is still needed by the user.

### 2.6 Resume and reopen behavior

When a user selects a torrent entry from history:

1. Restore the saved torrent identity and reference.
2. Check whether the required metadata and torrent data are already available locally.
3. Reuse the existing torrent session when possible.
4. Otherwise, reinitialize the torrent from the saved reference.
5. Restore the previously selected media file.
6. Restore the last playback position.
7. Retrieve missing torrent metadata or media pieces as needed.
8. Resume playback when the selected file is available.

If the original magnet link or torrent file is no longer usable, show a clear recovery state and explain what is missing. Do not silently create a new unrelated torrent session.

### 2.7 Compatibility with existing playback and downloads

Torrent playback must integrate with the existing player, history, download manager, and recovery mechanisms.

- Preserve playback position across application restarts.
- Keep torrent playback and explicit downloads consistent without conflating their lifecycle states.
- Avoid starting duplicate torrent sessions for the same torrent unnecessarily.
- Support cancellation and cleanup when a user abandons a session.
- Ensure failures in one torrent do not corrupt history or interrupt unrelated playback.
- Preserve the ability to resume a torrent even when its metadata must be retrieved again.

## 2.8 Audit against the code (2026-10-28)

Read from the code, not run in the app.

| Requirement | Status | Where |
|---|---|---|
| 2.1 Magnets, local `.torrent` files, multi-file and nested torrents, metadata from peers | Built | `torrent/torrentImport.ts` (`torrent:importFiles`, `pickFiles`, `importMagnet`), `torrentFile.ts`, `torrentContents.ts`; a magnet import opens at once as `pending` and its metadata arrives through the engine (`torrent:resolveMagnet`) |
| 2.2 Pipeline: parse, contents, choose a file, stream | Built | `TorrentView.tsx` lists the contents; `torrent:playFile` streams the chosen file over loopback; an imported `.torrent` is written into `TorrentMetadataCache`, so Play skips the BEP-9 fetch |
| 2.3 Actionable errors per stage | Built in part 2026-10-28 | The engine names each cause (metadata timeout, dead swarm, no playable file or episode, port binding); `torrent/torrentFailure.ts` (tested) gives it a kind and a stage from a closed set, and `torrent:playFile` logs `torrent_play_failed` with both and returns `failure`. Provider torrents too: a failed start in `ContentService`'s source walk logs `torrent_start_failed` with kind and stage. Not yet: "file not ready" as its own state |
| 2.4 Torrent history | Built 2026-10-28 | Playing an imported file writes its History row under `torrent://<infohash>/<fileIndex>` (`src/utils/torrentAddress.ts`, tested); History → Play reads that address back and reopens the same file through `torrent:playFile` instead of searching for its name. The infohash is the identity (lower-cased). Not run in the app |
| 2.5 Metadata, reference, data and playback state kept apart | Built in part | Metadata in `TorrentMetadataCache` (verified against the infohash), references in the import list (`torrent:listImports`, `removeImport`), pieces in the engine's cache (`torrent:clearCache`); cleanup of imports is by hand only |
| 2.6 Reopen and resume from history | Built 2026-10-28 | The file resumes from the progress kept under its address, from History and from the Torrent screen alike. A torrent no longer imported answers "That torrent is not imported." rather than starting another session. Not run in the app |
| 2.7 One session per infohash, cancellation | Built | `startStream` reuses an active torrent with the same infohash; `torrent:stopStream` |

Next: offer to import again when a History row names a torrent that was removed (2.6).

## 3. Acceptance Criteria

1. Pasting a valid magnet link resolves the torrent metadata and exposes its playable files.
2. Importing a valid `.torrent` file follows the same resolution and playback workflow.
3. Nested folders and multi-file torrents are handled correctly.
4. The application distinguishes metadata retrieval delays from actual source failures.
5. A supported media file can be selected and streamed through the existing player.
6. Torrent playback creates or updates a persistent history entry.
7. Restarting CS3 does not erase the torrent reference, selected file, or playback position.
8. Users can reopen a torrent from history without finding or pasting the original link again.
9. Existing torrent sessions and cached metadata are reused when safe.
10. Torrent errors identify the failed stage and provide an actionable recovery path.
11. Cache cleanup does not unexpectedly remove data required for playback or resume.
12. Existing torrent downloads, regular provider playback, and other history entries continue to work correctly.

## 4. Implementation Approach

First, trace the complete existing torrent pipeline from search-bar input through magnet parsing, metadata retrieval, file enumeration, torrent engine integration, stream creation, and player startup. Identify why a valid torrent can display title metadata but fail to expose playable media.

Next, fix torrent resolution and multi-file handling before implementing additional persistence. Once playback works reliably, integrate torrent identity and playback state with the existing history and resume architecture.

Reuse existing torrent engines, storage, download state, and history services wherever possible. Avoid introducing a parallel torrent manager or duplicate persistence system unless the current architecture demonstrably cannot support the requirements.

**Core requirement:** A torrent or magnet link must represent a persistent, reopenable media source in CS3, not just a title that can be displayed once.