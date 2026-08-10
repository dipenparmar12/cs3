# 11 — Security and Compliance

**Generated:** 2026-08-10
**Baseline:** commit `a72f9e6c`

CloudStream downloads and executes third-party code by design. On Android that code runs with the app's full privileges. **Reproducing that model in Electron would be substantially worse**, because Electron's default privilege ceiling is the whole machine. This document specifies the boundary that must not be crossed.

---

## 1. Android's security posture, honestly assessed

| Control | Android reality |
|---|---|
| Plugin isolation | **None.** Plugins load into the app process via `PathClassLoader` with full app privilege. |
| Plugin integrity | SHA-256 verification **only when the repository supplies `fileHash`** — it is nullable. |
| Plugin signing | **None.** No signature or publisher identity. |
| Repository trust | **None.** Any URL may be added. |
| Permissions for plugins | Inherited from the app, including `MANAGE_EXTERNAL_STORAGE` — whose manifest comment literally reads "Plugin API". |
| Credential storage | Plaintext JSON in SharedPreferences (app-private, but readable on rooted devices and in some backup paths). |
| Transport | HTTPS via OkHttp + Conscrypt; providers may do as they like. |
| Backup contents | Deliberately excludes tokens and secrets — a real strength. |
| Safe mode | A `safe` file, or a prior load error, disables all plugins. |
| Crash reporting | ACRA. |

**Evidence.** `app/.../plugins/PluginManager.kt:611, 571-587`; `app/.../plugins/RepositoryManager.kt:214-220`; `app/src/main/AndroidManifest.xml:9`; `app/.../syncproviders/AccountManager.kt:40-53`; `app/.../utils/BackupUtils.kt:55-113`. **Confidence: High.**

**Conclusion.** Android's model is "trust the user to trust the plugin". The desktop app should keep the *ecosystem openness* while removing the *unlimited privilege*.

---

## 2. Threat model

| ID | Threat | Vector | Severity |
|---|---|---|---|
| T-1 | Malicious plugin achieves arbitrary code execution on the host | Repository → plugin install → execution | **Critical** |
| T-2 | Malicious plugin reads or exfiltrates user files | Filesystem access from plugin context | **Critical** |
| T-3 | Malicious plugin steals tracker tokens | Reading credential storage | High |
| T-4 | Malicious repository serves a trojaned update of a legitimate plugin | Repository compromise; absent or ignored hash | High |
| T-5 | Malicious import file corrupts or destroys user data | Crafted backup JSON | High |
| T-6 | Import file causes path traversal | Path-like values in a backup | High |
| T-7 | Provider-supplied HTML/JS executes in the UI renderer | Unsanitized `name`/`plot`/`description` | **Critical** |
| T-8 | SSRF to loopback or private ranges | Provider-controlled URLs; the torrent server listens on loopback | High |
| T-9 | Man-in-the-middle on plugin download | HTTP repository or weak TLS | High |
| T-10 | Update channel compromise | Unsigned or weakly verified updates | **Critical** |
| T-11 | Credential leakage via logs or crash reports | Unredacted logging | Medium |
| T-12 | Zip-slip / decompression bomb in a plugin archive | Archive extraction | High |
| T-13 | DoS via oversized import (memory exhaustion) | Huge or deeply nested JSON | Medium |
| T-14 | Renderer compromise escalates to Node | Misconfigured `webPreferences` | **Critical** |

---

## 3. Electron hardening — non-negotiable

