# Codebase audit — security, reliability, engineering (PRD §125)

**Date:** 2026-10-14 · **Branch:** `feat/2026-10-improments-ux-ui` · **Scope:** the whole repository except the vendored extension corpus (`repositories/`, git submodules).

This is an engineering audit, not a certification. "Fixed" below means changed, with the evidence named in the same row; it does not mean the application is free of other defects. Nothing here was tested on macOS or Linux, and no artifact was installed on a clean machine.

---

## 1. Inventory

930 tracked files, about 180,000 lines of code outside `docs/`.

| Area | Files | Lines | Notes |
|---|---:|---:|---|
| `desktop/electron` (main process: services, IPC, media, torrent, metadata, sidecar supervision) | 210 | ~85,000 | `main.ts` alone: 7,066 lines, 353 `ipcMain.handle` |
| `desktop/src` (renderer: React 19) | 270 | ~80,000 | |
| `sidecar/` (Java 21 JSON-RPC host, Android shim, Kotlin bridge) | 108 | ~13,000 | |
| `tools/` (packaging, doctor, e2e, research) | 24 | ~7,000 | |
| CI (`.github/workflows`) | 2 | 266 | Never run on GitHub (AGENTS.md §3) |
| `repositories/` | submodules | — | Third-party extension corpus. **Out of scope.** |

**Trust boundaries reviewed:** renderer ↔ main (preload/IPC), main ↔ third-party web pages (WebView host, media proxy), main ↔ network (downloads of executables, provider fetches), main ↔ OS (process spawning, filesystem), main ↔ JVM sidecar (extensions), build ↔ release (CI, packaging).

## 2. Automated baseline

| Check | Result |
|---|---|
| `tsc -b` | clean |
| `bunx oxlint` | 0 errors, 36 warnings (13 `exhaustive-deps`, 19 `only-export-components`) — all pre-existing |
| `bun run test --fast` | **141 / 141 suites pass** (after the fixes below; this session added 11 suites and extended 5) |
| `bun run test proxy`, `pipeline` | pass (pipeline uses real ffmpeg) |
| `mvn package` (sidecar) | 53 tests, 0 failures |
| `npm audit --omit=dev` | 5 advisories, all one chain: `webtorrent → bittorrent-tracker → ip` (GHSA-2p57) |
| `bun audit` (all deps) | 51 advisories (30 high) — the additional 46 are build-time only (electron-builder, vite, `@electron/get`) or `cheerio → undici` |
| CycloneDX SBOM | generated (1.6, 204 production components) — now part of the release |
| Runtime: built app over the DevTools protocol | sandboxed preload exposes the API (382 methods), IPC round trip OK, no Node in the renderer, camera permission **denied**, home screen renders with **0 CSP violations, 0 console errors** |

Scanner output is reported as found; none of it is treated as a confirmed vulnerability without the analysis in §4.

## 3. Findings

Severity is by realistic likelihood × impact for a desktop media app whose renderer shows third-party text and images and whose extensions are third-party code.

### Fixed

