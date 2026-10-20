# Distribution, code signing and installation (PRD §126)

How CS3 is packaged, signed and verified, what is still needed from the project owner, and what users should expect on each platform.

**The short version:** every release artifact is currently **unsigned** — measured 2026-10-14 on a local `dist:portable` build: `CS3-1.0.0-windows-x64-portable.exe` and `win-unpacked\CloudStream 3 Desktop.exe` both report Authenticode status `NotSigned` (`tools/package/verify-signatures.mjs`; with `--require` it fails, as intended). That, not a defect in the app, is why Windows shows "Windows protected your PC / Unknown publisher" and macOS refuses to open the app. The pipeline now signs, notarises and verifies automatically once the credentials in §2 exist. Without them, a tag release is published only as an *unsigned preview* (a GitHub prerelease), never as a normal release.

Signing establishes **who published** a file. It does not make SmartScreen silent on day one (Windows also scores each file's reputation), and it does not stop an antivirus product from flagging a file. Those are handled separately (§5).

---

## 1. What ships

| Platform | Artifacts | Contents users need nothing else for |
|---|---|---|
| Windows x64 | `CS3-<v>-windows-x64-installer.exe` (NSIS, per-user, no admin) · `…-portable.exe` · `…-portable.zip` | Electron app, jlinked Java 21 runtime + extension sidecar, ffmpeg/ffprobe, mpv |
| macOS x64 / arm64 | `CS3-<v>-macos-<arch>.dmg` · `CS3-<v>-macos-<arch>.zip` | Same, minus mpv (`brew install mpv`, or mpv.app — both are found); arm64 uses Homebrew's ffmpeg (no static arm64 build exists) |
| Linux x64 / arm64 | `CS3-<v>-linux-<arch>.AppImage` · `.deb` · `.tar.gz` | Same, minus mpv (the distribution's, wired to VA-API; the `deb` recommends `mpv`, `aria2`) |
| All | `SHA256SUMS.txt`, `CS3-sbom.cdx.json` (CycloneDX 1.6) | — |

Thirteen packages and two support files per release; `tools/package/package-layout.mjs` is the list the pipeline checks against. The architecture is spelled `x64`/`arm64` in every name — electron-builder's own Linux spelling (`x86_64` for an AppImage, `amd64` for a deb) is overridden by `build-installer.mjs`; the deb's control field still says `amd64`, which is what dpkg reads.

No user installs Node, Bun, Java, Maven or ffmpeg to run a release. Tools the app downloads on first use (aria2c, yt-dlp, mpv on Windows) are verified before use: a publisher's own HTTPS origin, or a pinned SHA-256 for any mirror (audit SEC-03).

Per-platform facts a user can hit:

- **Linux AppImage** is the classic FUSE 2 type (electron-builder's default toolset): it needs `libfuse2` (`libfuse2t64` on Ubuntu 24.04), or run it with `--appimage-extract-and-run`. On Ubuntu 23.10+ the kernel restricts the user namespaces Chromium's sandbox uses; the AppImage's desktop entry passes `--no-sandbox`, but launched by hand from a terminal it may need `--no-sandbox` too. The **deb** installs an AppArmor profile and sets up `chrome-sandbox` in its postinst, so it needs neither. The tarball behaves like the AppImage without FUSE.
- **Linux arm64** has no uTP: `utp-native` publishes no linux-arm64 prebuild, and webtorrent falls back to TCP-only peers (it logs `WebTorrent: uTP not supported`). Torrents work; some swarms are slower.
- **macOS, unsigned builds** are signed ad hoc by `desktop/scripts/after-pack.cjs` — every Mach-O under `Contents/Resources` (JRE, ffmpeg, native modules) first, then the bundle — because `codesign --deep` does not sign binaries in Resources and Apple silicon kills an arm64 binary whose signature does not hold.

## 2. What the owner needs to provide

### Windows — choose one

**A. Microsoft Artifact Signing (Azure Trusted Signing)** — recommended. Microsoft-managed keys (nothing to store or lose), a publisher identity validated by Microsoft, and the cheapest route to a trusted Authenticode signature. Requires an Azure subscription and identity validation of the person or organisation that will appear as publisher.

Repository **secrets**: `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` (a service principal with the *Trusted Signing Certificate Profile Signer* role).
Repository **variables**: `AZURE_SIGNING_ENDPOINT` (e.g. `https://eus.codesigning.azure.net`), `AZURE_SIGNING_ACCOUNT`, `AZURE_CERT_PROFILE`, `AZURE_PUBLISHER_NAME` (must equal the certificate's subject CN).

**B. A code-signing certificate (.pfx)** from a public CA. Secrets: `CSC_LINK` (base64 of the .pfx) and `CSC_KEY_PASSWORD`. Since 2023 such keys must live on hardware (HSM/token), which in practice means a cloud HSM or a signing service, not a file. Prefer A.

An EV certificate does **not** guarantee that SmartScreen is silent; Microsoft dropped EV's instant-reputation boost. Reputation builds from downloads of consistently signed files.

### macOS

An Apple Developer Program membership (paid), a **Developer ID Application** certificate, and notarisation credentials:

- Secrets: `CSC_LINK`, `CSC_KEY_PASSWORD` (the Developer ID certificate, .p12, base64);
- and either `APPLE_ID` + `APPLE_APP_SPECIFIC_PASSWORD` + `APPLE_TEAM_ID`, or an App Store Connect API key (`APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`).

The build signs with the hardened runtime and `desktop/build/entitlements.mac.plist`. That grants JIT and unsigned executable memory (V8 and the bundled JRE generate code) and disables library validation (the JRE's own dylibs, third-party media binaries), and nothing else. electron-builder notarises and staples when the Apple variables are present.

### Turning signing on as a requirement

Once credentials work, set the repository variable **`REQUIRE_SIGNING=true`**. From then on, a Windows or macOS build whose final artifacts are not validly signed **fails**, so a signing failure cannot become a release.

## 3. How the pipeline enforces it

`.github/workflows/release.yml` on a `v*` tag:

1. Checks on Windows, Linux and macOS: `tsc -b`, `bun run test --fast`, and the sidecar's `mvn test` (on all three — archive replacement and class-loader file handles are what differ on Windows).
2. One build job per target — `windows-latest` (x64), `macos-15-intel` (x64; `macos-13` was retired in December 2025), `macos-14` (arm64), `ubuntu-22.04` (x64), `ubuntu-22.04-arm` (arm64; 22.04 on both so the packages need glibc 2.35, not 2.39). `tools/package/build-installer.mjs` builds; its report states the signing mode (`Microsoft Artifact Signing (<publisher>)`, `certificate + notarisation`, or `none`). It refuses to package for another architecture than the machine's: the JRE is jlinked from the host JDK and the media tools are verified by running them.
3. `tools/package/verify-package.mjs --arch <a> --version <v>` checks the package carries its runtime — sidecar jar, JRE, the classpath with `library-jvm` and the bridge, ffmpeg/ffprobe (and mpv + `mpv.com` on Windows), `node-datachannel` unpacked from the asar — that **every executable is built for the target CPU** (read from its ELF/PE/Mach-O header) and, off Windows, marked executable (`jspawnhelper` included), that `media/` holds no other platform's binary, and that every artifact exists under its release name.
4. `tools/package/smoke-package.mjs --installed` **installs and launches** the unpacked app and every artifact a user downloads (Windows: silent per-user NSIS install + uninstall, the portable exe, the zip; macOS: the dmg mounted and copied out, the zip; Linux: the AppImage via `APPIMAGE_EXTRACT_AND_RUN`, the deb via `apt-get install` + remove, the tarball), each **twice** against one throwaway profile, under xvfb on Linux. With `CS3_SMOKE_REPORT` set the app checks itself (`desktop/electron/smokeTest.ts`) and quits through its normal shutdown — see §3.1. A failed launch's logs are uploaded as `smoke-logs-<target>`.
5. `tools/package/verify-signatures.mjs` checks the **final** artifacts: Authenticode status *Valid* for the installer, portable exe and app exe; `codesign --verify --deep --strict` and `spctl --assess` for the `.app`, and whether a notarisation ticket is stapled. With `REQUIRE_SIGNING`, anything else fails the job.
6. Publish, only if every build job passed: `tools/package/verify-release.mjs` checks all thirteen packages, the SBOM and one signing record per target are present by name (a build that succeeded but uploaded less fails here), then SHA-256 sums, then the release is created **as a draft**, every file uploaded, and only then published — an upload that fails half-way leaves an invisible draft, never a release missing a platform. If any Windows/macOS artifact is unsigned, the release is a **prerelease named "(unsigned preview)"**.

Credentials are exposed only to the build steps of tag releases and are never available to pull requests (`release.yml` does not run on `pull_request`). Workflows run with read-only tokens except the publish job. Every job has a `timeout-minutes`, so a hung launch fails the run instead of holding it for six hours.

Run the same checks locally after `bun run dist:win` (or `dist:mac`/`dist:linux` on those machines):

```bash
node tools/package/verify-package.mjs --version 1.0.0
```

```bash
node tools/package/smoke-package.mjs --installed --version 1.0.0
```

```bash
node tools/package/verify-signatures.mjs
```

### 3.1 What a smoke launch proves, and what it cannot

Each launch writes a report; a failed **required** check fails the release.

| Check | Required | Proves |
|---|---|---|
| `renderer` | yes | The window loaded, the preload bridge (`window.cloudstream`) exists, React drew into `#root` |
| `ffmpeg`, `ffprobe` | where bundled (all but macOS arm64) | The tool runs, and it is the **bundled** copy — a runner's own ffmpeg does not count |
| `mpv` | Windows | Same, for the native engine |
| `sidecar` | yes | The runtime provisioned into the profile, the JVM started **on the bundled JRE** (CI machines have their own Java; a fallback to it fails), answered `ping`, and can execute providers (`library-jvm` + bridge loaded) |
| `torrent` | yes | webtorrent and its native modules loaded for this OS/arch and the loopback stream server bound |
| `persistence` | yes | Launch 2 reads the counter launch 1 wrote and flushed — data survives quit + restart |
| `network` | no (`--require-network` makes it so) | One bundled repository's index fetched through the app's own network stack (`net.fetch`, DoH) |

From outside, `smoke-package.mjs` adds: exit code 0 within the deadline, the JVM's pid gone within 10 s of exit (no orphaned sidecar), no `shutdown_timeout` in the profile's log, and the reported version equals the tag.

Not covered by CI — no extension is installed in a CI smoke profile, nothing is searched, played or downloaded, and a CI runner has no GPU. Those depend on third-party sites, so they are the opt-in deep mode below and §3.2, not a release gate.

**Deep mode, on a real machine** — `node tools/package/smoke-package.mjs [--installed] --deep --version <v>`. Launch 1 additionally uses one community extension end to end, every step through `window.cloudstream` (the bridge the UI calls, so all four IPC layers are crossed — `desktop/electron/smokeDeep.ts`); launch 2 checks the extension survived the restart. Each step needs the one before, and the first failure ends the run with its reason.

| Step | Proves |
|---|---|
| `ext-install` | The repository index fetched, the `.cs3` downloaded, SHA-256 checked, DEX-translated and loaded by the sidecar on this OS |
| `ext-load` / `ext-kept` | The extension's providers are registered (launch 2: still registered, without reinstalling) |
| `search` / `search-again` | A search scoped to that provider returns results (launch 2: the archive on disk still loads in a fresh JVM) |
| `details`, `links` | `load()` and `loadLinks()` answer; direct links come back |
| `play` | `media:prepare` classifies a link and it **plays** on the engine chosen: mpv reports ≥ 2 s of playback position, a `<video>` reaches `currentTime` ≥ 2 s, or an HLS manifest leads to segment bytes |
| `play-in-app` | The same link again as the player's own "Play in this window" request (`force` + `avoidNativeEngine`), whichever engine played it first — a forced ffmpeg conversion into the app's `<video>`, the OS-sensitive half of the media pipeline; mpv as the answer fails. On failure the detail adds the element's `readyState`/`networkState`/buffered range and how many bytes the main process could read from the conversion itself |
| `download` | `download:request` with a task built by the app's own `buildDownloadTask` reaches 2 MB, then is removed with its file |

The target defaults to phisher98's `MovieBoxProvider` searching "Interstellar" (picked from this project's own provider analytics) and is set with `CS3_SMOKE_DEEP_REPO`, `CS3_SMOKE_DEEP_PLUGIN`, `CS3_SMOKE_DEEP_QUERY`. A deep failure says whether the provider or the package is at fault only together with its detail line: a provider that is down fails `search` or `links` on every OS alike.

### 3.2 Manual checklist on real hardware

Before the first non-preview release, and after any change to packaging, the sidecar, the media runtime or Electron: on **each** of Windows 11 x64, macOS on Apple silicon, macOS on Intel, Ubuntu 24.04 x64 (Wayland session), and one Linux arm64 machine. Record the date, machine and result for each line here.

1. **Install** the user-facing artifact (installer / dmg / deb; AppImage on one Linux machine), from a browser download so quarantine and SmartScreen apply. Note every warning shown; macOS: right-click → Open, or `xattr -dr com.apple.quarantine "/Applications/CloudStream 3 Desktop.app"`.
2. **Launch** from the Start menu / Launchpad / the desktop entry — not a terminal (a GUI launch has a different PATH: Homebrew's ffmpeg/mpv must still be found).
3. **Settings**: the extension runtime reports ready on the bundled Java (its path is under the app's resources), and the media tools show ffmpeg/ffprobe as included (Homebrew's on Apple silicon) and mpv where installed.
4. **Regions → extensions**: pick a region, let the starter extensions install, confirm the Extensions screen shows their providers loaded, and that no extension fails here that loads on Windows.
5. **Search** a common title; results arrive from several providers and indexers.
6. **Play** one direct HTTP source, one HLS source, one torrent; one HEVC/AC-3 file through the conversion path; one through mpv (its own window, hardware decode — `mpv:status`). Switch audio track and subtitles.
7. **Download** one direct source and one torrent; open the finished file from Downloads.
8. **Persist**: add to library, watch 2 minutes, quit, relaunch — Continue watching resumes the same source at the same position.
9. **Quit** from the menu and from the window close button; confirm no `java`/`mpv`/`aria2c` process survives (Task Manager / Activity Monitor / `ps`).
10. **Open with**: double-click a `.torrent`, click a `magnet:` link in a browser — the running app receives it; a second launch focuses the first window.
11. **Upgrade in place**: install this release over the previous one; library, extensions and settings are kept, and the runtime refreshes (`runtime-stamp.json` generation matches).
12. **Uninstall**: the app is removed; the profile (`%APPDATA%`, `~/Library/Application Support`, `~/.config`) is kept, by design.

## 4. What users see, and how to verify a download

| | Unsigned (today) | Signed |
|---|---|---|
| Windows installer | SmartScreen "Unknown publisher" — *More info → Run anyway* | Publisher shown; SmartScreen may still warn on a brand-new release until it gains reputation |
| Windows portable | Same | Same |
| macOS | "cannot be opened because the developer cannot be verified" | Opens normally once notarised |
| Linux | AppImage needs `chmod +x`; `.deb` installs with `apt install ./file.deb` | — (no OS-level signature; verify checksums) |

The supported install path never asks anyone to disable SmartScreen, Defender or Gatekeeper.

Verifying a download:

- **Checksum, any OS:** compare with `SHA256SUMS.txt` from the same release.
  - Windows: `Get-FileHash .\CS3-…-installer.exe -Algorithm SHA256`
  - macOS/Linux: `shasum -a 256 CS3-…` (or `sha256sum`)
- **Signature, Windows:** `Get-AuthenticodeSignature .\CS3-…-installer.exe` → `Status: Valid`, signer = the published publisher name.
- **Signature, macOS:** `codesign -dv --verbose=2 "/Applications/CloudStream 3 Desktop.app"` and `spctl -a -vv "/Applications/CloudStream 3 Desktop.app"` → `accepted, source=Notarized Developer ID`.

## 5. Antivirus detections and SmartScreen reputation

- **SmartScreen** warnings on a signed file mean low *reputation*, not malware. They fade as a consistently signed publisher accumulates clean downloads. Keep the publisher identity and signing method stable across releases.
- **A Defender or antivirus detection** is investigated before it is called a false positive: rebuild from the tag, compare SHA-256 with the release, scan the unpacked contents (the bundled JRE, ffmpeg and mpv are the usual triggers for heuristic engines), and check the SBOM for an unexpected dependency.
- **A confirmed false positive** is submitted through the vendor's official channel; for Microsoft, the Defender *Submit a file* portal (software developer submission), quoting the release URL and SHA-256.
- Nothing in the build obfuscates code, packs executables or alters publisher metadata to avoid detection, and nothing should.

## 6. Known limitations

- **The macOS and Linux packages have been built and smoke-launched only on GitHub's runners** (first full run 2026-10-19, all 13 packages; AGENTS.md §3) — never on a real Mac or Linux desktop: no Finder/desktop-entry launch, no Gatekeeper on a downloaded file, no GPU, no Wayland. §3.2 is what closes that. The deep mode (§3.1) has been run on Windows only.
- macOS signing and notarisation are configured but untested without a Developer ID; the entitlements are the documented minimum for Electron + a bundled JRE and may need adjusting on first notarisation.
- The Microsoft Store is not a target yet. CS3 downloads and runs third-party extension code and executables at run time; whether that is acceptable under the Store's current policies for desktop apps has to be checked against them before investing in an MSIX build, which would also need the JVM sidecar's process model reviewed.
- `appId` is `com.lagradost.cloudstream3.desktop` (the upstream author's namespace). Changing it changes the Windows install identity (uninstaller entry, user-data folder), so it needs a migration plan before a first signed release, not after.
- Linux packages are not published to a signed apt/rpm repository; integrity is the checksum file.
