# 14 — Deployment and CI/CD

**Generated:** 2026-08-10
**Baseline:** commit `a72f9e6c`

---

## 1. Android release model

| Aspect | Implementation |
|---|---|
| Flavors | `stable` and `prerelease` (dimension `state`) |
| Prerelease identity | `applicationIdSuffix = ".prerelease"`, `versionNameSuffix = "-PRE"`, `versionCode = System.currentTimeMillis()/60000` |
| Debug identity | `applicationIdSuffix = ".debug"` |
| Signing | Prerelease signed from CI secrets (`SIGNING_KEY_ALIAS`, `SIGNING_STORE_PASSWORD`, `SIGNING_KEY_PASSWORD`) with the keystore staged in the runner temp directory |
| Minification | **Off** for release (`isMinifyEnabled = false`, `isShrinkResources = false`) — presumably because reflection-based plugin loading is fragile under R8 |
| Distribution | GitHub Releases; F-Droid/IzzyOnDroid (dependency metadata is explicitly disabled to satisfy IzzyOnDroid) |
| Update mechanism | In-app: polls the GitHub Releases API, downloads and installs an APK |
| Version | `versionCode 68`, `versionName 4.8.0` |
| Build metadata | Git short hash generated into assets by a custom Gradle task; `BUILD_DATE` build config field |
| Secrets | `SIMKL_CLIENT_ID`, `SIMKL_CLIENT_SECRET`, `MAL_KEY`, `ANILIST_KEY` (app); `MDL_API_KEY`, `TRAKT_CLIENT_ID` (library) — from env or `local.properties` |
| Extension SDK | `makeJar` merges app + library classes into a `classes.jar` for extension developers to compile against |

**Evidence.** `app/build.gradle.kts:16-60, 85-100, 142-180, 305-325`; `gradle/libs.versions.toml:62-63`; `library/build.gradle.kts:101-120`. **Confidence: High.**

**Two inherited signals worth carrying over.** Minification being disabled tells you the plugin system depends on reflection and stable names — the desktop equivalent must be equally careful with bundler mangling. The `makeJar` task tells you the extension SDK is a **first-class release artifact**, not an afterthought.

---

## 2. CI workflows (Android)

| Workflow | Purpose |
|---|---|
| `pull_request.yml` | PR validation |
| `prerelease.yml` | Prerelease build and publish |
| `build_to_archive.yml` | Archive builds |
| `instrumented-tests.yml` | Device/emulator tests |
| `generate_dokka.yml` | API documentation for extension developers |
| `update_locales.yml` | Weblate translation sync |

---

## 3. Desktop build matrix

**Revised 2026-08-12: Windows-first ([29](29-platform-compatibility.md) §1).** Only the Windows row gates the v1 release; the others build when their phase opens.

| Platform | Phase | Arch | Formats |
|---|---|---|---|
| **Windows** | **P0** | x64 | NSIS installer, portable `.exe`, optional MSI |
| Windows | P2 | arm64 | Needs an arm64 JRE and arm64 native modules |
| macOS | P1 | x64, arm64 (universal preferred) | `.dmg`, `.zip` for updater |
| Linux | P1 | x64, arm64 | AppImage (primary), `.deb`, `.rpm`, optional Flatpak |

### 3.1 Bundled JVM runtime (ADR-10)

Every artifact above ships a `jlink`-minimized JRE for the `.cs3` drop-in sidecar ([31](31-cs3-dropin-compatibility.md)).

| ID | Requirement | Priority |
|---|---|---|
| REL-6 | The JRE is `jlink`-minimized to the modules the sidecar actually resolves, bundled with the app, and **never** an external prerequisite (DROP-31). | P0 |
| REL-7 | The bundled runtime is a GPL-3.0-compatible distribution (Temurin, GPLv2+Classpath Exception) with its license and source offer included in the installer (DROP-32; [11](11-security-and-compliance.md) §6). | P0 |
| REL-8 | Total Windows installer size ≤ 250 MB including the JRE (AC-D8). | P1 |
| REL-9 | Per-platform, per-arch JRE builds are produced by the CI matrix. A host-arch JRE shipped to a different arch is a silent, install-time-only failure. | P0 |
| REL-10 | Portable mode (REL-2) relocates the extension store and the translated-bytecode cache alongside the executable, not just user data. | P2 |

