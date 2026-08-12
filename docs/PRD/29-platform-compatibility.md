# 29 — Platform Compatibility

**Generated:** 2026-08-10 · **Revised:** 2026-08-12 (Windows-first scope)

Where Windows, macOS, and Linux differ, and what the application must do about it. Every difference here is a place where "it works on my machine" hides a real bug.

---

## 1. Supported targets

**Scope decision, 2026-08-12: Windows-first.** Windows is the P0 shipping target. macOS and Linux remain fully specified in this document and are not descoped — they are **phased**, and no release gate blocks on them until their phase.

| Platform | Phase | Minimum | Architectures | Notes |
|---|---|---|---|---|
| **Windows** | **P0 — ships first** | 10 (1809+) | x64 | Windows 11 primary test target; x64 only for v1 |
| Windows arm64 | P2 | 11 | arm64 | Deferred; the bundled JRE and native modules both need an arm64 build |
| macOS | P1 — after Windows GA | 12 Monterey | x64, arm64 | Universal binary preferred |
| Linux | P1 — after Windows GA | glibc 2.28+ | x64, arm64 | Ubuntu 22.04 LTS and Fedora as primary test targets |

Linux desktop environments are not uniform. Test on at least GNOME (Wayland) and KDE (X11).

### 1.1 What Windows-first means in practice

| ID | Requirement | Priority |
|---|---|---|
| XP-0a | **No cross-platform abstraction is skipped for expedience.** Path handling, the sandbox interface, notifications, and the keychain are written behind interfaces from day one, with only the Windows implementation filled in. Retrofitting an abstraction after a platform-specific v1 is the expensive failure mode this clause exists to prevent. | P0 |
| XP-0b | Windows-only assumptions are **named in code and in this document**, never left implicit. A `TODO(platform)` that is not traceable to a row in this document is a defect. | P1 |
| XP-0c | CI builds and runs the unit and integration suites on Linux from day one — even before Linux ships — because it is the cheapest continuous check that no unportable assumption has leaked in. | P1 |
| XP-0d | The JVM sidecar sandbox ([31](31-cs3-dropin-compatibility.md) §6) is the **least portable** component: it uses Windows AppContainer and job objects. macOS (`sandbox-exec` / App Sandbox) and Linux (seccomp-bpf + namespaces) equivalents are a hard prerequisite for those platforms and must be designed before, not after, the Windows implementation hardens around its own mechanism. | P0 |
| XP-0e | Drop-in `.cs3` support is **not** Windows-specific — the JVM and the translated bytecode are portable. Only the sandbox mechanism (XP-0d) is per-platform. | P1 |

---

## 2. Application data locations

| Purpose | Windows | macOS | Linux |
|---|---|---|---|
| User data | `%APPDATA%\<App>` | `~/Library/Application Support/<App>` | `$XDG_CONFIG_HOME/<app>` → `~/.config/<app>` |
| Local/large data | `%LOCALAPPDATA%\<App>` | same as above | `$XDG_DATA_HOME/<app>` → `~/.local/share/<app>` |
| Cache | `%LOCALAPPDATA%\<App>\Cache` | `~/Library/Caches/<App>` | `$XDG_CACHE_HOME/<app>` → `~/.cache/<app>` |
| Logs | `%APPDATA%\<App>\logs` | `~/Library/Logs/<App>` | `$XDG_STATE_HOME/<app>/logs` |
| Temp | `%TEMP%\<App>` | `$TMPDIR/<App>` | `/tmp/<app>` |
| Downloads (default) | `%USERPROFILE%\Downloads\<App>` | `~/Downloads/<App>` | `$XDG_DOWNLOAD_DIR/<app>` |
| Extensions | `<userData>\extensions` | `<userData>/extensions` | `<dataHome>/extensions` |
| Snapshots | `<userData>\snapshots` | `<userData>/snapshots` | `<dataHome>/snapshots` |

| ID | Requirement | Priority |
|---|---|---|
| XP-1 | XDG base directories are respected on Linux, including the fallbacks when the variables are unset. | P1 |
| XP-2 | Cache is separate from user data and safely deletable without data loss. | P0 |
| XP-3 | Uninstall never deletes downloaded media (REL-4). | P0 |
| XP-4 | Portable mode overrides all of the above (DSK-43). | P2 |

---

## 3. Filesystem

| Aspect | Windows | macOS | Linux |
|---|---|---|---|
| Separator | `\` (accepts `/`) | `/` | `/` |
| Case sensitivity | Insensitive | Insensitive (APFS default) | **Sensitive** |
| Forbidden chars | `< > : " / \ | ? *` + control | `/` `:` (Finder) | `/` NUL |
| Reserved names | `CON` `PRN` `AUX` `NUL` `COM1-9` `LPT1-9`, **including with extensions** | none | none |
| Trailing dot/space | Silently stripped | allowed | allowed |
| Max path | 260 default; long paths opt-in | 1024 | 4096 |
| Max filename | 255 | 255 | 255 bytes |
| Unicode | UTF-16 | UTF-8, **NFD-normalizing** | UTF-8, bytes |