| ID | Sev. | Finding | Where | Fix and evidence |
|---|---|---|---|---|
| SEC-01 | High | **Main window ran with `sandbox: false`.** A renderer compromise (it renders provider-supplied text and images) was one step from the OS. | `electron/main.ts` window `webPreferences` | `sandbox: true`; preload built as CommonJS `preload.cjs` (a sandboxed preload cannot be an ES module, and `"type": "module"` made it one; the format is set on `build.lib` because the plugin overrides `output.format`). Verified on the built app over CDP. |
| SEC-02 | High | **No permission handlers: Electron grants every request by default** — camera, microphone, geolocation, notifications — including to third-party challenge and provider pages loaded in the offscreen WebView host. Those pages could also download files and open popups. CWE-276. | `main.ts`, `cs3/webViewHost.ts` | Allowlist in `security/permissions.ts`: the app's own origin gets clipboard-write, fullscreen and EME (measured from the renderer); everything else is refused. The WebView partition refuses all permissions, downloads and popups. Tests: `security/permissions.test.mts`. Runtime: camera → `denied`. |
| SEC-03 | High | **Executables downloaded and run without integrity checks** (ffmpeg, aria2c, yt-dlp, mpv), with fallbacks through a third-party mirror (`ghproxy.net`) and a mutable branch file. Whoever controls the mirror controls code the app executes; the only "check" ran the binary. CWE-494, CWE-829. | `fastDownloader.ts`, `binaryDownloader.ts`, `platform/binarySources.ts` | Mirrors carry an optional SHA-256. First-party HTTPS origins (GitHub, gyan.dev) are trusted as the publisher; a third-party mirror is used **only** for an artifact with a pinned digest, and any digest is verified before the file counts as downloaded — a mismatch is deleted. Pinned digests: yt-dlp 2025.02.19 (its own `SHA2-256SUMS`), aria2 1.37.0 (hashed from GitHub; the mirror served identical bytes). mpv uses the `sha256:` digest GitHub's release API returns. Tests: `fastDownloaderIntegrity.test.mts` (real HTTP: wrong bytes rejected and removed), `binarySources.test.mts`. |
| SEC-04 | Medium | **Archive extraction through shell strings** — `unzip "<path>"` via `/bin/sh` (a `$(…)` in the path executes), `tar.exe "…"`, and a PowerShell command line built by quoting. CWE-78. | `binaryDownloader.extractZip` | `execFileSync` with argument arrays; PowerShell receives paths through environment variables, never as script. |
| SEC-05 | Medium | **Local file server allowed any file under `userData`** (the datastore, which holds Jellyfin keys), the temp folder and `process.cwd()` (a packaged app's launch folder — often the user profile); checked by string prefix, case-sensitively, without resolving symlinks/junctions. Also a **functional bug**: a download folder chosen in Settings was not allowed, so finished downloads there failed with "Access denied". | `mediaProxy.serveFile`, `main.ts` | `security/localFiles.ts`: media and subtitle files anywhere (the feature), any file only inside the download folders (now including the configured one); real paths compared by path segment, case-folded on Windows. Tests: `security/localFiles.test.mts`, new case in `mediaProxy.test.mts`. |
| SEC-06 | Medium | **`download:enqueue`/`request` accepted a renderer-supplied `targetFilePath`**, letting the IPC caller choose where provider bytes are written (a Startup folder included). | `main.ts` | Stripped at the IPC boundary; paths are always built in main from sanitised titles. The renderer never set one (`downloadIdentity.ts` sends `''`). |
| SEC-07 | Medium | **"System default player" launched `cmd /c start "" <url>`** — `&` in a provider URL ran as a command. CWE-78. | `externalPlayer.ts` | `rundll32 url.dll,FileProtocolHandler <url>`, no shell. Custom players are refused unless `.exe` on Windows (a `.bat` would be parsed by cmd). |
| SEC-08 | Low | **CI tokens over-privileged**: `release.yml` gave `contents: write` to every job, including build jobs running dependency install scripts; `ci.yml` used defaults. | `.github/workflows` | Read-only by default; `contents: write` on the publish job only. |
| SEC-09 | Low | **CSP allowed `'unsafe-eval'`**, which nothing needs (no `eval`/`new Function` in any production bundle); no `base-uri`/`form-action`. | `desktop/index.html` | Removed; `base-uri 'none'; form-action 'none'` added. Built app: 0 violations. |
| REL-01 | High | **App crash**: a non-Latin-1 response header (`【…】` in `Content-Disposition`) made Electron's `net.fetch` throw inside its own callback — uncaught, process dead (last line of a 2026-10-14 log). | `main.ts`, `util/headerBytes.ts` | Header values re-encoded as their UTF-8 bytes in `onHeadersReceived`; the exact Electron error is contained if one slips through. Tests reproduce the throw. |
| REL-02 | Medium | Detached `spawn` without an `error` listener → a missing/moved player executable was an uncaught exception in main. | `externalPlayer.ts`, `externalPlayerControl.ts` | Listeners added. |
| REL-03 | High | **`release.yml` could not run**: in the build job `with:` was written as its own list item under `setup-node` and `setup-java`, giving steps with neither `uses` nor `run`, which GitHub rejects. | `.github/workflows/release.yml` | Fixed; both workflows parsed and every step validated. |
| REL-04 | Medium | **macOS signing could never happen**: `identity: null` disables signing even with a certificate, contradicting the comment above it. | `electron-builder.yml` | Removed; hardened runtime and minimal entitlements added (§126 below). |

### Open — reported, not fixed

| ID | Sev. | Finding | Why open / recommendation |
|---|---|---|---|
| DEP-01 | Medium | `ip` (via `webtorrent → bittorrent-tracker`) GHSA-2p57: `isPublic()` misclassifies some addresses. | No fixed `ip` release exists; npm's suggested "fix" is a downgrade to webtorrent 0.7.3, which is not real. Impact is limited to tracker address filtering in a peer-to-peer client that already connects to arbitrary peers. Track upstream; an `overrides` entry pointing `ip` at a maintained fork is the option if one appears. |
| DEP-02 | Low | 46 build-time advisories (electron-builder, vite, `@electron/get`), plus `undici` via `cheerio` (the app never uses `cheerio.fromURL`). | Update within semver ranges in a separate change with a full packaging run; never ship-blocking on their own. |
| DEP-03 | Info | Two lockfiles (`bun.lock` canonical, `package-lock.json` tracked) give different audit answers and can drift. | Pick one; AGENTS.md already names `bun.lock`. |
| SEC-10 | Low | Downloads from first-party "latest" URLs (ffmpeg from gyan.dev/BtbN, yt-dlp latest, `aria2c.exe` from this repo's `main` branch) are trusted on TLS + origin only. | Pin versions with digests, or fetch the publisher's checksum file first (yt-dlp publishes one per release). |
| SEC-11 | Low | Jellyfin/Emby API keys are stored in plain text in the datastore. Never sent to the renderer. | Electron `safeStorage` (DPAPI/Keychain/libsecret) with a migration. |
| SEC-12 | Info | IPC handlers do not check `event.senderFrame`. | Mitigated now by context isolation + sandbox + no subframes (`will-frame-navigate` blocked) + CSP. A one-line sender check helper would be defence in depth. |
| SEC-13 | Info | Extensions are third-party code running in the JVM sidecar with the user's privileges. | Inherent to running the Android ecosystem unmodified (the JVM has no usable sandbox since the Security Manager's removal). Mitigations in place: per-archive SHA-256, repositories added only by the user or the bundled catalogue, the sidecar as a separate process. Document in user-facing docs. |
| SEC-14 | Info | GitHub Actions are pinned to tags (`@v4`), not commit SHAs. | Pin to SHAs (Dependabot can keep them current). |
| ARC-01 | Info | `main.ts` is 7,066 lines with 353 handlers — wiring, lifecycle and handlers in one module (SRP). | A previous split was deliberately not merged (AGENTS.md §14, it predated half the surface). Re-derive it per namespace when a namespace next changes, not as a big-bang move. |
| ARC-02 | Info | `com.lagradost.cloudstream3.desktop` as `appId` uses the upstream author's namespace. | A publisher-identity question for §126. Changing it changes the Windows install identity (uninstaller GUID, user-data path), so it needs a migration plan, not a one-line edit. |
| QA-01 | Info | 13 `react-hooks/exhaustive-deps` warnings, several in `VideoPlayer.tsx` effects that deliberately omit dependencies. | Each needs individual review; some are intentional (documented with comments), mechanical "fixes" would re-run effects. |

## 4. Coverage

**Reviewed in depth:** Electron window and session configuration; preload; IPC handlers that take paths, URLs or executables; external URL handling; the WebView host; the media proxy (local and remote serving); process spawning across `electron/`; executable downloads and extraction; extension install paths; download path construction; log redaction; the sidecar's archive handling; CI workflows; electron-builder configuration; dependency audits.

**Reviewed by targeted search only:** HTML injection (`innerHTML`, `dangerouslySetInnerHTML`, `eval`, `new Function`: none in `src/` or `electron/`); renderer `fetch` use; filename sanitisation.

**Not reviewed:** renderer component logic beyond the screens changed this session; the sidecar's concurrency and RPC framing in detail; the Kotlin bridge; `tools/research` and e2e harnesses; behaviour on macOS and Linux; a clean-machine install.

## 5. Recommended next steps

1. Provision signing (§126 / `docs/release/distribution.md`) and set `REQUIRE_SIGNING=true`.
2. Run the release workflow once on GitHub (it has never run) with a `v*-rc` tag.
3. SEC-10 and SEC-11 (both small, contained).
4. Dependency refresh within ranges (DEP-02) behind a full `dist:win` run.
