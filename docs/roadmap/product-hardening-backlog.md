# Product Hardening Backlog — CloudStream 3 Desktop

**Written:** 2026-08-26 · **Branch analysed:** `dev/feature-6` @ `2ff6ef2`
**Audience:** autonomous coding agents and maintainers.
**Purpose:** one prioritised, evidence-backed list of everything between "this app runs the
Android extension corpus" and "this app is a product a non-technical person installs and uses".

---

## 0. How to use this document

Each item has a stable **ID**, a **severity**, the **evidence** that it is real (file:line, or a
command that reproduces it), the **symptom a user sees**, the **fix**, and an **acceptance
check**. An agent should be able to take one ID and finish it without re-deriving the analysis.

**Rules for working this backlog:**

1. **One ID per commit.** Commit message: `fix(<scope>): <summary>  [<ID>]`. Scopes follow §7 of
   `CLAUDE.md` (`cs3`, `player`, `torrent`, `library`, `chore(cs3_windows)`, `docs`).
2. **Count before fixing.** Where an item says "measure first", do that first. This repo's own
   history (the six-missing-classes finding) is the argument: grouping by cause turned 113
   symptoms into 6 fixes.
3. **Update `CLAUDE.md` in the same commit** when an item changes the IPC surface, adds a
   service, or invalidates a section. That file is the reason the next agent does not repeat
   this analysis.
4. **Report honestly.** "Typechecks with `tsc -b`" is a claim you can make. "Tested" requires
   running the suite. Electron cannot be launched headless here — items marked **`needs-app-run`**
   must be verified by a human on a real desktop, and the agent should say so rather than
   claiming completion.
5. **Do not widen scope.** Several items name a tempting adjacent refactor and explicitly say
   not to do it. Those notes are load-bearing.

**Severity ladder:**

| | Meaning |
|---|---|
| **P0** | Broken now. A user hits it on a normal path and the app does the wrong thing. |
| **P1** | Correctness or lifecycle risk. Wrong under conditions that will occur. |
| **P2** | Security, privacy, or data-integrity exposure. |
| **P3** | Performance, resource, or scale. |
| **UX** | The product is confusing, unpolished, or unfinished as an *experience*. |
| **A11Y** | Excludes users. |
| **PAR** | Android does it, desktop does not. |
| **ENG** | Release, CI, licensing, cross-platform, maintainability. |

---

## 1. Baseline — what was verified, not assumed

Run on this branch before writing anything below:

| Check | Command | Result |
|---|---|---|
| Typecheck | `./node_modules/.bin/tsc -b --force` | **exit 0, clean** |
| Main-process suites | `npm run test:electron` | **all suites pass, 0 failures** |
| Lint | `npx oxlint electron src` | **12 warnings**, all `react-hooks/exhaustive-deps` + `only-export-components`. Zero errors. |
| IPC surface | script in §12 | **241** handlers registered, **238** preload invokes, **7 mismatches** |

So the tree is healthy by every automated signal it currently has. **Everything in this document
is something the existing signals cannot see** — which is the point, and also the strongest
argument for items `ENG-01` (CI) and `ENG-05` (a renderer test harness).

**Electron was not launched.** This analysis is static plus the existing suites. Items marked
**`needs-app-run`** are reasoned from code and Electron's documented defaults; a human must
confirm them on a real desktop.

---

## 2. P0 — Broken on a normal path

### P0-01 — The first-run "install components" button always fails
**Severity:** P0 · **Area:** IPC, onboarding · **Effort:** 5 minutes

**Evidence.**
- `electron/preload.ts:1427` — `setupBinaries: () => ipcRenderer.invoke('binary:setupBinaries')`
- `electron/main.ts:2758` registers `binary:setupAll`; `main.ts:2770` registers `binary:setup`.
  **Nothing registers `binary:setupBinaries`.**
- Sole caller: `src/components/BinarySetupModal.tsx:35`.

**Symptom.** The modal that offers to install aria2/yt-dlp/ffmpeg/mpv — the one a new user sees
when downloads are unavailable — always rejects. `BinarySetupModal.tsx:46` catches it and renders
the raw Electron internals as a friendly-sounding line:

> `Notice: No handler registered for 'binary:setupBinaries' (HTTP fallback stream active)`

The user is told a fallback is active and has no idea the button did nothing. The progress bar
sits where `setProgressPercent(5)` left it.

**Why it survived.** `ipcRenderer.invoke` on an unregistered channel *rejects* — it does not
return an `{ ok: false }` envelope — and the call site swallows every rejection into a
reassuring string. Both halves are needed to hide it.

**Fix.**
1. Point the preload method at `binary:setupAll` (the one that reports per-component progress).
2. Delete the orphaned `binary:setup` and `binary:check` handlers, or expose them — do not leave
   both spellings.
3. In `BinarySetupModal`, distinguish "the setup ran and some component failed" from "the call
   itself failed". The second is a bug report, not a notice.

**Acceptance.** The IPC parity script (§12) reports zero entries under *"Preload invokes a channel
main does NOT register"*. **`needs-app-run`:** pressing the button downloads at least one binary
and the bar advances.

---

### P0-02 — `runtime:repair` is exposed and does not exist
**Severity:** P0 · **Area:** IPC · **Effort:** 10 minutes

**Evidence.** `electron/preload.ts:1432` — `repairSystemRuntime: () => ipcRenderer.invoke('runtime:repair')`.
`main.ts` registers `runtime:getStatus` (1655), `runtime:provision` (1664), `runtime:test` (1679),
`runtime:clean` (1689). **No `runtime:repair`.**

**Symptom.** Currently latent — no `src/` caller was found — so today it is a dead rung on the
typed API. The moment anyone wires the obvious "Repair runtime" button in
`RuntimeProvisionerCard` to it, it becomes an unhandled rejection on the recovery path for a
broken extension runtime: the exact screen a user reaches when nothing else works.

**Fix.** Either implement `runtime:repair` as `clean` + `provision` + reload-providers in one
handler (which is what a repair button should mean, and what the three existing handlers cannot
express as one user action), or delete `repairSystemRuntime` from the preload and its type.
Prefer implementing it — see `UX-09`.

**Acceptance.** Parity script clean. If implemented, `runtime:getStatus` reports `ready` and not
`stale` after a repair on a deliberately corrupted `%APPDATA%/<app>/cs3-runtime/`.

---

### P0-03 — Changing the home catalogue provider leaves the old catalogue on screen
**Severity:** P0 · **Area:** discovery, IPC · **Effort:** 20 minutes

**Evidence.** `electron/main.ts:1361` sends `discover:invalidated` after a successful
`home:selectProvider`. **`preload.ts` has no listener for it** — verified by the parity script,
which lists it under *"Main pushes an event preload never listens for"*.

The comment two lines above it states exactly what the event is for:

> *the old rows are not wrong — they are someone else's catalogue, and leaving them would keep
> the previous provider on screen until each row aged out six hours later.*

**Symptom.** Settings → Home → pick a different catalogue provider. The call succeeds, the
setting is saved, and the home screen keeps showing the previous provider's rows for up to six
hours. The user concludes the setting does not work, and switches it again.

**Fix.** Add `onDiscoverInvalidated` to `preload.ts` via the existing `subscribe()` helper (it
already owns the teardown — see the `CLAUDE.md` note on fourteen listener/teardown pairs), and
have `HomeView` re-fetch its sections on the event. Add the method to `CloudStreamElectronAPI`.

**Acceptance.** Parity script reports zero lost events. **`needs-app-run`:** switching providers
in Settings repaints Home within a second.

---

### P0-04 — F12 opens DevTools and can never open the Provider Inspector
**Severity:** P0 (dead feature) · **Area:** shortcuts · **Effort:** 15 minutes

**Evidence.** Two handlers claim F12:
- `electron/main.ts:558-561` — `before-input-event` toggles Chromium DevTools and calls
  `event.preventDefault()`.
- `src/App.tsx:203-206` — a `keydown` listener toggles `isInspectorOpen`.

`event.preventDefault()` inside `before-input-event` suppresses the page keyboard event, so the
renderer's listener **never fires**. `ProviderInspector` — a whole component, `src/components/ProviderInspector.tsx` — has no other entry point.

**Symptom.** A developer or power user presses F12 expecting the app's own inspector (which is
what the code intends) and gets Chromium DevTools. The inspector is unreachable.

**Fix.** Separate the bindings and make both discoverable:
- Chromium DevTools: `Ctrl+Shift+I` / `Cmd+Opt+I` only.
- Provider Inspector: `F12`, and — critically — **also a visible affordance**, because a
  keyboard-only entry point to a debugging surface is undiscoverable. Put it behind
  Settings → Advanced → "Open provider inspector".

Related: see `ENG-08` for the wider "there is no menu, so no shortcut is discoverable" problem.

**Acceptance.** **`needs-app-run`:** F12 opens the inspector; `Ctrl+Shift+I` opens DevTools; both
work independently.

---

### P0-05 — Five IPC handlers are registered and unreachable
**Severity:** P0 (dead surface) · **Area:** IPC · **Effort:** 30 minutes

