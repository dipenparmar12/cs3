# Distribution, code signing and installation (PRD §126)

How CS3 is packaged, signed and verified, what is still needed from the project owner, and what users should expect on each platform.

**The short version:** every release artifact is currently **unsigned** — measured 2026-10-14 on a local `dist:portable` build: `CS3-1.0.0-windows-x64-portable.exe` and `win-unpacked\CloudStream 3 Desktop.exe` both report Authenticode status `NotSigned` (`tools/package/verify-signatures.mjs`; with `--require` it fails, as intended). That, not a defect in the app, is why Windows shows "Windows protected your PC / Unknown publisher" and macOS refuses to open the app. The pipeline now signs, notarises and verifies automatically once the credentials in §2 exist. Without them, a tag release is published only as an *unsigned preview* (a GitHub prerelease), never as a normal release.

Signing establishes **who published** a file. It does not make SmartScreen silent on day one (Windows also scores each file's reputation), and it does not stop an antivirus product from flagging a file. Those are handled separately (§5).

---

## 1. What ships

| Platform | Artifacts | Contents users need nothing else for |
|---|---|---|
| Windows x64 | `CS3-<v>-windows-x64-installer.exe` (NSIS, per-user, no admin) · `…-portable.exe` · `…-portable.zip` | Electron app, jlinked Java 21 runtime + extension sidecar, ffmpeg/ffprobe, mpv |
| macOS x64 / arm64 | `CS3-<v>-macos-<arch>.dmg` · `.zip` | Same; arm64 uses Homebrew's ffmpeg (no static arm64 build exists) |
| Linux x64 / arm64 | `.AppImage` · `.deb` · `.tar.gz` | Same; mpv from the distribution (`deb` recommends `mpv`, `aria2`) |
| All | `SHA256SUMS.txt`, `CS3-sbom.cdx.json` (CycloneDX 1.6) | — |

No user installs Node, Bun, Java, Maven or ffmpeg to run a release. Tools the app downloads on first use (aria2c, yt-dlp, mpv on Windows) are verified before use: a publisher's own HTTPS origin, or a pinned SHA-256 for any mirror (audit SEC-03).

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

1. Checks (typecheck, unit tests) on all three OSes.
2. Per platform: `tools/package/build-installer.mjs` builds. Its report states the signing mode (`Microsoft Artifact Signing (<publisher>)`, `certificate + notarisation`, or `none`).
3. `tools/package/verify-package.mjs` checks the package carries its runtime (sidecar, JRE, jars, media tools).
4. `tools/package/verify-signatures.mjs` checks the **final** artifacts: Authenticode status *Valid* for the installer, portable exe and app exe; `codesign --verify --deep --strict` and `spctl --assess` for the `.app`, and whether a notarisation ticket is stapled. With `REQUIRE_SIGNING`, anything else fails the job.
5. Publish: SHA-256 sums for every artifact, the SBOM, and the release. If any Windows/macOS artifact is unsigned, the release is a **prerelease named "(unsigned preview)"**.

Credentials are exposed only to the build steps of tag releases and are never available to pull requests (`release.yml` does not run on `pull_request`). Workflows run with read-only tokens except the publish job.

Run the verifier locally after `bun run dist:win`: `node tools/package/verify-signatures.mjs`.

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

- **None of the macOS or Linux packages has been built or launched yet** (AGENTS.md §3), and the release workflow has never run on GitHub. Its first run should be a `v<x>-rc` tag.
- macOS signing and notarisation are configured but untested without a Developer ID; the entitlements are the documented minimum for Electron + a bundled JRE and may need adjusting on first notarisation.
- The Microsoft Store is not a target yet. CS3 downloads and runs third-party extension code and executables at run time; whether that is acceptable under the Store's current policies for desktop apps has to be checked against them before investing in an MSIX build, which would also need the JVM sidecar's process model reviewed.
- `appId` is `com.lagradost.cloudstream3.desktop` (the upstream author's namespace). Changing it changes the Windows install identity (uninstaller entry, user-data folder), so it needs a migration plan before a first signed release, not after.
- Linux packages are not published to a signed apt/rpm repository; integrity is the checksum file.
