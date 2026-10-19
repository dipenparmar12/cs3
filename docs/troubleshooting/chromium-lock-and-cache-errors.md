# Chromium "Lock file can not be created" / "Unable to move the cache"

Investigation only (2026-10-16). **Nothing here has been fixed.** This records what the
errors mean, what was measured, and how to confirm and resolve each cause later.

## The log

```
[30404:1016/144031.802] ERROR:chrome\browser\process_singleton_win.cc:446] Lock file can not be created! Error code: 32
[30404:1016/144032.310] ERROR:net\disk_cache\cache_util_win.cc:25] Unable to move the cache: Access is denied. (0x5)   (x3)
```

Printed by Chromium itself on stderr, before any of our JS runs, so it never reaches
`logging/logger.ts`. It appears only in the terminal that launched the app.

## What each line means

| Line | Meaning |
|---|---|
| `process_singleton_win.cc` error **32** | `ERROR_SHARING_VIOLATION`: another process holds `<userData>\lockfile` open. Chromium's own single-instance guard for the profile. |
| `cache_util_win.cc` "Unable to move the cache", **0x5** | Chromium tried to rename `<userData>\Cache` aside (stale/corrupt/version-mismatched HTTP cache) and Windows refused because something holds a handle inside it. |

Both are the same symptom: **two things want one profile directory at once.** The second
line usually follows the first (the instance that lost the lock still tries to open the
cache).

## Findings

### 1. Our `requestSingleInstanceLock()` runs too late to help (`electron/main.ts:1669`)

Chromium takes its profile lock during startup. Our lock is requested after ~1,600 lines of
module evaluation. A second launch therefore logs the Chromium errors first, *then* reaches
our `app.quit()`. The errors are noise in that case; the second instance exits anyway.

### 2. Most likely trigger: a second dev launch against the same profile

Dev profile is `%APPDATA%\CloudStream 3 Desktop (Dev)` (`APP_NAME`, `main.ts:195`). Measured
while the error was reproducible: one `electron.exe . --no-sandbox` (parent of GPU, network
and renderer children) was alive, `lockfile` held (0 bytes, created 14:48). Anything that
starts a second Electron on that profile reproduces the log: a second `bun run dev`,
`vite-plugin-electron` restarting main while the old one is still shutting down, a
smoke-test or e2e run that does not pass its own `userData` (`smokeTest.ts` only redirects
when its env var is set), or an orphan from a crash.

### 3. A real design hazard: our `cache/` is Chromium's `Cache` on Windows

`storage/appStorage.ts:94` sets `cacheRoot = <userData>/cache`. Chromium's HTTP disk cache is
`<userData>/Cache`. **Windows paths are case-insensitive, so they are one directory.**
Measured listing of the live profile:

```
Cache/
  Cache_Data/  No_Vary_Search/            <- Chromium
  cs3-*-cache.json, cs3-repository-listings.json,
  torrent-pieces/, torrent-state/, yt-dlp/ <- ours
```

Consequences:
- When Chromium decides to move `Cache` aside (the 0x5 line) it is moving a directory that
  also holds WebTorrent piece files, the DHT/torrent-state files and a yt-dlp binary, any of
  which may be open (torrent engine, a running download). Access denied is the expected
  result, and it is not caused by a second instance at all.
- "Clear cache" (Settings → Storage) and `storageCleanup` operate on a directory Chromium
  also manages; the `.cs3-owned.json` marker rule protects ours, but not Chromium's side.
- This could also explain the error appearing with only one instance running.

### 4. Orphans after a hung shutdown

`before-quit` is raced against 5 s (see `fn:ui`, lifecycle). A hung WebTorrent `destroy()` or
mpv leaves a live process holding `lockfile` and cache handles; the next launch logs exactly
this. `shutdown_timeout` in the launch log names the pending service.

## How to confirm which cause it was (no changes needed)

1. **Is another instance alive?** (PowerShell)
   ```powershell
   Get-CimInstance Win32_Process -Filter "Name='electron.exe' OR Name='CloudStream 3 Desktop.exe'" |
     Select ProcessId, ParentProcessId, CommandLine
   ```
   Two processes *without* `--type=` in the command line = two app instances. Note the
   `--user-data-dir` of each.
2. **Who holds the lock?** `handle.exe "<userData>\lockfile"` (Sysinternals) or Resource
   Monitor → CPU → Associated Handles, search `lockfile` / `Cache`.
3. **Was the previous run's shutdown clean?** Open the previous `<userData>\logs` NDJSON and
   search for `shutdown_timeout`.
4. **Does it happen with one instance?** Quit everything, confirm step 1 is empty, launch
   once. Errors still present → cause 3 (the shared `Cache` directory), not cause 2.
5. **Is `Cache` shared?** `dir "<userData>\Cache"` showing `Cache_Data` beside `torrent-pieces`
   proves cause 3.

## Resolution options for later (ranked, none applied)

1. **Rename our root away from `cache`** (e.g. `cs3-cache/`) and migrate once, as the
   `cs3-*-cache.json` move already did. Removes cause 3 for good. Needs a
   `storageCleanup`/`appStorage` test that no owned directory case-folds onto a Chromium
   name (`Cache`, `Code Cache`, `GPUCache`, `Network`, `Local Storage`, `Session Storage`, …).
2. **Take the single-instance lock first.** Call `app.requestSingleInstanceLock()` before the
   heavy imports (or in a tiny entry module) so a second launch exits before Chromium
   touches the cache. Needs care: the lock must precede `prepareSmokeTest`'s `userData`
   redirect, or smoke runs lose their isolation.
3. **Give every test/e2e/dev-second-run its own `--user-data-dir`.** Cheapest guard for cause 2.
4. **Shutdown:** keep killing children on timeout (mpv, sidecar, aria2) so a hung quit does
   not leave a lock holder. Check `shutdown_timeout` first.
5. **Runtime fallback:** if the lock is held at launch, say so in a dialog ("CloudStream is
   already running") rather than a silent exit.

## Risk if left alone

Low for cause 2 (cosmetic log lines, second instance exits). Moderate for cause 3: a
Chromium cache move/clean racing an open torrent piece directory can drop torrent progress
or leave a half-moved `Cache`; it is the only one that can lose user data.

## Not verified

No app run reproduced the log; findings 2 and 4 are from process/profile inspection and code
reading. Finding 3 is directly observed on disk. Confirm with steps 1-5 before choosing a fix.
