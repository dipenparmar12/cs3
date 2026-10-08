## Downloads

| System | File |
|---|---|
| Windows 10/11 (64-bit) | `CS3-<version>-windows-x64-installer.exe` — installs for your user, no administrator needed |
| Windows, no install | `CS3-<version>-windows-x64-portable.exe` or `…-portable.zip` |
| macOS, Apple silicon | `CS3-<version>-macos-arm64.dmg` (or `.zip`) |
| macOS, Intel | `CS3-<version>-macos-x64.dmg` (or `.zip`) |
| Linux (any distribution) | `CS3-<version>-linux-x64.AppImage` / `…-linux-arm64.AppImage` |
| Debian / Ubuntu | `CS3-<version>-linux-x64.deb` / `…-linux-arm64.deb` |
| Linux, tarball | `CS3-<version>-linux-<arch>.tar.gz` |

`SHA256SUMS.txt` lists a checksum for every file.

### First launch

- **Windows**: the packages are not code-signed, so SmartScreen may say "Windows protected your PC" — choose *More info → Run anyway*.
- **macOS**: the app is not notarised. Open it with right-click → *Open* the first time, or run `xattr -dr com.apple.quarantine "/Applications/CloudStream 3 Desktop.app"`. On Apple silicon, install ffmpeg with `brew install ffmpeg`; mpv (`brew install mpv`) adds the native engine for formats the built-in player cannot decode.
- **Linux**: make the AppImage executable (`chmod +x CS3-*.AppImage`). The native engine and the fast downloader come from your distribution: `sudo apt install mpv aria2` (the `.deb` recommends both).

Everything you set up — repositories, extensions, library, history — is kept across updates.