**Evidence.** Registered in `main.ts`, exposed by no preload method:
`binary:check`, `binary:setup`, `extension:getRuntimeReport`, `media:getProbeConfig`,
`media:setProbeConfig`.

**Why it matters.** Two of these are not stubs. `extension:getRuntimeReport` is the per-plugin
tier/blocked-reason report — the thing `CLAUDE.md` describes as the fix for the permanent "JVM
sidecar is initializing providers…" spinner. `media:get/setProbeConfig` is the probe timeout
budget, which is the single knob that helps a user on a slow connection whose every source
"fails" because ffprobe gave up.

**Fix.** For each: expose it in `preload.ts` + `CloudStreamElectronAPI` and wire a caller, **or**
delete the handler. Do not leave it half-connected — a registered handler reads as a feature that
exists. Recommendation: expose `extension:getRuntimeReport` (see `UX-10`) and
`media:get/setProbeConfig` (see `UX-16`); delete the `binary:check`/`binary:setup` duplicates as
part of `P0-01`.

**Acceptance.** Parity script reports zero unreachable handlers, or each remaining one carries a
comment saying why it is intentionally main-only.

---

### P0-06 — The IPC surface has no parity test, which is why P0-01…05 exist
**Severity:** P0 (process) · **Area:** tests · **Effort:** 45 minutes

**Fix.** Add `electron/ipcSurface.test.mts`, run by `npm run test:electron`. It parses
`main.ts` and `preload.ts` and asserts all four diffs are empty (the script in §12 is the
implementation). Allow deliberate exceptions only through an explicit, commented allow-list.

**Why this specific test.** Every one of P0-01…05 is a string that stopped matching a string.
`tsc` cannot see it, the tests cannot see it, and the failure mode is always a silent dead
button. This is the cheapest test in the repo and it retires a whole bug class.

**Acceptance.** The test fails when a channel is renamed in one file only.

---

## 3. P1 — Correctness and lifecycle

### P1-01 — Closing the window on macOS kills the sidecar and stops downloads
**Severity:** P1 · **Area:** lifecycle · **Effort:** 30 minutes · **`needs-app-run`** (macOS)

**Evidence.** `electron/main.ts:745-751`:

```ts
app.on('window-all-closed', () => {
  downloadService.stop();
  extensionUpdater.stop();
  pluginManager.shutdown();          // kills the JVM
  if (process.platform !== 'darwin') app.quit();
});
```

The three teardowns run **unconditionally**; only `app.quit()` is platform-guarded. On macOS the
app stays alive in the dock with a dead sidecar, a stopped download queue and a stopped updater.
`app.on('activate')` then calls `createWindow()`, which opens a window onto all of that.

**Symptom (macOS).** Close the window, click the dock icon: the app returns with zero providers,
every search empty, downloads silently halted, and no message explaining any of it.

**Fix.** Move the teardowns inside the platform guard, or better — move them to `before-quit`,
where the rest of the shutdown already lives, and leave `window-all-closed` doing only
`app.quit()` on non-darwin. There is no reason for two shutdown paths.

**Acceptance.** On macOS: close, reopen, search — providers answer and the download queue is
intact. On Windows/Linux: quitting still tears down the JVM (verify no orphaned `java` process).

---

### P1-02 — Quit can hang forever with no timeout
**Severity:** P1 · **Area:** lifecycle · **Effort:** 20 minutes

**Evidence.** `electron/main.ts:755-783`. `before-quit` calls `event.preventDefault()` and then
awaits `mpvEngine.shutdown()`, `externalPlayers.shutdown()` and `torrentEngine.destroy()` with
**no timeout**. `app.exit(0)` is only reached if all of them settle.

**Symptom.** WebTorrent's `destroy()` and an unresponsive mpv are both known to hang. When one
does, the window is gone, the process is not, and the user's only recourse is Task Manager —
after which the next launch may hit the locked-cache-directory case that this very handler exists
to prevent.

**Fix.** Race the whole shutdown against a deadline:

```ts
await Promise.race([shutdownAll(), new Promise((r) => setTimeout(r, 5000))]);
```

Log which service was still pending when the deadline fired — that is the diagnostic that makes
the *next* fix possible, and it costs one line.

**Also:** `if (!torrentEngine) return;` at `main.ts:756` is dead — `torrentEngine` is constructed
eagerly at `main.ts:202`. Worse, if it ever *were* null the guard would skip mpv, external
players, the WebView host, the diagnostics flush **and `logger.shutdown()`**. Remove the guard;
null-check `torrentEngine.destroy()` at its own line.

**Acceptance.** Killing the sidecar's JVM by hand and then quitting exits within ~5s, with a
`shutdown_timeout` record naming the pending service.

---

### P1-03 — Toast timers are never cleared; a second toast truncates the first
**Severity:** P1 · **Area:** renderer · **Effort:** 1 hour

**Evidence.** 20+ occurrences of `setTimeout(() => setX(null), …)` with no `clearTimeout` and no
effect cleanup. Representative: `src/views/DetailView.tsx:588-591`:

```ts
const flash = useCallback((message: string) => {
  setToast(message);
  setTimeout(() => setToast(null), 5000);
}, []);
```

Others: `SettingsView.tsx:89`, `HistoryView.tsx:294,337,1259`, `CopyErrorButton.tsx:74`,
`DownloadCenter.tsx:130`, `PlayerDownloadPanel.tsx:150`, `ExternalPlayerFallback.tsx:47`,
`UnifiedComponentManager.tsx:120`, `PlaybackErrorPanel.tsx:80`, `PlayerCopyMenu.tsx:100`,
`VideoPlayer.tsx:658`.

**Symptom.** Two bugs from one shape. Bookmark a title, then immediately do something else that
flashes: the *second* message disappears early, killed by the first message's timer. And every
one of these sets state after unmount when the view changes inside the window.

**Fix.** One `useFlash(ms)` hook in `src/utils/`: holds the timer in a ref, clears the previous
timer on each call, clears on unmount. Replace all call sites. This is a genuine
consolidation — the same shape written twenty times — and belongs beside the four in `CLAUDE.md`
§4 ("Shared primitives, and the duplication they replaced"). **Preserve each call site's own
duration**; they differ (1500/2000/2200/2500/3000/4000/5000ms) and that is a parameter, exactly
as the six byte formatters were.

**Acceptance.** No `setTimeout(() => set…(null)` remains outside a cleanup-owning hook. Firing
two flashes 200ms apart shows the second for its full duration.

---

### P1-04 — `SeasonDownloadDialog` cannot be dismissed with the keyboard or the backdrop
**Severity:** P1 · **Area:** renderer · **Effort:** 20 minutes

**Evidence.** `src/components/SeasonDownloadDialog.tsx:96` — `role="dialog"` and `aria-modal` sit
on `.modal-backdrop` itself, there is no `onKeyDown`/Escape handler, and no backdrop `onClick`.
The only exit is the `×` button.

Compare `DeleteDownloadDialog.tsx:37-51` and `SourcePicker.tsx:174-180`, which both do it right:
backdrop click closes, inner `stopPropagation`, Escape bound, `role="dialog"` on the *modal*.

**Fix.** Make `SeasonDownloadDialog` match the other two. Better: extract the correct pattern
into `src/components/Modal.tsx` (backdrop + Escape + `stopPropagation` + `role`/`aria-modal`/
`aria-labelledby` + focus trap + focus restore) and convert all three. See `A11Y-02`.

**Acceptance.** Escape and backdrop-click both close it; `role="dialog"` is on the modal, not the
backdrop.

---

### P1-05 — A dead poster URL renders a broken-image glyph
**Severity:** P1 · **Area:** renderer, aesthetics · **Effort:** 30 minutes

**Evidence.** `src/components/PosterCard.tsx:91` — `<img src={item.posterUrl} alt={titleText} loading="lazy" />`
with **no `onError`**. The component *does* handle a missing URL
(`poster-image--empty` with the first letter), so the fallback exists and is simply not reached
when the URL is present but dead.

**Why this one matters more than it looks.** `PosterCard` is the most-repeated component in the
app — home rows, search results, library. Community-scraped poster URLs die constantly (expired
CDN paths, hotlink protection). One dead poster in a row of six is the difference between "a
polished app" and "a scraper with a UI".

`HistoryView.tsx:790` already handles this — by setting `display: none`, which leaves an empty
box. That is not the answer either.

**Fix.** `onError` → fall back to the same `poster-image--empty` initial that a missing URL gets.
Do it in `PosterCard`, `DetailHero`, `EpisodePanel`, `SearchSuggestions`, `HistoryView`,
`DownloadCenter` — or extract a `<Poster>` component and use it in all six.

**Acceptance.** Pointing `posterUrl` at a 404 renders the lettered placeholder, never a broken
image and never an empty box.

---

### P1-06 — Twelve `exhaustive-deps` warnings, three on the playback path
**Severity:** P1 · **Area:** renderer · **Effort:** 3 hours · **measure first**

