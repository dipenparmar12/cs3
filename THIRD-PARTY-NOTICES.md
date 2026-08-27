# Third-party notices

CloudStream 3 Desktop is a derivative work of the CloudStream 3 Android application and is
distributed under the **GNU General Public License, version 3** (see [`LICENSE`](./LICENSE)).

This file lists everything the application is built from or ships alongside, and under what
terms. It is written to be accurate rather than exhaustive-looking: where a component has
more than one build variant under different licences, the variant actually bundled is named.

---

## 1. Upstream project

| | |
|---|---|
| **Project** | [CloudStream 3](https://github.com/recloudstream/cloudstream) |
| **Copyright** | © the CloudStream contributors |
| **Licence** | GPL-3.0 |
| **Relationship** | This desktop application is a port. It reproduces the Android app's product behaviour and reimplements its data formats — the datastore's six-bucket key grammar, the `.cs3` plugin loading sequence, the repository document formats — so that the existing extension ecosystem works unchanged. |

`sidecar/bridge/` additionally reimplements types from the Android application's `:app` module
(`Plugin`, `DataStore`, `CloudflareKiller`, the `syncproviders` cluster and others) so that
community extensions compiled against them can link on the JVM. Those reimplementations are
derived from the upstream source and are covered by the same GPL-3.0 terms.

### Community extensions

The `repositories/` submodules and any `.cs3` archive the application installs at runtime are
**independent works by their own authors**, under their own licences. They are not part of this
distribution: they are downloaded by the user, from repositories the user chooses, at runtime.
No extension source or archive is vendored into this repository or into a release build.

---

## 2. Bundled runtime binaries

These ship inside the installer (`resources/`) or are downloaded to the user's application data
directory on first use. None is modified.

| Component | Licence | Notes |
|---|---|---|
| **FFmpeg / ffprobe** | **GPL-3.0** | The bundled Windows builds are the GPL-licensed variants (`BtbN/FFmpeg-Builds` `*-gpl` and `gyan.dev` "essentials"), **not** the LGPL builds. They include GPL-only components such as x264. This is compatible with the application's own GPL-3.0 licence, and it is the reason the distinction is stated here rather than left as "FFmpeg". |
| **mpv** | GPL-2.0-or-later | Windows builds from [`zhongfly/mpv-winbuild`](https://github.com/zhongfly/mpv-winbuild). On Linux and macOS mpv is deliberately *not* bundled — the distribution's own package is the one wired to that platform's VA-API or VideoToolbox. A distribution package should depend on `mpv`. |
| **aria2** | GPL-2.0-or-later (with OpenSSL exception) | [`aria2/aria2`](https://github.com/aria2/aria2) release builds. |
| **yt-dlp** | Unlicense | [`yt-dlp/yt-dlp`](https://github.com/yt-dlp/yt-dlp). Updated independently of app releases on purpose: its extractors break when a site changes, so a newer downloaded copy is preferred over the bundled one. |
| **OpenJDK (jlink runtime image)** | GPL-2.0 with Classpath Exception | A trimmed JRE produced by `jlink` for the extension sidecar. The Classpath Exception is what permits linking without extending GPL terms to the linked code. |

---

## 3. JVM libraries (extension sidecar)

Resolved into `sidecar/runtime/` by `sidecar/runtime-deps/pom.xml`. The versions are not
restated here by hand — they come from upstream's own POM by transitive resolution, which is
what guarantees extensions run against the libraries they were compiled against.

| Component | Licence |
|---|---|
| `com.github.recloudstream.cloudstream:library-jvm` | GPL-3.0 |
| Kotlin stdlib, reflect, coroutines | Apache-2.0 |
| jsoup | MIT |
| NiceHttp, OkHttp, Okio | Apache-2.0 |
| Jackson (core, databind, module-kotlin) | Apache-2.0 |
| Ktor | Apache-2.0 |
| ksoup | Apache-2.0 |
| Mozilla Rhino | MPL-2.0 |
| fuzzywuzzy | GPL-2.0 |
| `androidx.annotation:annotation-jvm` | Apache-2.0 |
| dex2jar (DEX→JVM translation, build/install time) | Apache-2.0 |

---

## 4. npm runtime dependencies

| Package | Version | Licence |
|---|---|---|
| `react` | 19.2.8 | MIT |
| `react-dom` | 19.2.8 | MIT |
| `webtorrent` | 3.0.21 | MIT |
| `parse-torrent` | 11.0.24 | MIT |
| `hls.js` | 1.6.18 | Apache-2.0 |
| `shaka-player` | 5.2.6 | Apache-2.0 |
| `cheerio` | 1.2.0 | MIT |
| `fast-xml-parser` | 5.10.1 | MIT |
| `chardet` | 2.2.0 | MIT |
| `lucide-react` | 1.31.0 | ISC |
| `ws` | 8.21.3 | MIT |

Build-time only (not distributed): Electron (MIT), Vite (MIT), TypeScript (Apache-2.0),
electron-builder (MIT), oxlint (MIT).

`webtorrent` pulls native modules (`node-datachannel`, `utp-native`) which carry their own
licences; they are redistributed unmodified as part of the npm dependency tree.

---

## 5. Fonts

| Font | Licence |
|---|---|
| **Inter** | SIL Open Font License 1.1 — © The Inter Project Authors ([rsms/inter](https://github.com/rsms/inter)) |

Inter is bundled with the application rather than fetched from a font CDN at runtime. That is a
privacy decision as much as an offline one: a packaged desktop application should not contact a
third party on every launch, and the users of this one frequently take deliberate steps to
avoid exactly that.

---

## 6. Metadata and catalogue services

The application queries these public, keyless services. It bundles no API key and ships no
client secret, and none of them is told who is asking.

| Service | Used for |
|---|---|
| Stremio **Cinemeta** / Cinemeta catalogs | Film and series metadata; the home screen's catalogues |
| **AniList** public GraphQL | Anime metadata and seasonal catalogues |
| **TVmaze** | Series metadata |
| **OpenSubtitles v3** Stremio addon | Subtitle search, keyed by IMDb id |

Torrent indexers, and any Jackett or Prowlarr instance, are configured by the user and are not
affiliated with this project.

---

## 7. Source availability

GPL-3.0 §6 requires that recipients of a binary can obtain the corresponding source. The
complete source for this application, including the build scripts that assemble the bundled
runtimes, is the repository this file is part of.