| ID | Requirement | Priority |
|---|---|---|
| XP-5 | Filename sanitization is identical across platforms, producing names valid on all three (UTIL-5). | P0 |
| XP-6 | Reserved Windows names are handled, including with extensions (`CON.mp4` is invalid). | P0 |
| XP-7 | Path length is checked before writing, not after failing. | P1 |
| XP-8 | Unicode is normalized to NFC on write; NFD is handled on read for macOS-created paths. | P1 |
| XP-9 | Case-insensitive collisions are detected on Windows/macOS and disambiguated. | P1 |
| XP-10 | Symlinks are not followed when scanning download directories. | P1 |

---

## 4. OS integration

| Capability | Windows | macOS | Linux |
|---|---|---|---|
| Protocol handlers | Registry | `Info.plist` `CFBundleURLTypes` | `.desktop` + `xdg-mime` |
| File associations | Registry | `Info.plist` `CFBundleDocumentTypes` | `.desktop` + MIME |
| Notifications | Toast (needs an AppUserModelID) | User Notifications framework | libnotify / D-Bus |
| Tray | System tray | Menu bar extra | System tray (**availability varies by DE**) |
| Menu bar | In-window | **System menu bar, mandatory** | In-window |
| Media keys | SMTC | `MPNowPlayingInfoCenter` | MPRIS over D-Bus |
| Autostart | Registry Run / Startup folder | Login Items | `~/.config/autostart` |
| Keychain | Credential Manager | Keychain Services | libsecret (**not universal**) |
| Prevent sleep | `SetThreadExecutionState` | `IOPMAssertion` | D-Bus inhibit (**varies**) |
| Reveal in file manager | Explorer | Finder | `xdg-open` |

| ID | Requirement | Priority |
|---|---|---|
| XP-11 | Every integration degrades gracefully when unavailable. Linux especially: missing libsecret, no tray, no MPRIS. | P0 |
| XP-12 | Keychain unavailability falls back to an encrypted file **with an explicit user warning**. | P0 |
| XP-13 | Protocol-handler registration failure surfaces an actionable message with manual instructions. | P1 |
| XP-14 | macOS menu bar follows platform conventions (app menu, Services, Window menu). | P1 |
| XP-15 | An AppUserModelID is set on Windows so notifications and taskbar grouping work. | P1 |

---

## 5. UI conventions

| Convention | Windows | macOS | Linux |
|---|---|---|---|
| Window controls | Right, min/max/close | Left, close/min/zoom | Varies by DE |
| Primary modifier | `Ctrl` | `Cmd` | `Ctrl` |
| Preferences | Ctrl+, or a menu item | **Cmd+,**, in the app menu | Ctrl+, |
| Close vs quit | Close = quit | Close ≠ quit by default | Close = quit |
| Scrollbars | Persistent | Overlay | Varies |
| Default font | Segoe UI | SF Pro | System (Cantarell / Noto) |
| Dialog button order | OK, Cancel | Cancel, OK | Cancel, OK |

| ID | Requirement | Priority |
|---|---|---|
| XP-16 | Modifier keys follow platform convention; do not hard-code `Ctrl`. | P0 |
| XP-17 | Dialog button order follows platform convention. | P1 |
| XP-18 | System fonts and OS theme (light/dark) are respected. | P1 |
| XP-19 | macOS: closing the last window does not quit by default (configurable). | P2 |
| XP-20 | Windows: per-monitor DPI awareness. | P1 |

---

## 6. Networking

| Aspect | Windows | macOS | Linux |
|---|---|---|---|
| System proxy | WinINET/WinHTTP | System Configuration | env vars / GSettings / varies |
| Certificate store | Windows store | Keychain | `/etc/ssl/certs`, varies |
| Metered connection | Reported by the OS | Not exposed | Not exposed |
| VPN detection | Available | Available | Varies |

| ID | Requirement | Priority |
|---|---|---|
| XP-21 | System proxy settings are honored on each platform. | P1 |
| XP-22 | System certificate stores are used; a corporate MITM proxy must not break the app outright. | P1 |
| XP-23 | Metered-connection detection where available; the feature is hidden, not broken, where it is not (FEAT-PLAY-2). | P2 |

---

## 7. Media

| Aspect | Windows | macOS | Linux |
|---|---|---|---|
| HW decode | D3D11VA / DXVA2 | VideoToolbox | VAAPI / VDPAU / NVDEC |
| HEVC (browser) | May need a codec pack | Supported | Often unsupported |
| Audio | WASAPI | CoreAudio | PulseAudio / PipeWire / ALSA |
| Display server | DWM | Quartz | **X11 or Wayland** |
| Fullscreen | Straightforward | Spaces interaction | Compositor-dependent |

