# 29 — Platform Compatibility

**Generated:** 2026-08-10

Where Windows, macOS, and Linux differ, and what the application must do about it. Every difference here is a place where "it works on my machine" hides a real bug.

---

## 1. Supported targets

| Platform | Minimum | Architectures | Notes |
|---|---|---|---|
| Windows | 10 (1809+) | x64, arm64 | Windows 11 primary test target |
| macOS | 12 Monterey | x64, arm64 | Universal binary preferred |
| Linux | glibc 2.28+ | x64, arm64 | Ubuntu 22.04 LTS and Fedora as primary test targets |

Linux desktop environments are not uniform. Test on at least GNOME (Wayland) and KDE (X11).

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

| Configuration | Priority |
|---|---|
| Windows 11 x64 | P0 |
| Windows 10 x64 | P0 |
| macOS latest, Apple Silicon | P0 |
| macOS latest, Intel | P1 |
| Ubuntu LTS x64, GNOME/Wayland | P0 |
| Ubuntu LTS x64, X11 | P1 |
| Fedora latest, GNOME/Wayland | P1 |
| Windows 11 arm64 | P2 |
| Linux arm64 | P2 |
| Low-end HTPC hardware | P1 |

Full E2E and migration suites run on every P0 configuration for each release candidate.

---

## Next steps

1. Stand up the P0 CI matrix in Phase 2.
2. Prototype XP-11/12/13 (Linux graceful degradation) early — it is where cross-platform assumptions most often break.
3. Validate XP-32 (native module packaging) in Phase 2, before it blocks a release.
4. Acquire Apple Silicon, Intel Mac, and low-end HTPC test hardware.