| ID | Requirement | Priority |
|---|---|---|
| REL-1 | Reproducible builds — same source, same artifact hash. | P2 |
| REL-2 | Portable mode on Windows and Linux: data stored beside the executable when a marker file is present. | P2 |
| REL-3 | Per-user install by default; machine-wide optional. | P1 |
| REL-4 | Uninstall offers to keep or remove user data, defaulting to **keep**. | P0 |
| REL-5 | An installed build declares its version, git hash, and build date in an About screen (parity with Android). | P1 |

---

## 4. Code signing and updates

| ID | Requirement | Priority |
|---|---|---|
| SIGN-1 | Windows: Authenticode signing (EV strongly preferred to avoid SmartScreen friction). **Long lead time — order the certificate in Phase 0.** | P0 |
| SIGN-1a | **Every** shipped executable and JAR is signed, including the bundled `java.exe`, the sidecar launcher, and the shim JARs (DROP-33). An unsigned child process spawned by a signed parent is exactly the pattern endpoint protection flags. | P0 |
| SIGN-1b | The signed build is validated against Windows Defender and at least two common third-party EPPs before release (DROP-35). A submission-and-whitelisting process with major vendors is started at first release, not after the first user report. | P1 |
| SIGN-2 | macOS: Developer ID signing **and notarization**. Unnotarized builds are effectively unusable on modern macOS. **Applies from the macOS phase**; the bundled JRE must be signed and hardened-runtime-compatible, which is a known source of notarization failures. | P0 (macOS phase) |
| SIGN-3 | Linux: GPG-signed repository metadata and checksums for AppImage. | P1 |
| SIGN-4 | Update packages are signature-verified before installation; verification failure aborts and reports. | P0 |
| SIGN-5 | Signing keys live in CI secrets, never in the repository. | P0 |
| SIGN-6 | Two update channels — `stable` and `prerelease` — mirroring Android's flavors and honoring `install_prerelease_key`. | P1 |
| SIGN-7 | Users can skip a version (`skip_update_key`) and disable auto-update (`auto_update_key`). | P1 |
| SIGN-8 | Update download is resumable and does not block app use. | P2 |
| SIGN-9 | A failed update never leaves an unusable installation; roll back to the previous version. | P0 |

**Note.** Windows EV Authenticode issuance involves organizational vetting and hardware-token shipping — **weeks, not days**. Order it in Phase 0. macOS notarization has a similar multi-day first-time lead and should be started when the macOS phase opens, not at its Phase 13 equivalent.

---

## 5. Versioning

| ID | Requirement |
|---|---|
| VER-1 | Semantic versioning `MAJOR.MINOR.PATCH` for the application. |
| VER-2 | **Independent** version numbers for: application, data schema, export format, and plugin API. They change at different rates and conflating them causes migration bugs. |
| VER-3 | Every export records app version, format version, and schema version ([25](25-data-portability-and-migration.md) §4). |
| VER-4 | Schema version increments on any change to persisted structure, with a migration written in the same commit. |
| VER-5 | Plugin API version follows semver; breaking changes bump major and are announced ahead of release. |

---

## 6. Desktop CI pipeline

```
push / PR
  ├─ lint + typecheck
  ├─ unit tests (matrix: win / mac / linux)
  ├─ ELECTRON SECURITY AUDIT  ← blocking, SEC-1..14
  ├─ dependency vulnerability scan
  ├─ license compliance check   ← blocking, LIC-4
  ├─ hash-vector verification   ← blocking, TEST-HASH-*
  ├─ migration corpus           ← blocking, [30]
  ├─ integration tests
  └─ build unsigned artifacts (PR only)

merge to main
  ├─ everything above
  ├─ E2E tests (3 OS)
  ├─ performance regression gates
  ├─ build + sign + notarize
  └─ publish to the prerelease channel

tag v*
  ├─ everything above
  ├─ full migration corpus on all 3 OS
  ├─ manual playback + subtitle QA sign-off
  ├─ publish to the stable channel
  └─ publish the plugin SDK artifact
```

