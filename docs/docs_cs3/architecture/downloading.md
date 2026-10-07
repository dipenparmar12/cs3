# Download Architecture

Files: `downloadService.ts` (1,462 lines), `aria2Engine.ts`, `ytdlpEngine.ts`, `fastDownloader.ts`,
`httpDownloader.ts`, `binaryDownloader.ts`, `cs3/batchDownloader.ts`, `download/resumePlan.ts`,
`download/resumeWindow.ts`, `download/restoredTask.ts`, `mediaDownloadResolver.ts`; renderer
`src/utils/downloadIdentity.ts`, `src/components/DownloadCenter.tsx`, `DownloadConfirmDialog.tsx`,
`DeleteDownloadDialog.tsx`, `player/PlayerDownloadPanel.tsx`.

## 1. From source to task
A download starts from a **source** (the same row streaming uses) via `download:request` (a button press) or
`download:enqueue` ("create this task", used by batch/recovery). `buildDownloadTask` (renderer) copies the source
into a `DownloadTask` with its headers, provider, release name, resolution, quality, language, audio.

| Channel | Meaning |
|---|---|
| `download:request` | Reads the task's actual state and answers one of six outcomes (see §3) |
| `download:enqueue` | Create the task |
| `download:preview` | Where the file *would* land (folder layout + variant segment + collision suffix come from the whole queue) |
| `download:get/setConfirmPreference` | `ask` \| `immediate` (default `immediate`) |

## 2. Identity
A download is addressed by its **variant**, never by title and never by a synthesised per-URL `infoHash`:
media + season + episode + provider + release name + resolution + quality + language + audio
(`downloadIdentity.ts`); torrents key on their real infohash. The **provider** is stored, not the extractor
(`indexerName` on an extension link is the file host and changes between resolves). The target path carries a
variant segment (`Movies/<Title>/2160p · WEB-DL · Provider/…`); `DownloadService.claimTargetPath` adds a numbered
suffix on collision. The batch downloader does not stamp its batch id into `providerName`.

## 3. State machine
`DownloadState` (`src/types/download.ts`): `Downloading`, `Queued`, `Paused`, `Completed`, `Failed`, `Retrying`,
`RefreshingSource`. A press does:

| State | Result |
|---|---|
| Downloading / Retrying / RefreshingSource | nothing; says so |
| Queued | nothing; starts when a slot frees (`pump`, `activeCount`) |
| Paused (incl. every task after restart, parked by `loadQueueFromStorage`) | resumes |
| Failed | recovers: clears retry budget, re-resolves the source, retries |
| Completed | verifies the file still exists; re-downloads if not |
| none | starts a task |

## 4. Engines
`DownloadService.startTask` chooses, in this order:
1. **Magnet link** (and a torrent engine is set) → `startTorrentTask` (`TorrentEngine.startStream` in `download` mode; progress via `pollTorrentTasks`).
2. **Segmented** (`isSegmented`: `link.isM3u8`/`link.isDash` first, then a `.m3u8`/`.m3u`/`.mpd` suffix on the URL — this is the one place a URL string is consulted as a fallback) → `startSegmentedTask` through `YtDlpEngine.download`.
3. **aria2c is running** → `resolver.dispatchDownload` (`MediaDownloadResolver`, `Aria2Engine` JSON-RPC; port probed upward from 6800; start only counts once `getVersion` answers). If dispatch throws, fall through.
4. Otherwise → `startHttpTask` (`httpDownloader.ts`; `fastDownloader.ts` provides the parallel-chunk path).

aria2c and yt-dlp are portable binaries fetched on first use (`binaryDownloader.ts`). The bundled copy wins, except yt-dlp, which prefers a downloaded (newer) copy.

## 5. Expiring URLs, refresh and resume
Provider links are signed and short-lived. On failure `markFailed` classifies (`isRecoverableError`), then
`findMatchingSource` re-resolves the *same release* (matching: variant key first; resolution-bound afterwards —
a 2160p task is never rebound to a 480p rip). `decideResume` → `resumePlan.ts` (pure) decides
`resume | restart | complete`; `resumeWindow.ts` proves a partial matches with **one ranged 64 KB request** at the
resume point (206 ⇒ Range works, `Content-Range` ⇒ real length, byte compare ⇒ same file). Unreadable window ⇒
restart. Only `restart` is acted on in `markFailed`.

## 6. Completion and files
`finalizeCompletion` is the only way to `Completed`: target exists, no `.part` remains, size within 1% of
expectations. Otherwise `Failed` with a reason. `writeDownloadInfoFiles` and `saveCompanionSubtitles` add
sidecar files. `remove(id, deleteFile)` is two actions; the delete dialog asks, and Settings → Downloads can
re-enable the prompt.

## 7. Persistence and history
Queue persisted via the datastore (`saveQueueToStorage`); `restoreTasks` (backup/restore) reports
`added/verified/partial/missing`. Completed/failed transfers are recorded through `HistoryStore`
(`downloadService.recordHistory`, `historyEvent.ts`). In **Incognito**, `download:enqueue` throws
"Downloads are turned off in Incognito." when the `allowDownloads` setting (`incognito_allow_downloads`,
default `true`) is off; see [persistence.md](persistence.md#incognito).

## 8. Why a source can download but not stream
Downloaders read forward only and have their own engine; streaming adds a decoder, the proxy and the browser:
* A host that ignores `Range` downloads fine but cannot seek (the proxy states `Accept-Ranges` accordingly).
* The file may be a codec Chromium cannot decode (HEVC 10-bit/AC-3) — playable via mpv or after download.
* Chromium's referrer policy used to block cross-site `Referer` (`ERR_BLOCKED_BY_CLIENT`); aria2 never goes
  through Chromium. `net.fetch` now uses `unsafe-url`.
* Live-streaming abandonment can leave a whole-file request running on Range-ignoring hosts (the proxy now cancels readers and aborts upstream).
See [../debugging/troubleshooting.md](../debugging/troubleshooting.md).