| ID | Control | Priority |
|---|---|---|
| SEC-1 | `contextIsolation: true` in **every** renderer, without exception. | P0 |
| SEC-2 | `nodeIntegration: false`, `nodeIntegrationInWorker: false`, `nodeIntegrationInSubFrames: false`. | P0 |
| SEC-3 | `sandbox: true` for all content renderers. | P0 |
| SEC-4 | `@electron/remote` is not used. | P0 |
| SEC-5 | A strict CSP on every page: no `unsafe-eval`, no `unsafe-inline`, explicit allow-lists. | P0 |
| SEC-6 | `webSecurity` is never disabled. | P0 |
| SEC-7 | `will-navigate` and `setWindowOpenHandler` block all navigation to non-app origins; external links open in the system browser. | P0 |
| SEC-8 | `webview` tags are disabled (`webviewTag: false`). | P0 |
| SEC-9 | Preload exposes a **fixed, typed, allow-listed** API — never `ipcRenderer` itself, never a generic `invoke(channel, …)`. | P0 |
| SEC-10 | Every IPC payload is schema-validated in the main process. | P0 |
| SEC-11 | `app.enableSandbox()` is called at startup. | P0 |
| SEC-12 | Permission requests (camera, microphone, geolocation, notifications beyond the app's own) are denied by default. | P0 |
| SEC-13 | Electron is kept current; a stale major version is treated as a release blocker. | P1 |
| SEC-14 | Fuses are applied at package time: `runAsNode` off, `enableNodeCliInspectArguments` off, `enableEmbeddedAsarIntegrityValidation` on, `onlyLoadAppFromAsar` on. | P1 |

---

## 4. Plugin security model

The full runtime design is in [27](27-plugin-and-extension-architecture.md) §7. The security requirements are here.

| ID | Control | Priority |
|---|---|---|
| SEC-15 | Plugins execute in a dedicated isolated host with **no Electron API, no `require`, no `process`, no direct filesystem, and no raw sockets**. | P0 |
| SEC-16 | Network access is brokered. Every plugin request is policy-checked, attributed, rate-limited, and logged. | P0 |
| SEC-17 | The broker denies `file://`, `localhost`/`127.0.0.0/8`, link-local, and RFC1918 targets unless a per-plugin allowance is explicitly granted by the user. (Blocks T-8, and protects the loopback torrent server.) | P0 |
| SEC-18 | Every plugin call has a hard timeout; a hung plugin is killed, not awaited. | P0 |
| SEC-19 | Memory and CPU caps per plugin host; breaching them terminates the host, not the app. | P1 |
| SEC-20 | SHA-256 verification is **mandatory when the repository supplies a hash**, and a repository that supplies no hashes is surfaced to the user as lower-trust. | P0 |
| SEC-21 | Archive extraction rejects absolute paths, `..` segments, symlinks, and entries exceeding a size/count budget. (Blocks T-12.) | P0 |
| SEC-22 | Repository URLs must be HTTPS. HTTP is refused, not warned. (Blocks T-9.) | P0 |
| SEC-23 | All provider-supplied strings are treated as untrusted text. No `innerHTML`, no `dangerouslySetInnerHTML`, no URL scheme other than `http(s)` for links and images. (Blocks T-7.) | P0 |
| SEC-24 | Safe mode is preserved: a marker file or repeated crashes disable all plugins, and it is discoverable from the UI. | P0 |
| SEC-25 | Plugins get no access to the credential store. Tracker tokens are never visible to plugin code. (Blocks T-3.) | P0 |
| SEC-26 | Plugin capabilities are declared and displayed at install time; anything beyond the default set requires explicit consent. | P2 |
| SEC-27 | An optional publisher-signature scheme, with unsigned plugins clearly labelled. | P3 |

**A note on honesty.** The Extensions UI must state plainly that plugins are third-party code and that installation is a trust decision. Android does not say this clearly enough. A calm, factual banner is better than either silence or a scary modal that trains users to click through.

---

## 5. Data security

| ID | Control | Priority |
|---|---|---|
| SEC-28 | Tracker tokens and service credentials are stored in the OS keychain (Windows Credential Manager / macOS Keychain / libsecret), never in the app's data store. | P0 |
| SEC-29 | Exports **never** contain tokens, credentials, session cookies, or the biometric key — matching Android's `nonTransferableKeys` semantics exactly, including its substring matching. | P0 |
| SEC-30 | Import files are size-capped, depth-capped, and key-count-capped; parsing is streaming where possible. (Blocks T-13.) | P0 |
| SEC-31 | Any path-like value in an import is validated and re-rooted; no import may write outside the app data directory or a user-chosen directory. (Blocks T-6.) | P0 |
| SEC-32 | A pre-import snapshot is created before any mutation. (Mitigates T-5.) | P0 |
| SEC-33 | Logs redact tokens, cookies, `Authorization` headers, and query-string secrets before writing. | P0 |
| SEC-34 | Crash reporting is **opt-in, off by default**, and states precisely what is transmitted. | P1 |
| SEC-35 | The PIN is presented as a convenience lock, never as encryption, because it is stored in plaintext for Android compatibility. | P1 |
| SEC-36 | Optional at-rest encryption of the local data store, off by default (it would break Android-compatible export if applied to exports). | P3 |

---

## 6. License compliance

**CloudStream is GPL-3.0.** This has hard consequences.

| ID | Obligation | Requirement |
|---|---|---|
| LIC-1 | A desktop application derived from CloudStream — including one reusing its data formats as specification, its string catalogue, its icons, or any code — is a derivative work and **must be GPL-3.0**. | P0 |
| LIC-2 | Complete corresponding source must be offered to every recipient of a binary. | P0 |
| LIC-3 | Copyright notices and the license text ship with the application. | P0 |
| LIC-4 | An in-app "Open source licenses" screen lists every bundled dependency and its license. | P0 |
| LIC-5 | **FFmpeg** bundling (LGPL-2.1+, or GPL depending on build configuration) must be reviewed by counsel. GPL-3.0 and GPL-2.0-only components are incompatible, and some FFmpeg builds pull in GPL-2.0-only code. | P0 |
| LIC-6 | mpv (GPL-2.1+/LGPL depending on build) and libVLC (LGPL-2.1+) carry their own terms; whichever is chosen must be reviewed. | P0 |
| LIC-7 | The four recloudstream/LagradOst forks (`torrentserver`, `colorpicker`, `safefile`, `anime-db`) must have their licenses individually verified. | P1 |
| LIC-8 | The "CloudStream" name and logo are **not** licensed by GPL. A redistributed fork may need to rebrand. | P1 |
| LIC-9 | The Weblate-managed translation catalogue can only be reused if contributor licensing permits it. | P1 |
| LIC-10 | Anti-tivoization: if distributed on locked-down hardware, GPL-3.0 §6 installation-information requirements apply. | P2 |

**Evidence.** `LICENSE:1-2`; `gradle/libs.versions.toml` (dependency coordinates); `app/build.gradle.kts:212-289`. **Confidence: High** that GPL-3.0 applies; **Medium** on the precise obligations, which require legal advice.

**This is a legal review item, not an engineering decision.** Do not begin packaging (Phase 13) without sign-off.

---

## 7. Content and legal posture

CloudStream ships no content. Providers are user-installed and point at third-party sites whose legality varies by jurisdiction and by site.

| ID | Requirement | Priority |
|---|---|---|
| LEG-1 | The application ships with no preinstalled content providers. Repository entries, if any, are opt-in during setup. | P0 |
| LEG-2 | No marketing or in-app copy may imply the application provides content. | P0 |
| LEG-3 | The legal notice (`legal_notice_key`) is preserved and shown. | P1 |
| LEG-4 | An NSFW provider toggle is preserved (`enable_nsfw_on_providers_key`), defaulting off. | P1 |
| LEG-5 | Counsel reviews the distribution posture for each target platform's store or channel before release. | P0 |

**Evidence.** `README.md`; `settings_general.xml` (`legal_notice_key`); `settings_providers.xml` (`enable_nsfw_on_providers_key`). **Confidence: High.**

---

## 8. Security testing

| Test | Coverage |
|---|---|
| Electron configuration audit | SEC-1..14, automated in CI, failing the build on regression |
| Plugin sandbox escape attempts | SEC-15..19; a deliberately hostile test plugin attempting `require`, `process`, filesystem, and socket access |
| Archive extraction fuzzing | SEC-21; zip-slip, symlinks, bombs |
| Import fuzzing | SEC-30..32; malformed, oversized, deeply nested, path-traversing backups |
| XSS corpus through provider fields | SEC-23 |
| SSRF corpus | SEC-17 |
| Credential-storage verification | SEC-28; assert nothing sensitive is on disk in plaintext |
| Export secret-scanning | SEC-29; scan every generated export for token-shaped strings |
| Update-channel tampering | T-10; unsigned and modified packages must be refused |
| Dependency scanning | Automated, on every build |

---

## Next steps

1. Commission legal review of LIC-1..LIC-10 and LEG-5 **now** — it has the longest lead time of anything in this PRD.
2. Implement SEC-1..14 in Phase 2, as the shell is built. Retrofitting is far harder.
3. Write the hostile test plugin during Phase 9, and keep it in CI permanently.
4. Add the Electron-configuration audit to CI from the first commit.
