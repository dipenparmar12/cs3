# 26 — Electron Desktop Requirements

**Generated:** 2026-08-10 · **Revised:** 2026-08-12 (Windows-first scope; JVM sidecar)

Desktop capabilities that either replace an Android mechanism or exist only on desktop. Documented separately from parity features so the desktop surface is auditable on its own.

**Scope note.** Windows 10/11 x64 is the P0 shipping target ([29](29-platform-compatibility.md) §1). Requirements below that name macOS or Linux behavior remain binding **for those platforms' phases**; they do not gate the Windows release. Requirements written behind a platform abstraction (XP-0a) are P0 regardless of which implementations are filled in.

---

## 1. Window management

| ID | Requirement | Priority |
|---|---|---|
| DSK-1 | Resizable window; minimum 1024×640. | P0 |
| DSK-2 | Window size, position, monitor, and maximized state persist across restarts. | P1 |
| DSK-3 | A window restored onto a now-absent monitor is repositioned onto a visible one. | P1 |
| DSK-4 | Native fullscreen with correct behavior on macOS Spaces. | P0 |
| DSK-5 | Multi-monitor aware, including per-monitor DPI on Windows. | P1 |
| DSK-6 | Optional always-on-top mini-player with independently persisted bounds. | P2 |
| DSK-7 | The player may open in its own window, independent of the main window. | P2 |
| DSK-8 | Zoom (`Ctrl/Cmd +/-/0`) scales the whole UI; the level persists. | P2 |
| DSK-9 | Multiple main windows are **not** supported in v1 — a single instance is simpler and avoids data-race complexity. Second launches focus the existing window and forward any deep link. | P1 |

---

## 2. Input

| ID | Requirement | Priority |
|---|---|---|
| DSK-10 | Full keyboard shortcut map ([08](08-ui-and-interactions.md) §4). | P0 |
| DSK-11 | Shortcuts are user-remappable, with conflict detection. | P2 |
| DSK-12 | A discoverable shortcut reference (`?` / `F1`). | P1 |
| DSK-13 | Right-click context menus wherever Android has a long-press. | P0 |
| DSK-14 | Mouse wheel: scroll lists; volume over the player; seek over the seekbar with a modifier. | P1 |
| DSK-15 | Mouse back/forward buttons map to navigation. | P2 |
| DSK-16 | OS media keys (play/pause/next/previous) control playback. | P2 |
| DSK-17 | Touchscreen and precision-touchpad gestures where present. | P3 |
| DSK-18 | Gamepad navigation in 10-foot mode. | P3 |

---

## 3. Filesystem integration

| ID | Requirement | Priority |
|---|---|---|
| DSK-19 | Native file and folder dialogs for downloads path, backup path, subtitle files, imports, and plugin files. | P0 |
| DSK-20 | Drag-and-drop: subtitles onto the player, video files onto the window, backups onto the import screen, repository URLs onto Extensions. | P1 |
| DSK-21 | "Reveal in Explorer/Finder/file manager" for downloaded items. | P1 |
| DSK-22 | Recent-files list for locally opened media. | P3 |
| DSK-23 | The renderer never receives or sends a raw path (IPC-2). | P0 |
| DSK-24 | Free-space checks before download and before import snapshots. | P1 |

---

## 4. OS integration

| ID | Requirement | Priority |
|---|---|---|
| DSK-25 | Register all six protocol handlers plus `https://cs.repo`. On Windows this is registry-based and must survive both per-user and per-machine installs. | P1 |
| DSK-25a | `cloudstreamrepo://` and `csshare://` links opened from a browser install a repository or open shared content in a **running** instance, forwarding through the single-instance guard (DSK-58). This is how Android users actually add repositories, and it is the primary drop-in onboarding path. | P1 |
| DSK-26a | `.cs3` files are associated with the app on Windows, so a downloaded extension installs by double-click, and dragging one onto the window installs it (DX-10). | P2 |
| DSK-26 | File associations for common video extensions, `magnet:`, and `.torrent`. | P2 |
| DSK-27 | Native notifications for download completion, subscription updates, and background backup results — click-to-focus. | P1 |
| DSK-28 | Optional tray icon with show/hide and playback controls. | P3 |
| DSK-29 | Application menu bar; mandatory on macOS. | P1 |
| DSK-30 | Taskbar/dock progress during downloads. | P3 |
| DSK-31 | Jump list (Windows) / dock menu (macOS) with recent items. | P3 |
| DSK-32 | Prevent display sleep during playback; release on pause or stop. | P1 |
| DSK-33 | Optional launch at login. | P2 |
| DSK-34 | Optional start minimized or fullscreen — HTPC-relevant. | P3 |
| DSK-35 | Clipboard: copy stream links, share links, and repository URLs. | P2 |
| DSK-36 | Open external links in the system browser, never in-app (SEC-7). | P0 |

---

## 5. Application data

| ID | Requirement | Priority |
|---|---|---|
| DSK-37 | Platform-conventional data locations ([29](29-platform-compatibility.md) §2). | P0 |
| DSK-38 | XDG base directories respected on Linux. | P1 |
| DSK-39 | Downloads default to the OS Downloads folder in an app subfolder, user-changeable. | P0 |
| DSK-40 | Cache is separate from user data and safely deletable. | P0 |
| DSK-41 | Logs in the platform log directory, rotated, capped at 50 MB. | P1 |
| DSK-42 | Temp files are cleaned on startup and shutdown. | P1 |
| DSK-43 | Portable mode: a marker file beside the executable relocates all app data there. | P2 |
| DSK-44 | An in-app control opens each data location in the file manager. | P2 |