| ID | Requirement | Priority |
|---|---|---|
| CI-1 | The security audit is a **blocking** gate on every commit. | P0 |
| CI-2 | The migration corpus is blocking on every commit. | P0 |
| CI-3 | Cross-platform builds run on every merge to main. | P0 |
| CI-4 | Signing and notarization are automated, never manual. | P1 |
| CI-5 | Release notes are generated from conventional commits. | P2 |
| CI-6 | An SBOM is produced per release. | P1 |
| CI-7 | The plugin SDK is published with every release, mirroring Android's `makeJar` and Dokka workflows. | P1 |
| CI-8 | Bundler configuration preserves any names the plugin runtime resolves reflectively — the desktop analogue of Android disabling minification. | P0 |

---

## 7. Application data locations

Detailed in [29](29-platform-compatibility.md) §2. Summary:

| Platform | User data | Cache | Logs |
|---|---|---|---|
| Windows | `%APPDATA%\<App>` | `%LOCALAPPDATA%\<App>\Cache` | `%APPDATA%\<App>\logs` |
| macOS | `~/Library/Application Support/<App>` | `~/Library/Caches/<App>` | `~/Library/Logs/<App>` |
| Linux | `$XDG_CONFIG_HOME/<app>` (`~/.config/<app>`) | `$XDG_CACHE_HOME/<app>` | `$XDG_STATE_HOME/<app>/logs` |

| ID | Requirement | Priority |
|---|---|---|
| DATA-LOC-1 | XDG base-directory specification is respected on Linux. | P1 |
| DATA-LOC-2 | Downloads default to the OS Downloads folder in an app subfolder, and are user-changeable. | P0 |
| DATA-LOC-3 | Uninstall never deletes downloaded media. | P0 |
| DATA-LOC-4 | Portable mode relocates all of the above beside the executable. | P2 |

---

## 8. Distribution channels

| Channel | Status | Note |
|---|---|---|
| Direct download | **Primary** | Matches Android's GitHub-Releases model |
| GitHub Releases | **Primary** | Same |
| Microsoft Store | Not recommended | Content-policy review risk given the provider model |
| Mac App Store | **Not viable** | Sandboxing forbids the plugin execution model |
| Flathub | Possible | Sandboxing constraints need evaluation |
| Snap Store | Possible | Same |
| winget / Homebrew / AUR | Community | Encourage, do not own |

**Requirement REL-6 (P0).** Legal review of distribution posture per channel before publishing anywhere ([11](11-security-and-compliance.md) LEG-5).

---

## 9. Release checklist

- [ ] All CI gates green on every release-gating configuration ([29](29-platform-compatibility.md) §10)
- [ ] Migration corpus passes on every release-gating configuration
- [ ] Drop-in corpus (TC-D1..TC-D15) passes; measured tier statistics published (DROP-30)
- [ ] Bundled JRE license text and source offer included (LIC-11)
- [ ] Sidecar and all bundled binaries Authenticode-signed (SIGN-1a); EPP validation done (SIGN-1b)
- [ ] Manual playback and subtitle QA signed off
- [ ] Accessibility spot-check passed
- [ ] Android-compatible export verified on a **real Android device**
- [ ] Artifacts signed (macOS notarized, from the macOS phase onward)
- [ ] SBOM and license notices current
- [ ] Release notes and known limitations published
- [ ] Rollback plan documented
- [ ] Plugin SDK published and versioned

---

## Next steps

1. Start macOS Developer ID enrolment and notarization setup in Phase 2 — long lead time.
2. Stand up the three-OS CI matrix in Phase 2.
3. Add CI-1, CI-2, and CI-8 as blocking gates from the first commit.
4. Decide the distribution channel set with counsel before Phase 13.