**Evidence.** `npx oxlint electron src`. The three that matter:

| Location | Missing dep | Risk |
|---|---|---|
| `VideoPlayer.tsx:1497` | `streamUrl` | attach effect can run against a stale URL |
| `VideoPlayer.tsx:2030` | `sourceSession` | source-switch effect can hold a dead session |
| `VideoPlayer.tsx:1130` | 7 `progress.*` fields | resume position written from stale values |

**Do not bulk-fix by adding the deps.** `CLAUDE.md` documents precisely why: the preparation
effect once listed `activeSource?.directHeaders` and `activeSource?.drm`, which are new objects
on every `playback:update` snapshot, and playback tore itself down on every buffer stall. Adding
`sourceSession` to a dependency array could reintroduce that exact bug in a new place.

**Fix, per warning, in this order:** (a) decide whether the value is *identity* or *content*;
(b) if identity, fold it into a serialised key and depend on the key — the established pattern is
`activeSourceKey` + the `sourceConfig` memo; (c) if content, add it; (d) if genuinely
mount-only, keep the disable and **replace the bare `// eslint-disable-next-line` with a sentence
saying why**. Five of the current disables carry no reason at all
(`App.tsx:324`, `NativeEngineStage.tsx:136`, `SearchScopePicker.tsx:277`,
`useSourceProvenance.ts:47`, `VideoPlayer.tsx:321,428`).

**Acceptance.** `npx oxlint --deny-warnings electron src` exits 0, and every remaining disable has
a rationale comment. Re-run `npm run test:native` — the mpv suite is what catches a regression in
the switch path.

---

### P1-07 — No `will-navigate` guard: a dropped file replaces the app
**Severity:** P1 · **Area:** Electron hardening · **Effort:** 20 minutes · **`needs-app-run`**

**Evidence.** `setWindowOpenHandler` is set (`main.ts:567`), but there is **no `will-navigate`
handler and no `dragover`/`drop` preventDefault** anywhere in `main.ts`, `src/main.tsx` or
`src/App.tsx`.

**Symptom (Electron default behaviour).** Dragging a video file, a subtitle, or a URL onto the
window navigates the `BrowserWindow` to it. The React app is gone. With
`Menu.setApplicationMenu(null)` there is no View → Reload to get back — only `Ctrl+R`, which a
non-technical user does not know. Effectively: the app is bricked until relaunch.

For a *media* app this is not a hypothetical gesture. Dropping a file on a player window is the
single most natural thing a user will try.

**Fix.**
1. `mainWindow.webContents.on('will-navigate', (e, url) => { if (url !== currentAppUrl) e.preventDefault(); })`.
2. `document.addEventListener('dragover'|'drop', e => e.preventDefault())` in `src/main.tsx`.
3. Then do the *useful* thing with the gesture — see `UX-04` (open a local file / add a subtitle).

**Acceptance.** Dropping a file on the window does not navigate. Verified by hand.

---

### P1-08 — `Ctrl+R` and `F5` are live in production
**Severity:** P1 · **Area:** shortcuts · **Effort:** 15 minutes

**Evidence.** `main.ts:549-556` binds reload unconditionally, `app.isPackaged` is not consulted.

**Symptom.** A user typing in the search box who reaches for Ctrl+R (a browser habit) destroys
the renderer: playback stops, the open detail page is lost, an in-flight search is abandoned. In
a mini-player, the film they were watching disappears.

**Fix.** Gate reload on `!app.isPackaged || <devtools-enabled preference>`. Keep DevTools
available in production — technical users need it and this app's whole diagnostic story depends
on it — but reload should not be one keystroke away from a viewer.

**Acceptance.** In a packaged build with the developer preference off, Ctrl+R does nothing;
with it on, it reloads.

---

### P1-09 — `aria2c` is pinned to port 6800 with `stdio: 'ignore'`
**Severity:** P1 · **Area:** downloads · **Effort:** 45 minutes

**Evidence.** `electron/aria2Engine.ts:32` — `private port: number = 6800;` (never reassigned),
`:59-66` — the arg list, `:68` — `spawn(binaryPath, args, { stdio: 'ignore' })`.

**Symptom.** 6800 is aria2's *default* port. Any user who already runs aria2 — a Deluge/qBittorrent
user, a seedbox operator, anyone with an aria2 tray app, i.e. **exactly this app's technical
audience** — gets a bind failure. With `stdio: 'ignore'` the reason is discarded, so the app
reports only that downloads fell back to the HTTP path, at a fraction of the speed, forever.

**Fix.**
1. Bind port 0 (or probe upward from 6800) and read the chosen port back before the first RPC.
2. Capture stderr and route it into the diagnostics log — a failed spawn must say why. The
   `sidecarStderr.ts` module is the precedent for what "capture and attribute" looks like.
3. Surface the outcome in Settings → Downloads: "aria2 active on port N" vs "aria2 unavailable:
   *reason*". A silent downgrade is the failure mode this repo keeps having to fix.

**Acceptance.** Start a second aria2 on 6800 by hand; the app still gets a working RPC and says
which port it used.

---

### P1-10 — `img onError` hides the element rather than falling back
**Severity:** P1 (cosmetic but everywhere) · **Area:** renderer · **Effort:** folded into P1-05

`HistoryView.tsx:788-791` sets `style.display = 'none'` on error, leaving a 44×62 empty box with a
border. Fold into the `<Poster>` extraction in `P1-05`.

---

## 4. P2 — Security and privacy

### P2-01 — The media proxy uses sequential integer tokens and `Access-Control-Allow-Origin: *`
**Severity:** P2 · **Area:** mediaProxy · **Effort:** 1 hour

**Evidence.**
- `electron/mediaProxy.ts:369,492` — tokens are `String(this.nextToken++)`, i.e. `1`, `2`, `3`…
- `:409` and `:582-584` — every response carries `Access-Control-Allow-Origin: *`, and `OPTIONS`
  additionally answers `Access-Control-Allow-Headers: *`.
- Bound to loopback on an ephemeral port (`:572`) — correct, and not sufficient on its own.

**Exposure.** Any page in any browser on the same machine can `fetch('http://127.0.0.1:<p>/stream/1')`
and, because of the wildcard, **read the response body cross-origin**. The port is ephemeral but a
65k-port sweep from a page is seconds of work. What leaks: the stream the user is watching right
now, plus enumeration of `/stream/1..N` and `/local/1..N` — an index of this session's viewing.
Given what this app is for, that is the sensitive fact about it.

This is a *local-attacker / malicious-webpage* class issue, not remote. It is genuinely modest.
It is also close to free to close.

**Fix.**
1. **Unguessable tokens.** `crypto.randomBytes(16).toString('hex')`. This alone removes
   enumeration and is the whole fix for the realistic case. `tokensByKey` already gives token
   stability, so nothing downstream changes.
2. Narrow CORS. The renderer loads from `file://` (`main.ts:576`), which sends `Origin: null`, so
   `ACAO: null` plus `Vary: Origin` covers hls.js/Shaka/ffmpeg. If that proves fiddly, keep `*`
   — with random tokens the wildcard is no longer the load-bearing weakness.
3. Reject requests whose `Host` header is not `127.0.0.1:<port>` (blocks DNS rebinding).

**Do not** move the proxy off loopback or add auth headers — every consumer (ffprobe, ffmpeg,
mpv, hls.js, Shaka, external VLC) would need to learn them, and that is the coupling the proxy
exists to avoid.

**Acceptance.** Extend `electron/media/mediaProxy.test.mts`: a token is ≥32 hex chars; a request
with a foreign `Host` gets 403; the existing 11 cases still pass.

---

### P2-02 — No Content-Security-Policy anywhere
**Severity:** P2 · **Area:** Electron hardening · **Effort:** 2 hours

**Evidence.** `cs3_windows/index.html` has no CSP `<meta>`; `main.ts` registers no
`session.defaultSession.webRequest.onHeadersReceived` CSP; `webPreferences.sandbox` is `false`
(`main.ts:539`).

**Mitigating.** `contextIsolation: true`, `nodeIntegration: false`, and **zero**
`dangerouslySetInnerHTML` / `innerHTML` / `eval` / `new Function` in the whole tree (verified).
So there is no known injection path today.

**Why fix it anyway.** The renderer displays third-party scraped text — titles, plots, provider
names, cast lists, extension descriptions — from ~130 community extensions, on every screen. The
current safety rests entirely on React's escaping never being bypassed by any future component.
CSP is the second layer, and with `sandbox: false` a single bypass reaches the whole preload API:
downloads to arbitrary paths, `shell.openExternal`, the datastore.

**Fix.**
1. Add a CSP via `onHeadersReceived` (not `<meta>` — it must also cover the dev server):
   `default-src 'self'; img-src 'self' https: data: blob:; media-src 'self' http://127.0.0.1:* blob:; connect-src 'self' http://127.0.0.1:* https:; script-src 'self'; style-src 'self' 'unsafe-inline'; frame-src 'none'; object-src 'none'`