---

## 6. Updates

Detailed in [14](14-deployment-and-ci.md) §4.

| ID | Requirement | Priority |
|---|---|---|
| DSK-45 | Auto-update with signature verification; failure aborts and reports. | P0 |
| DSK-46 | Stable and prerelease channels. | P1 |
| DSK-47 | Update download does not block app use. | P2 |
| DSK-48 | A failed update never leaves an unusable installation. | P0 |
| DSK-49 | Changelog shown before applying. | P2 |

---

## 7. Crash recovery and resilience

| ID | Requirement | Priority |
|---|---|---|
| DSK-50 | A renderer crash reloads the view without losing persisted state. | P0 |
| DSK-51 | A plugin-host crash degrades to "provider unavailable". | P0 |
| DSK-52 | A player-backend crash offers the alternate backend. | P1 |
| DSK-53 | An interrupted import is detected on next launch and offers rollback or resume. | P0 |
| DSK-54 | An interrupted download resumes on next launch. | P1 |
| DSK-55 | A corrupt data store loads the most recent good snapshot with an explicit recovery dialog — **never a silent reset**. | P0 |
| DSK-56 | A safe-mode launch (modifier key held, or after repeated crashes) starts with plugins disabled — both runtimes, including the JVM sidecar (DROP-27). | P1 |
| DSK-56a | A JVM sidecar that fails to start — blocked by endpoint protection, AppLocker, or a corrupt bundle — degrades the app to "extensions unavailable" with an actionable message. **It never prevents launch** (DROP-34). | P0 |
| DSK-56b | A sidecar crash, hang, or OOM leaves the app running and the other providers usable, and attributes the failure to the specific plugin (AC-D4). | P0 |

---

## 8. Startup and lifecycle

| ID | Requirement | Priority |
|---|---|---|
| DSK-57 | Cold start to interactive under 2 s (PERF-1). The JVM sidecar is spawned **lazily on first provider use** and is explicitly outside this budget. | P0 |
| DSK-57a | Sidecar spawn to first provider response under 3 s (AC-D9). A warm sidecar is kept alive while any `.cs3` provider is enabled and idle-evicted after a configurable interval. | P1 |
| DSK-58 | Single-instance enforcement; a second launch focuses the existing window and forwards deep links. | P1 |
| DSK-59 | Graceful shutdown: flush state, pause downloads resumably, release wake locks. | P0 |
| DSK-60 | Confirm-on-exit honoring `confirm_exit_key`, particularly during active downloads or playback. | P1 |
| DSK-61 | Missed scheduled work (subscriptions, backups) is caught up on launch (ADR-7). | P1 |
| DSK-62 | On macOS, closing the last window quits by default; this is user-configurable. | P2 |

---

## 9. Offline behavior

| ID | Requirement | Priority |
|---|---|---|
| DSK-63 | The app starts and is fully usable offline: library, downloads, settings, local playback. | P1 |
| DSK-64 | Network-dependent areas show a clear offline state, not a spinner or a generic error. | P1 |
| DSK-65 | Offline never corrupts local state; failed writes to remote services are queued or reported, never silently dropped. | P0 |
| DSK-66 | Cached provider data renders with a staleness indicator when offline. | P2 |
| DSK-67 | Reconnection resumes downloads and refreshes stale views automatically. | P2 |

---

## 10. Desktop-only enhancements

Features Android does not have, justified by desktop context.

| ID | Enhancement | Rationale | Priority |
|---|---|---|---|
| DSK-68 | Multi-select with bulk actions in library and downloads | Expected on desktop; keyboard and mouse make it natural | P3 |
| DSK-69 | Searchable settings | ~100 keys is too many to navigate by category alone | P3 |
| DSK-70 | Download metadata sidecars | Makes a moved collection recoverable — addresses the gap upstream noted in `BackupUtils.kt:92-93` | P3 |
| DSK-71 | Explicit disk-space monitoring | Desktop users manage large collections and expect warnings | P1 |
| DSK-72 | Migration report inspection and export | Trust for the primary persona | P1 |
| DSK-73 | Snapshot browser and restore | Data-loss insurance made visible | P1 |
| DSK-74 | Provider request inspector (debug) | Serves the provider-developer persona | P3 |
| DSK-75 | Keyboard-driven command palette | Power-user affordance; cheap once shortcuts exist | P3 |

---

## 11. Explicitly out of scope for v1

| Item | Reason |
|---|---|
| Multiple simultaneous main windows | Complexity vs. benefit; DSK-9 |
| Browser-extension companion | Not an Android capability |
| Headless/server mode | Different product |
| Mobile-style background service | Contrary to desktop norms |
| Built-in VPN | Out of scope; `vpnStatus` remains advisory only |
| Cloud sync | [15](15-upgrade-and-modernization.md) FUT-1, after parity |

---

## Next steps

1. Implement DSK-1..6, 37..44, 50..62 in Phase 2 — they are foundational.
2. Defer DSK-68..75 until parity is demonstrated; enhancements before parity is a common failure mode.
3. Validate DSK-25..36 on Windows in Phase 11, and again per platform as macOS and Linux phases open; OS integration is where cross-platform assumptions break.
4. Treat DSK-56a as a Phase 2 deliverable, not a polish item. A bundled JVM is exactly the kind of component corporate endpoint protection blocks, and "the app won't start" is a far worse failure than "extensions are unavailable".