| ID | Requirement | Priority |
|---|---|---|
| XP-24 | Hardware decoding is attempted and falls back to software cleanly. | P0 |
| XP-25 | The native player backend bundles its own codec support rather than relying on system libraries. | P0 |
| XP-26 | Wayland and X11 are both tested; video output differs materially between them. | P1 |
| XP-27 | Audio device changes mid-playback are handled without a crash. | P1 |

---

## 8. Packaging

| Aspect | Windows | macOS | Linux |
|---|---|---|---|
| Formats | NSIS, portable, MSI | DMG, ZIP | AppImage, deb, rpm, Flatpak |
| Signing | Authenticode (EV preferred) | Developer ID + **notarization** | GPG-signed metadata |
| Install scope | Per-user default | `/Applications` or `~/Applications` | Varies |
| Auto-update | electron-updater | electron-updater (ZIP) | AppImage update; deb/rpm via repo |
| Uninstall | Add/Remove Programs | Drag to Trash | Package manager |

| ID | Requirement | Priority |
|---|---|---|
| XP-28 | macOS builds are notarized. Unnotarized builds are effectively unusable. | P0 |
| XP-29 | Windows installers are signed; EV certification is strongly preferred to avoid SmartScreen friction. | P0 |
| XP-30 | AppImage runs without installation and without root. | P1 |
| XP-31 | Uninstall preserves user data by default and offers removal. | P0 |
| XP-32 | Native modules are rebuilt per platform and architecture (OQ-32). | P0 |

---

## 9. Known platform issues

| Platform | Issue | Mitigation |
|---|---|---|
| Windows | SmartScreen warns on unsigned/low-reputation installers | EV certificate; document the warning |
| Windows | Defender scanning slows many-small-file writes | Batch writes; prefer fewer larger files |
| Windows | `MAX_PATH` breaks deep download trees | Enable long paths; keep generated paths short |
| Windows | Endpoint protection flags a bundled JVM spawning a sandboxed child process | Authenticode-sign the sidecar (DROP-33); validate against Defender and common EPPs pre-release (DROP-35); degrade to "extensions unavailable" rather than failing to launch (DROP-34) |
| Windows | Corporate policy or AppLocker blocks the bundled `java.exe` | DROP-34 degradation path; document the executable path for allowlisting |
| All | Java's `SecurityManager` is deprecated and disabled (JEP 411/486), so the sidecar sandbox **must** be OS-level — and OS sandboxing is the least portable thing in the product | XP-0d: design the macOS and Linux mechanisms before the Windows one hardens |
| macOS | Gatekeeper blocks unnotarized apps | Notarize |
| macOS | App Nap throttles background work | Request the appropriate activity assertion |
| macOS | APFS NFD normalization creates apparent duplicates | Normalize to NFC (XP-8) |
| Linux | libsecret is not universally installed | Encrypted-file fallback with warning (XP-12) |
| Linux | Protocol handler registration varies by DE | Manual instructions fallback (XP-13) |
| Linux | Wayland screen-capture and video paths differ | Test both; document |
| Linux | Tray availability varies | Optional feature, not assumed |
| All | Native modules must match the Electron ABI | CI rebuild matrix |

---

## 10. Testing matrix

Revised 2026-08-12 for Windows-first scope.

| Configuration | Priority | Gates v1 release? |
|---|---|---|
| Windows 11 x64 | P0 | **Yes** |
| Windows 10 x64 (1809+) | P0 | **Yes** |
| Windows 11 x64, Defender + a third-party EPP | P0 | **Yes** — the bundled JVM spawning a sandboxed child triggers heuristics (DROP-35) |
| Ubuntu LTS x64 (unit + integration only, XP-0c) | P1 | No — portability canary, not a shipping target |
| Low-end HTPC hardware, Windows | P1 | No |
| macOS latest, Apple Silicon | P1 | No — gates the macOS release |
| macOS latest, Intel | P2 | No |
| Ubuntu LTS x64, GNOME/Wayland (full E2E) | P1 | No — gates the Linux release |
| Ubuntu LTS x64, X11 | P2 | No |
| Fedora latest, GNOME/Wayland | P2 | No |
| Windows 11 arm64 | P2 | No |
| Linux arm64 | P3 | No |

Full E2E and migration suites run on every release-gating configuration for each release candidate. macOS and Linux acquire their own gating sets when their phase opens; until then they run best-effort and failures do not block Windows.

---

## Next steps

1. Stand up the Windows P0 CI matrix in Phase 2, plus the Linux unit/integration canary (XP-0c).
2. Design the three sandbox mechanisms (XP-0d) before implementing any of them. This is the one place where Windows-first can quietly become Windows-only.
3. Validate XP-32 (native module packaging) and the `jlink` JRE bundle in Phase 2, before either blocks a release.
4. Validate DROP-35 (endpoint-protection behavior) on real corporate images, not just a clean VM — it is the most likely cause of "installs fine for us, blocked for the user".
5. Acquire low-end HTPC Windows hardware now; Apple Silicon, Intel Mac and Linux hardware when those phases open.