2. **Do `ENG-03` first** — the Google Fonts `@import` currently requires `font-src`/`style-src`
   to reach `fonts.googleapis.com`, and self-hosting the font is independently correct.
3. Then attempt `sandbox: true`. It may be blocked by the preload's shape; if so, record why in
   `CLAUDE.md` rather than leaving it looking unconsidered.

**Acceptance.** No CSP violations in the console across every screen, playback (element, mpv,
HLS, DASH) and downloads. **`needs-app-run`.**

---

### P2-03 — `shell:openExternal` validates the scheme but not the target
**Severity:** P2 (low) · **Area:** IPC · **Effort:** 20 minutes

**Evidence.** `main.ts:2018-2022`. The scheme check is present and the comment correctly explains
why it is duplicated from `setWindowOpenHandler`. Good.

**Residual.** `https://` is necessary but not sufficient — the URL passed is frequently
provider-supplied (repository pages, extension homepages, "open in browser"). A user clicking a
link in *our* UI reasonably assumes we vetted it.

**Fix.** Reject embedded credentials (`https://user:pass@…`) and non-HTTP(S) redirect schemes; for
provider-supplied URLs, show the hostname in the UI before opening. Low cost, and it makes the
existing guard actually complete.

---

### P2-04 — The WebView challenge session ignores certificate errors — verify the blast radius
**Severity:** P2 (documented, verify) · **Area:** webViewHost · **Effort:** 1 hour

`CLAUDE.md` documents this as deliberate and bounds it correctly: challenge-solving only, never
credentials, stream fetched afterwards through the ordinary verified path. **This item is not
"remove it"** — Android does `handler.proceed()` and a real share of scraper hosts have bad certs.

**The item is: prove the bound holds in code.** Confirm in `electron/cs3/webViewHost.ts` that
(a) the certificate-error handler is registered on the dedicated partition and cannot reach
`session.defaultSession`, (b) that partition is never used for a stream fetch or a download, and
(c) it is cleared between resolves. Add a comment citing this, and a test if one is cheap.

**Acceptance.** A one-paragraph note in `CLAUDE.md` §5 stating which session object carries the
override and what was checked.

---

### P2-05 — Diagnostics and issue ledger: confirm the no-titles/no-queries rule holds
**Severity:** P2 (audit) · **Area:** privacy · **Effort:** 1 hour · **measure first**

`CLAUDE.md` states `ExtensionIssueLog` stores no URLs, queries or titles, and that `mode:'current'`
exists so a bug report is not an evening's viewing history. Both are the right rules.

**The audit.** Take a real session's `diagnostics` file and a real `extension-issues` file and
grep the *stored* values for anything resembling a title or a query. The taxonomy work already
found three cases where a field carried more than intended (line numbers read as HTTP statuses, a
stack read as a message). This is the same class of check on the privacy axis instead of the
correctness axis.

**Acceptance.** A recorded count. If clean, note it in `CLAUDE.md`. If not, redact at the write,
not at the read.

---

## 5. P3 — Performance and resource

### P3-01 — No list virtualization outside the scope picker
**Severity:** P3 · **Area:** renderer · **Effort:** 4 hours

**Evidence.** `SearchScopePicker.tsx:592-593` implements windowing (`ROW_HEIGHT`, `OVERSCAN`) —
correctly, and it is the only place. Everything else renders every row:
`HistoryView` (cap 10,000 events, `historyStore.ts:12`), `DownloadCenter`, `LibraryView`,
`SourcePanel`/`SourcePicker` (30–200 sources), `ExtensionCatalog` (a bootstrapped install has
~130 archives; phisher98 alone publishes 80).

**Symptom.** History with a few thousand rows is a multi-second freeze on open and a janky
scroll. The extensions catalogue with every repository added is the same.

**Fix.** The scope picker's windowing is ~15 lines and already proven in this codebase. Extract it
to `src/utils/useWindowedRows.ts` and apply to History, Downloads, Library and the extension
catalogue. **Do not add a virtualization dependency** — the existing implementation works, and
`CLAUDE.md` is explicit about main-process/renderer dependency discipline.

**Acceptance.** 5,000 history rows render in <100ms and scroll at 60fps. Measure before and
after; put both numbers in the commit message.

---

### P3-02 — The player polls three timers regardless of source type
**Severity:** P3 · **Area:** player · **Effort:** 1 hour

**Evidence.** `VideoPlayer.tsx:1399-1400` — `setInterval(poll, 1000)` and
`setInterval(pollSwarm, 5000)`; `:1562` — progress save; `:1936` — control visibility.

**Symptom to verify.** Torrent stats and swarm health are meaningless for a provider HTTP stream,
which is the majority case. If those two intervals run for every source, that is two IPC round
trips per second for the life of every film — measurable battery cost on a laptop, and noise in
any profiling anyone does later.

**Fix.** Gate the torrent pollers on the active source actually being a torrent. Pause all
polling when the window is hidden (`document.visibilityState`) — the numbers are not being read.

**Acceptance.** Measure IPC calls/minute during playback of a provider HTTP stream, before and
after. Report both.

---

### P3-03 — `sources.css` is 5,584 lines in one file
**Severity:** P3 · **Area:** maintainability · **Effort:** 4 hours

Every screen's styles in one file, loaded whole, with `.player__*`, `.source-*`, `.detail-*`,
`.ext-*` and `.hint__*` interleaved. It also holds the four positioning fixes documented in
`CLAUDE.md` (the message columns, the z-index ladder) — which are correct and must survive.

**Fix.** Split by feature into `src/styles/{player,sources,detail,library,settings}.css`,
imported from `index.css`. **Mechanical move only — no rule may change in the same commit.**
Verify with a diff of the concatenated, sorted rule text before and after.

**Acceptance.** Concatenated declarations are byte-identical (modulo order). The z-index ladder
(`.native-stage` 3, `.player__overlay` 4, `.player__top` 5, `.player-panel` 7) is intact and
commented in one place.

---

### P3-04 — The installer ships all of `node_modules`
**Severity:** P3 · **Area:** packaging · **Effort:** 30 minutes

**Evidence.** `package.json` → `build.files` is `["dist/**/*", "dist-electron/**/*", "node_modules/**/*"]`.

That includes devDependencies (`typescript`, `vite`, `electron-builder`, `oxlint`, `@types/*`) on
top of the ~90MB sidecar and ~280MB media runtime. electron-builder prunes devDeps in some
configurations, but stating `node_modules/**/*` explicitly opts out of the smart default.

**Fix.** Remove the `node_modules` entry and let electron-builder resolve production
dependencies itself; add explicit `!` exclusions for `**/*.map`, `**/test/**`, `**/*.md`. Measure
the installer before and after.

**Acceptance.** Installer size recorded before/after; the app still launches, streams, and
downloads from the packaged build.

---

## 6. UX — for a person who has used Netflix

The stated target: *"has used Netflix and has not used a plugin manager"*. Measured against that
bar, these are the gaps.

### UX-01 — Seven top-level tabs, four of which are the same idea
**Severity:** UX-high · **Effort:** 1 day (design) + 2 days (build)

**Evidence.** `Sidebar.tsx:19-28` — Home, Search, Library, History, Downloads, Extensions,
Settings. Behind them sit **six** separate user-content stores: `libraryStore`, `historyStore`,
`bookmarkStore`, `continueWatching`, `titleOutcomes`, `searchHistory`.

**The problem.** "Library", "History", "Continue watching" and saved "Bookmarks" answer nearly
the same question for a viewer: *the things I care about*. A Netflix user has **one** such place.
Here there are four, in three locations, with different identity rules — the library keys on a
normalised title (so one film from five providers is one entry) while bookmarks key on the
provider page. Both rules are individually correct and `CLAUDE.md` explains why; **the product
mistake is exposing both as top-level destinations.**

**Fix.** One **"My stuff"** destination with segmented sections: *Continue watching* ·
*Saved* · *Downloaded* · *Watched*. Keep every store — the identity rules are right and
re-keying them would break resume and re-open. Change only the navigation and the labels.
Demote History to a section inside it; demote Extensions to Settings (a Netflix user never opens
it, and a technical user will find it in Settings) while keeping a direct route for when a
provider fails.

**Acceptance.** A first-time user can find "the thing I was watching" in one click from launch.
No store is deleted or re-keyed.

---

### UX-02 — There is no onboarding, only a banner
**Severity:** UX-high · **Effort:** 2 days

**Evidence.** `FirstRunBanner.tsx` is the entire first-run experience: a dismissible strip
reporting bootstrap progress. It is well written — it explains the wait, it says search still
works, it shows a real percentage. It is also **the only thing that ever explains this app to
anyone.**

**What a new user is never told.** What an extension is. Why some titles have thirty sources and
some none. That "no sources" usually means *that provider* has nothing, not that the app is
broken. That sources come from third parties whose sites go down. That adult content is off and
where the switch is. That downloads need extra components.

**Fix.** A three-screen first-run flow (skippable, re-openable from Settings → About):
1. *Where films come from* — extensions are community scrapers; some work, some don't; you can
   turn them off. One sentence and a diagram.
2. *Set up playback* — one button that installs ffmpeg/mpv/aria2 (via the now-fixed `P0-01`),
   with a plain-language reason: "so 4K and unusual audio play without re-encoding".
3. *Preferences* — content languages, adult content on/off, download folder.

Then keep the existing banner for the background install.

**Acceptance.** A person who has never seen the app reaches a playing film without asking a
question. Test on one real human.

---

### UX-03 — Every error is honest and none of them is a next step
**Severity:** UX-high · **Effort:** 2 days

**Evidence.** The message inventory is genuinely good — precise, non-blaming, no invented causes:

> `No source could open this title.` · `The extension provider returned no playable links for this item.` ·
> `None of the sources found carry a usable magnet, torrent or stream link.` ·
> `No data arrived within the time budget.`

These are excellent *diagnostics*. To a Netflix user they are all the same sentence: **"no".**

Only one message in the whole inventory tells the user what to do next, and it is the best one in
the app:

> `No indexers are enabled for this content type. Add a Jackett or Prowlarr indexer in Settings → Sources.`

**Fix.** Give every terminal failure a primary action, in this order of preference:
*Search all sources* (the `canWiden` path already exists) → *Try another source* → *Download
instead* (`PlaybackErrorPanel` already leads with this and it is the right instinct) →
*Open in VLC* → *Report this*. Keep the precise sentence — as the *secondary* line, under the
action. Never show a dead end.

**Acceptance.** Every code path that renders a failure string offers at least one button. Audit by
grepping the failure strings and checking each render site.

---

### UX-04 — You cannot open a file you already have
**Severity:** UX-high · **Effort:** 1 day

**Evidence.** No file-open path exists. `mediaProxy` already serves local files
(`serveLocalFile`, `/local/<token>`, `mediaProxy.ts:335-372`) and the whole inspect→decide→play
engine is source-agnostic. **The capability is built and has no entry point.**

**Why it matters.** The app downloads films and then cannot play them from disk. A user's own MKV
— the exact 10-bit HEVC + DTS file this app's engine was built for — cannot be opened at all. And
per `P1-07`, dragging one onto the window currently destroys the app.

**Fix.** File → Open (see `ENG-08` for the menu), drag-and-drop onto the window, and a "Play" on
completed downloads that opens in-app rather than only revealing in Explorer. All three route
through `media:prepare` like everything else. **Do not add a code path that assigns `video.src`
directly** — INV-RACE-1.

**Acceptance.** Dropping a 4K HEVC MKV plays it, routed to mpv under the `auto` policy.

---

### UX-05 — The app is dark-only, in a fixed palette
**Severity:** UX-medium · **Effort:** 2 days

**Evidence.** `src/index.css:3-28` — one `:root`, 21 tokens, no `prefers-color-scheme`, no
`[data-theme]`, no light values anywhere. Android CloudStream ships multiple themes plus accent
colours.

**Fix.** Sequenced with `AES-01` (which has to happen first): define the palette as semantic
tokens, add a light set under `:root[data-theme="light"]` and `@media (prefers-color-scheme: light)`,
and a Settings → Appearance control with System / Dark / Light. Dark stays the default — it is
right for a media app.

**Acceptance.** Toggling the theme repaints every screen with no hardcoded colour surviving.
That is only checkable after `AES-01`.

---

### UX-06 — No English other than English
**Severity:** UX-medium · **Effort:** 1 week

**Evidence.** Zero i18n infrastructure — no `i18n`, `react-intl`, `useTranslation`, or locale
files anywhere in `src/` or `electron/`. Every string is inline.

**Why it matters here specifically.** `CLAUDE.md` documents that Hindi releases are where the hard
cases cluster and that a matrix of English titles "reports a compatibility story that is true for
half the catalogue". The *content* audience is explicitly multilingual; the *interface* assumes
English. Android ships dozens of locales.

**Fix.** This is a large, mechanical change and should not be attempted alongside anything else.
Sequence: (1) extract strings to `src/i18n/en.json` with a tiny `t()` — no dependency needed for
a flat key/value map; (2) ship English only; (3) accept community translations later. Doing
extraction *before* the aesthetics work (`AES-01`) is wrong — extract after, or the strings move
twice.

**Acceptance.** No user-visible literal outside `src/i18n/`. Verify with a lint rule.

---

### UX-07 — Nothing tells you the machine is offline
**Severity:** UX-medium · **Effort:** 4 hours

**Evidence.** `navigator.onLine` is used nowhere. Offline, every provider fails independently and
the user gets thirty separate honest failures instead of one true sentence.

**Fix.** Watch `online`/`offline` in the renderer; when offline show one banner and switch the
home screen to the cached catalogue (`discovery.ts:60` already keeps cached content past its TTL
precisely as the offline fallback — the data path is built, the signal is not). Suppress
per-provider error noise while offline.

**Acceptance.** Pull the network cable: one banner, the home screen still renders from cache, no
error storm.

---

### UX-08 — Window size and position are forgotten every launch
**Severity:** UX-low · **Effort:** 2 hours

**Evidence.** `main.ts:527-533` hardcodes 1360×860 with no persistence and no `maximize` restore.

**Fix.** Persist bounds + maximized state in the datastore (it is already the right home for
this), restore on launch, and clamp to the current display bounds — a window restored onto a
disconnected second monitor is invisible, and this app already learned that lesson for the mini
player (`useMiniFrame`'s clamp-on-resize).

**Acceptance.** Maximize, quit, relaunch: still maximized. Restore onto a removed display: window
appears on the primary.

---

### UX-09 — "Runtime status" has no repair action
**Severity:** UX-medium · **Effort:** folded into `P0-02`

The status card can say `stale`, `not ready`, or name a blocked reason. The user's only available
verbs are `provision`, `test` and `clean`, exposed as separate technical buttons. The action a
user wants is **"fix it"**. Implement `runtime:repair` (`P0-02`) as clean + provision + reload
and make it the primary button; keep the three as advanced.

---

### UX-10 — A blocked extension does not say why on the extension's own row
**Severity:** UX-medium · **Effort:** 3 hours

`extension:getRuntimeReport` exists and is unreachable (`P0-05`). That report is the per-plugin
tier and blocked reason — the single most useful fact about an extension that registered nothing.

**Fix.** Expose it and render it on the extension row in `SourceTree`: tier badge
(`T1_DROPIN`/`T3_DEGRADED`/`T4_BLOCKED`) and, when blocked, the reason verbatim with a *Copy
report* button. `CompatibilityReport.tsx` already knows how to render this shape.

**Acceptance.** An extension that fails to load shows its reason without opening Settings →
Diagnostics.

---

### UX-11 — "1-Click Downloader Engines Configured Successfully!" and friends
**Severity:** UX-low · **Effort:** 2 hours

`BinarySetupModal.tsx:38` and its siblings speak in marketing register
("Connecting to high-speed mirrors…", "✓ … Configured Successfully!") while the rest of the app
speaks plainly and well. It reads like a different product, and — per `P0-01` — it is lying.

**Fix.** Match the house voice, which is already established and good: say what is happening, in
lowercase, without exclamation marks. "Downloading aria2 (2.1 MB)…" / "Ready. Downloads will use
aria2."

---

### UX-12 — Sixteen destinations for settings
**Severity:** UX-medium · **Effort:** 1 day

Seven sidebar tabs × seven settings tabs, plus preferences reachable only from inside dialogs
(the delete-download preference — which Settings correctly rescues, and that rescue is itself
evidence of the pattern).

**Fix.** Add a settings search box that filters across all seven panes by label and hint text.
This is far cheaper than reorganising and solves the actual problem, which is *finding* a setting,
not its taxonomy.

---

### UX-13 — Adult content: verify the gate is visible before it is needed
**Severity:** UX-low · **Effort:** 1 hour

The enforcement point is correct and central (`PluginManager.enabledProviderNames`). Confirm the
*setting* is discoverable and that turning it on explains what changes — four bundled repositories
publish NSFW-tagged plugins, one of which is in the bundled set. A user who never finds the switch
should never see the content; a user who wants it should not have to guess.

---

### UX-14 — Long operations have no cancel
**Severity:** UX-medium · **Effort:** 1 day · **measure first**

Search has `search:cancel`. Audit whether repository installation (tens of downloads + DEX
translations), batch season downloads, and embedded-subtitle extraction (bounded at three
minutes, reads the whole file) each expose a cancel to the UI. Anything that can run longer than
~5 seconds needs one.

---

### UX-15 — There is no "why is this slow" affordance
**Severity:** UX-low · **Effort:** 4 hours

The app does genuinely slow things for genuinely good reasons: warming 124 archives in the
background, probing a 25GB remote file, extracting subtitles from a whole MKV. `CLAUDE.md` notes
that "invisible work is indistinguishable from no work" and the detail page already applies this
("3 sources ready"). Extend the same idea to a small status affordance in the sidebar footer:
what the app is doing right now, expandable.

---

### UX-16 — The probe timeout is not adjustable by the user who needs it
**Severity:** UX-low · **Effort:** folded into `P0-05`

`media:get/setProbeConfig` is registered and unreachable. On a slow or high-latency connection
every source "fails" because ffprobe ran out of budget. Expose it in Settings → Advanced with a
plain explanation.

---

## 7. AES — Aesthetics and design system

### AES-01 — 197 hardcoded hex colours in TSX, and 21 design tokens that are half-used
**Severity:** AES-high · **Effort:** 2 days · **blocks UX-05**

**Evidence.**

| | Count |
|---|---|
| Hex literals in `.tsx` | **197** |
| Distinct hex values | 30+ |
| Design tokens defined | 21 (`index.css:3-28`) |
| Worst offenders | `HistoryView` 54 · `PlayerDownloadPanel` 24 · `UnifiedComponentManager` 21 · `LibraryView` 15 |

`#60a5fa` appears 27 times as a literal — while `--accent-light: #60a5fa` is defined and unused at
those sites. Same for `#3b82f6` (11 uses) vs `--accent-primary`, `#161b26` (7) vs `--bg-card`.

**Symptom.** The palette cannot be changed. No theme is possible (`UX-05`), no accent colour is
possible, and the colours already drift — `#f87171`, `#ef4444`, `#fb7185`, `#f43f5e` and
`#fca5a5` are five reds where the token set has one.

**Fix.** Map every literal to a token; add the tokens the literals prove are missing (a
`--status-*` family with `-bg`/`-border`/`-text` variants, since the current three are text-only
and every call site invents its own tinted background). Purely mechanical.

**Acceptance.** `grep -roE '#[0-9a-fA-F]{3,8}' src --include='*.tsx' | wc -l` returns 0 (icon
`fill="#fff"` on a video surface is the one defensible exception; allow-list it explicitly).

---

### AES-02 — 415 inline style objects; three screens are styled entirely inline
**Severity:** AES-high · **Effort:** 3 days

**Evidence.**

| File | `style={{` |
|---|---|
| `HistoryView.tsx` | **144** |
| `UnifiedComponentManager.tsx` | 74 |
| `DownloadCenter.tsx` | 63 |
| `PlayerDownloadPanel.tsx` | 35 |
| `LibraryView.tsx` | 34 |
| …23 more files | 65 |

A representative row (`HistoryView.tsx:743-756`) carries eleven inline declarations including its
own `transition: 'all 0.15s ease'` — which is not `var(--transition)`'s
`all 0.2s cubic-bezier(0.4, 0, 0.2, 1)`. So rows in History animate differently from every other
card in the app, and nobody decided that.

**Symptom.** These screens cannot be themed, cannot respond to a breakpoint, re-create every style
object on every render, and drift from the design language one literal at a time. Put
`HistoryView` next to `DetailView` (which is properly classed) and they look like two products.

**Fix.** Convert to classes in the split stylesheets from `P3-03`, screen by screen, worst first:
History → UnifiedComponentManager → DownloadCenter → PlayerDownloadPanel → Library. Keep
genuinely dynamic values inline (`width: ${percent}%`) — that is what inline style is for.

**Acceptance.** Under 40 `style={{` remain, each carrying a computed value.

---

### AES-03 — No spacing, type, or elevation scale
**Severity:** AES-medium · **Effort:** 1 day

The token set has radii and one transition. It has **no** spacing scale, **no** type scale, **no**
shadow scale — so every component invents them: `0.75rem 1rem`, `0.85rem`, `0.35rem 0.75rem`,
`0.72rem`, `0.65rem`, `1.75rem`. Font sizes in the wild include `0.72rem`, `0.85rem` and
`0.7rem`, which are three different smalls.

**Fix.** Add `--space-1…8` (4px base), `--text-xs…xl`, `--shadow-1…3`, `--elev-*`. Adopt during
`AES-02` rather than as a separate pass — the conversion touches those lines anyway.

---

### AES-04 — Only three responsive breakpoints in 5,584 lines of CSS
**Severity:** AES-medium · **Effort:** 1 day · **`needs-app-run`**

**Evidence.** `App.css` has six `max-width: 1024px` rules; `sources.css` has one at 720px and one
at 480px. The window's `minWidth` is 960 (`main.ts:530`).

**Symptom to verify.** At 960–1100px — a perfectly ordinary laptop with the window not maximized —
the sidebar + content + a source panel is likely to overflow or crush. There is no evidence anyone
has looked.

**Fix.** Test at 960, 1280, 1440, 1920 and 2560. Fix what breaks. Then decide whether `minWidth`
960 is honest.

---

### AES-05 — `--transition: all 0.2s` on everything
**Severity:** AES-low · **Effort:** 2 hours

`all` transitions every animatable property, including layout ones, on every state change. It is
the reason hover states can feel slightly mushy and it costs compositor work on lists.

**Fix.** Replace with explicit property transitions (`background-color`, `border-color`, `opacity`,
`transform`) as part of `AES-02`. Add `--transition-fast` (120ms) for hover and keep 200ms for
larger state changes.

---

### AES-06 — Empty states are one sentence of body text
**Severity:** AES-medium · **Effort:** 1 day

**Evidence.** Grepping for skeletons, shimmers or empty-state components returns essentially
nothing. `SearchView.tsx:331` is representative: `<p>{emptyReason ?? 'No results.'}</p>`.

**Symptom.** An empty Library, an empty History, an empty Downloads list and a search with no
results all render as a mostly-blank screen. For a new user, *every screen except Home is empty*
— so the app's first impression is five blank pages.

**Fix.** A shared `<EmptyState icon title description action />`. Give each its own copy and a
button: empty Library → "Nothing saved yet" + *Browse home*. Empty Downloads → "No downloads" +
*How downloading works*. No results → the reason + *Search all sources*.

**Acceptance.** Every list route renders a designed empty state.

---

### AES-07 — Loading is spinners, where the shape is known
**Severity:** AES-low · **Effort:** 1 day

Home rows, search results, the extension catalogue and the source list all have a known row shape
and a known count. Skeletons in place of spinners make the app feel materially faster for zero
functional change. Do this after `AES-02`, since it needs the classes.

---

### AES-08 — Emoji in the interface
**Severity:** AES-low · **Effort:** 30 minutes

`PosterCard.tsx:104` renders `🎯 Selected` on a badge. The app otherwise uses `lucide-react`
consistently and well. Emoji render differently on every platform, do not inherit colour, and read
as unfinished next to a proper icon set. Replace with a lucide icon; sweep for others.

---

## 8. A11Y — Accessibility

### A11Y-01 — Focus is removed and not always restored
**Severity:** A11Y-high · **Effort:** 1 day

**Evidence.** `outline: none` appears at `index.css:131,357`, `sources.css:2288,2464,3151,3579`,
`extensions.css:285,365` — eight sites. `:focus-visible` replacements exist at only some of them.

**Symptom.** A keyboard user loses the cursor. In a full-screen dark app that is total — there is
no way to tell where you are.

**Fix.** Every `outline: none` gets a matching `:focus-visible` rule in the same block. Add a
global fallback: `:focus-visible { outline: 2px solid var(--accent-light); outline-offset: 2px; }`
early in `index.css` so a missed site degrades to visible rather than invisible.

---

### A11Y-02 — No modal focus trap, and focus is never restored on close
**Severity:** A11Y-high · **Effort:** 1 day

**Evidence.** Three `aria-modal`, one `aria-labelledby`, zero focus traps, zero focus restoration
across the whole tree. Tab from an open `SourcePicker` walks into the page behind it.

**Fix.** The `<Modal>` extraction from `P1-04`: focus the first focusable element on open, trap
Tab/Shift+Tab within, restore focus to the trigger on close, `aria-labelledby` pointing at the
heading, Escape to close. Convert `DeleteDownloadDialog`, `SourcePicker`, `SeasonDownloadDialog`,
`BinarySetupModal`.

---

### A11Y-03 — Clickable `div`s that are not reachable by keyboard
**Severity:** A11Y-medium · **Effort:** 4 hours

**Evidence.**
- `PosterCard.tsx:89` — `<div className="poster-container" onClick={handleCardClick}>` (the primary
  navigation control of the entire app)
- `LibraryView.tsx:284` — same shape
- `HistoryView.tsx:760` — the selection checkbox is a `div`
- `HistoryView.tsx:767` — the poster/metadata link is a `div`

**Symptom.** A keyboard user cannot open a title. The CSS at `index.css:169` styles
`.poster-card:focus-visible`, which implies someone intended the card to be focusable — and it is
not.

**Fix.** `<button>` where the action is a command, `role="link"` + `tabIndex={0}` + Enter/Space
where it is navigation. `PosterCard` already gets the nested-interactive case right (the play
overlay is a real `<button>` with `stopPropagation`), so only the container needs changing.

---

### A11Y-04 — `prefers-reduced-motion` covers two of four stylesheets
**Severity:** A11Y-medium · **Effort:** 2 hours

Honoured in `extensions.css:453` and `sources.css:4947`; absent from `index.css` (which owns the
`.spin` keyframe used by every loading indicator) and `App.css`. Add a global reduced-motion block
in `index.css` covering `.spin`, transitions and transforms.

---

### A11Y-05 — Icon-only buttons and live regions
**Severity:** A11Y-medium · **Effort:** 4 hours

354 `<button>`s, 108 `aria-label`s. Most buttons have text, so the gap is icon-only controls —
audit and label each. Only two `aria-live` regions exist (`VideoPlayer.tsx:2746` toasts,
`FirstRunBanner` `role="status"`), both correct; extend the pattern to the other toast sites once
`P1-03` centralises them.

---

### A11Y-06 — No landmarks, no skip link, `<html lang>` never updated
**Severity:** A11Y-low · **Effort:** 2 hours

`index.html` is `lang="en"` and static (relevant once `UX-06` lands). No `<nav>`/`<main>`
landmarks; no skip-to-content. Cheap and standard.

---

## 9. PAR — Android parity gaps

These are things the Android app does that this one does not. `CLAUDE.md` §5 correctly reports
that the *class-translation* problem is closed. These are the remaining product gaps.

### PAR-01 — No account sync: Trakt, MAL, SIMKL, AniList
**Severity:** PAR-high · **Effort:** 1–2 weeks · **the single largest parity gap**

**Evidence.** `docs/docs_cs3/06` §"sync providers" lists four: AniList (OAuth2 GraphQL), MAL
(OAuth2 REST), SIMKL (client id/secret), Trakt.tv (OAuth2 REST) — scrobbling, watchlist sync,
ratings. Desktop has **none**. The `syncproviders` cluster is shimmed in `sidecar/bridge/` with
every operation returning null, correctly and deliberately, because there is no signed-in account
*here*.

**Why it matters.** Watch history is currently trapped on one machine, in six local JSON stores,
with no way out except `library:export`. Android users switching to desktop lose their watchlist
and stop scrobbling — for a media tracker audience that is disqualifying.

**Fix (sequenced, do not attempt at once).**
1. Trakt first — best-documented device-code OAuth flow, covers film + TV, no client secret needed
   in a distributed app if device flow is used.
2. Then AniList (anime, and the app already speaks AniList's public GraphQL in
   `homeProviders.ts:247` and `metadataProvider.ts` — the client exists, only auth does not).
3. Then SIMKL, then MAL.

**Constraint that shapes the design.** `CLAUDE.md` records that a distributed client cannot embed
an API key without violating the licence and getting revoked — that is why TMDB/Trakt/OMDb were
eliminated for the *home screen*. Sync is different: the user brings their own account and
authorises the app. Device-code flow with a public client id is the correct shape. **Do not ship
a client secret.**

Once real, the shimmed `AccountManager`/`SyncRepo` in the bridge could return live data —
but that is a second decision and should be taken separately; the shims are currently honest.

---

### PAR-02 — No Chromecast / DLNA / AirPlay
**Severity:** PAR-medium · **Effort:** 1 week

**Evidence.** No cast code anywhere. Android casts.

**What makes it tractable here.** `mediaProxy` already serves every stream over loopback HTTP with
headers applied — that is 80% of what a cast receiver needs. Binding it to the LAN interface for a
cast session (opt-in, per-session, on a random port, with a random token per `P2-01`) is the main
piece of work. `externalPlayerControl.ts`'s *declared capability* pattern is the right model:
declare what each receiver can actually do rather than pretending.

---

### PAR-03 — No app auto-update
**Severity:** PAR-high · **Effort:** 3 days

**Evidence.** No `electron-updater`, no `build.publish` block. Extensions update over the air
(`extensionUpdater.ts`, on a schedule, with rollback) — the app itself never does.

**Symptom.** Every fix in this document reaches a user only if they notice a release and reinstall.
For an app whose whole value depends on tracking a moving third-party ecosystem, that is the wrong
asymmetry: the extensions self-heal and the host does not.

**Fix.** `electron-updater` with a GitHub Releases feed; check on launch and every 24h; download
in the background; prompt to restart, never force. **Do not auto-restart during playback** —
the `mpv` and download shutdown paths make an interrupted restart expensive.

Requires `ENG-02` (signing) to avoid a SmartScreen warning on every update.

---

### PAR-04 — Verify continue-watching and resume against Android's semantics
**Severity:** PAR-medium · **Effort:** 1 day · **measure first**

The pieces exist (`continueWatching.ts`, `libraryStore`, `PlayedSource`, `bookmarkStore`) and
`CLAUDE.md` documents each rule carefully. What has not been checked is whether the *composed*
behaviour matches Android: when a row appears, when it disappears, what "watched" means, whether
next-episode auto-advance updates it. Compare against `docs/docs_cs3/06` and write down the diff
before changing anything.

---

### PAR-05 — Measure the TLS `unrecognized_name` rate before spending anything on it
**Severity:** PAR-low · **Effort:** 2 hours (measurement only)

`CLAUDE.md` names this as the one remaining *named* divergence and states plainly that its
frequency is unmeasured, because the harness prints only the last 15 lines of sidecar stderr.

**Now measurable.** `sidecarStderr.ts` classifies lines and `extensionIssues.ts` counts distinct
problems durably. Run a real session, then query the ledger for the `SSLHandshakeException` row.
**Do not implement the per-connection SNI fix until the count justifies it** — and never apply
`-Djsse.enableSNIExtension=false` globally, for the reason already documented.

---

## 10. ENG — Engineering, release, legal

### ENG-01 — No CI
**Severity:** ENG-high · **Effort:** 4 hours

**Evidence.** `.github/` contains only `hooks/`. No workflows.

**Fix.** One workflow on push/PR: `tsc -b` → `oxlint --deny-warnings` → `npm run test:electron`
→ `mvn -f sidecar test`. Everything already exists and passes; nothing enforces it. Add the IPC
parity test from `P0-06` to the same job.

**Do not** put `provider-e2e.mjs` or the vendor matrix in CI — they hit live third-party sites
and would fail for reasons that are not ours. Run them on a schedule with a soft failure, or by
hand.

---

### ENG-02 — Windows-only packaging, no icon, no signing
**Severity:** ENG-high · **Effort:** 2 days

**Evidence.** `build` has a `win` key with `["nsis","portable"]` and nothing else — no `mac`, no
`linux`, no `icon`, no `nsis` block, no signing, no `publish`.

**Consequences.** The installer ships with the default Electron icon. Windows SmartScreen warns on
every download of an unsigned NSIS installer — for an app in this category, "unknown publisher"
is the exact prompt that stops installs. And `PAR-03` (auto-update) needs `publish`.

**Fix.** Add app icons for all three platforms; add `mac` (dmg, `hardenedRuntime`, notarization
placeholder) and `linux` (AppImage + deb) targets — `CLAUDE.md` already documents that mpv should
be `required: false` there and that a distribution package should depend on system mpv; add
`publish` for GitHub Releases; wire signing certificates through CI secrets.

---

### ENG-03 — The packaged app fetches its font from Google on every launch
**Severity:** ENG-high (privacy + offline) · **Effort:** 1 hour

**Evidence.** `src/index.css:1`:

```css
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');
```

**Three problems, in order of severity.**
1. **Privacy.** Every launch of a packaged desktop app sends the user's IP and User-Agent to
   Google. For an app in this category, whose users routinely use VPNs specifically to avoid
   exactly this, it is the wrong default and it is invisible to them.
2. **Offline / blocked networks.** The font silently fails and the app renders in the fallback
   stack. On a network where `fonts.googleapis.com` is blocked, the request also *hangs* before
   falling back.
3. It blocks `P2-02`'s CSP, which would otherwise not need to allow a third-party style and font
   origin at all.

**Fix.** Vendor the Inter woff2 subsets into `src/assets/fonts/` and `@font-face` them locally.
Inter is OFL — attribution goes in the licence notice (`ENG-04`). ~100KB for the weights in use.

**Acceptance.** Launch with the network disabled: the app renders in Inter. No request to any
`google` host appears in the network log.

---

### ENG-04 — No LICENSE file, on a GPL-3.0 derivative
**Severity:** ENG-high (legal) · **Effort:** 1 hour

**Evidence.** `ls LICENSE*` at the repo root: no such file. `CLAUDE.md` states plainly:
*"upstream CloudStream is GPL-3.0. Behave accordingly with derived code."*

This repository is a port of a GPL-3.0 Android application, vendors 26 community extension
repositories as submodules, and bundles third-party binaries (ffmpeg, mpv, aria2, yt-dlp, a JRE)
each with its own terms.

**Fix.**
1. `LICENSE` at the root: GPL-3.0, with the upstream copyright preserved.
2. `THIRD-PARTY-NOTICES.md` listing every bundled binary and npm dependency with its licence
   (ffmpeg's build configuration matters — GPL vs LGPL — and must be stated accurately).
3. Surface both in the app: Settings → About → Licences.

This is not optional housekeeping. It is the one item here whose absence has consequences outside
the codebase, and it is an hour of work.

---

### ENG-05 — Zero renderer tests, for 35,842 lines of renderer
**Severity:** ENG-medium · **Effort:** 2 days

**Evidence.** The suites cover `electron/` well and deliberately (`sharedDiscovery`, the media
suites, the taxonomy, the pure utils — and `CLAUDE.md` explains why each earns its tests). `src/`
has **none**, including `VideoPlayer.tsx` at 3,481 lines.

**Do not add a component-testing framework.** That would contradict the deliberate no-framework,
type-stripping design that makes the current suites maintenance-free.

**Do** extend the same pattern to renderer *logic*, which is where the testable value is and
which imports nothing from React: `src/utils/sourceFilter.ts` (288 lines), `resultGroups.ts`,
`contentTypes.ts`, `subtitleStyle.ts`, `clearKey.ts` — several of which already have the
"silent when wrong" property that earned the others their tests. Add `.test.mts` files beside
them and a `test:utils` script.

---

### ENG-06 — `main.ts` is 3,536 lines and `pluginManager.ts` is 3,028
**Severity:** ENG-medium · **Effort:** 3 days · **read the warning first**

`CLAUDE.md` documents that the 25-commit `main.ts` → `ipc/*` refactor from `claude/refine` was
**deliberately not merged**, because that branch forked before the streaming stack and applying it
would delete modules it never knew about. That reasoning still stands.

**So: re-derive, do not cherry-pick.** Extract `ipc/` modules from the *current* `main.ts`, one
namespace per commit, each a pure move with no behaviour change, using the `refine` modules only
as a template. Land `P0-06` (the parity test) **first** — it is exactly the safety net this
refactor needs.

---

### ENG-07 — 96 uses of `any`, concentrated in IPC and error handling
**Severity:** ENG-low · **Effort:** 1 day

Mostly `catch (err: any)` (a `unknown` + narrow away) and the datastore's genuinely dynamic
`getSetting/setObject` signatures (which are defensible — the datastore is a key/value store with
Android's six-bucket grammar). Convert the catches; leave the datastore and note why.

---

### ENG-08 — No application menu, on any platform
**Severity:** ENG-medium · **Effort:** 4 hours

**Evidence.** `main.ts:544` — `Menu.setApplicationMenu(null)`.

**Consequences, worst first.**
1. **On macOS this removes Cut/Copy/Paste/Select-All/Undo entirely.** Those are menu *roles* on
   macOS, not native input behaviour. With no menu, `Cmd+C` does nothing in the search box. There
   is also no Quit item and no About.
2. No zoom reset. Chromium's `Ctrl+Wheel` zoom is live; a user who accidentally zooms has no way
   back without DevTools.
3. Every shortcut in the app is undiscoverable, which is why `P0-04`'s inspector is invisible.

**Fix.** A real menu: File (Open… → `UX-04`, Quit), Edit (the standard roles — this is the macOS
fix), View (Reload gated per `P1-08`, Zoom In/Out/Reset, Toggle DevTools), Help (Diagnostics,
Licences → `ENG-04`, About). Hiding it behind Alt on Windows/Linux (`autoHideMenuBar: true`) keeps
the current clean look while restoring all of the above.

---

### ENG-09 — `docs/PRD/33` is documented as stale and still stale
**Severity:** ENG-low · **Effort:** 2 hours

`CLAUDE.md` flags it: it references `electron/cs3ArchiveLoader.ts` and `electron/jvmProviderBridge.ts`,
neither of which exists, and contains absolute `D:\dipen\cs3\…` paths from one machine. Fix the
paths and the module names, or add a header marking it superseded.

---

### ENG-10 — `error_logs_large.log` at the repo root
**Severity:** ENG-trivial · **Effort:** 2 minutes

Untracked (covered by `*.log`) and harmless, but it is a real user's captured session sitting in
the working tree. Move it to `.temp/` or delete it — a log of someone's viewing session is not a
thing to leave lying next to `git add -A`.

---

## 11. Suggested execution order

Sequenced so each wave unblocks the next, and so nothing large starts before the safety net exists.

**Wave 1 — one afternoon, retires a bug class.**
`P0-06` (parity test) → `P0-01` → `P0-02` → `P0-03` → `P0-04` → `P0-05` → `ENG-10`.
*Every dead IPC channel closed, with a test that keeps them closed.*

**Wave 2 — stop the app misbehaving.**
`P1-01`, `P1-02`, `P1-07`, `P1-08`, `P1-09`, `ENG-08` (menu — it is also the fix for two of these).
*Lifecycle, navigation and shutdown are correct on all three platforms.*

**Wave 3 — legal and release, before any distribution.**
`ENG-04` (licence) → `ENG-03` (fonts) → `ENG-01` (CI) → `ENG-02` (packaging/signing) → `PAR-03` (auto-update).
*Now a fix can actually reach a user, legally and without a SmartScreen warning.*

**Wave 4 — the visual product.**
`AES-01` (tokens) → `AES-03` (scales) → `AES-02` (inline styles) → `P3-03` (CSS split) →
`AES-06` (empty states) → `A11Y-01`, `A11Y-02`, `A11Y-03` → `UX-05` (themes).
*Strict order: themes are impossible before tokens; the CSS split is safest after the inline-style
conversion, not before.*

**Wave 5 — the experience.**
`UX-02` (onboarding), `UX-03` (actionable errors), `UX-04` (open a file), `UX-01` (navigation),
`UX-07` (offline), `P1-03`, `P1-05`.

**Wave 6 — parity and scale.**
`PAR-01` (Trakt first), `P3-01` (virtualization), `UX-06` (i18n), `ENG-06` (main.ts split),
`PAR-02` (cast).

**Continuous, unordered:** `P2-01`, `P2-02`, `P1-06`, `ENG-05`, `PAR-05`.

---

## 12. Verification commands

Baseline, run from `cs3_windows/`:

```bash
./node_modules/.bin/tsc -b --force      # must exit 0
npx oxlint --deny-warnings electron src # 12 warnings today; target 0 after P1-06
npm run test:electron                   # all suites, 0 failures
```

Aesthetics counters — these are the acceptance metrics for `AES-01` and `AES-02`:

```bash
grep -roE '#[0-9a-fA-F]{3,8}' src --include='*.tsx' | wc -l   # 197 → 0
grep -rc 'style={{' src --include='*.tsx' | grep -v ':0' \
  | awk -F: '{s+=$2} END {print s}'                            # 415 → <40
```

IPC parity — the implementation of `P0-06`:

```js
// node -e "$(cat this)"  — or lift into electron/ipcSurface.test.mts
const fs = require('fs');
const main = fs.readFileSync('electron/main.ts', 'utf8');
const pre  = fs.readFileSync('electron/preload.ts', 'utf8');
const grab = (s, re) => new Set([...s.matchAll(re)].map(m => m[1]));

const registered = grab(main, /ipcMain\.(?:handle|on)\(\s*'([^']+)'/g);
const invoked    = grab(pre,  /(?:invoke|send)\(\s*'([^']+)'/g);
const pushed     = grab(main, /webContents\.send\(\s*'([^']+)'/g);
const listened   = new Set([
  ...grab(pre, /ipcRenderer\.on\(\s*'([^']+)'/g),
  ...grab(pre, /subscribe\(\s*'([^']+)'/g),
]);

const diff = (a, b) => [...a].filter(x => !b.has(x)).sort();
console.log('dead button      :', diff(invoked, registered));
console.log('unreachable API  :', diff(registered, invoked));
console.log('lost event       :', diff(pushed, listened));
console.log('dead listener    :', diff(listened, pushed));
```

Expected today (all four must be empty after Wave 1):

```
dead button      : [ 'binary:setupBinaries', 'runtime:repair' ]
unreachable API  : [ 'binary:check', 'binary:setup', 'extension:getRuntimeReport',
                     'media:getProbeConfig', 'media:setProbeConfig' ]
lost event       : [ 'discover:invalidated' ]
dead listener    : []
```

Extension health, before believing anything about providers (from the repo root):

```bash
node tools/e2e/provider-e2e.mjs --plugins 4 --queries "matrix,one piece"
node --experimental-strip-types tools/e2e/native-engine-matrix.mjs --plugins 12 --links 2
```

---

## 13. What this document does not cover

Stated so the next reader does not assume it was checked.

- **The sidecar and the DEX→JVM path.** Covered thoroughly in `CLAUDE.md` §5 and its 32 tests; the
  class-translation problem is closed and nothing here re-opens it.
- **Playback decision correctness.** `decisionEngine` is exhaustively tested against measurements
  that are expensive to reproduce. Do not touch it from this backlog.
- **Anything requiring a running Electron app.** Items marked **`needs-app-run`** are reasoned from
  code and Electron's documented defaults. They are likely, not observed.
- **Real-user performance.** Every performance item says *measure first*, and none of the numbers
  in §5 are from a profiler. Get them before optimising.
- **The extension corpus's current health.** Run the two harnesses above; the last figures in
  `CLAUDE.md` are from 2026-08-19 and third-party sites move.
