# 39 — Our own extension standard, and the playback contract behind it

**Status:** research + proposed standard. Nothing here is built yet.
**Date:** 2026-08-23.
**Relationship to [27](27-plugin-and-extension-architecture.md):** doc 27 sketched a
three-runtime plan. This document replaces §6–§9 of it with a decision made against what
the ecosystem actually looks like now, and adds the two standards doc 27 never wrote —
the media contract and the network contract.

Everything marked **[measured]** was measured in this repository and is recorded in
`AGENTS.md`. Everything marked **[researched]** comes from the sources in §10 and was not
re-verified here. Everything else is a proposal.

---

## 0. The question, split into three standards

"Bring our own scraper/plugin system that supports the maximum number of video formats and
websites" is not one problem. It is three, and they fail independently:

| | Standard | The question it answers | What decides success |
|---|---|---|---|
| **S-EXT** | Extension contract | How does a third party ship code that finds a stream? | Author ergonomics, sandbox, distribution |
| **S-MEDIA** | Playback contract | What does the app promise it can play, and how does a source declare itself? | Engine ladder, codec coverage |
| **S-NET** | Fetch contract | Does the scraper reach the site at all? | TLS fingerprint, challenge solving, headers |

Android gets to conflate the first two: an APK is the extension, ExoPlayer is the player,
and both live in one process with one set of privileges. We cannot, and should not want
to. Our runtime is *weaker* than Android's at the top (Chromium decodes far less than
ExoPlayer — **[measured]** no AC-3/E-AC-3/DTS at all, no HEVC without a platform decoder,
no MPEG-2/VC-1/WMV) and *stronger* underneath (we can ship mpv and FFmpeg, which decode
more than any Android device).

**S-NET is the binding constraint on "maximum websites", and it is the one nobody
specifies.** A provider written in Kotlin, TypeScript or Rust fails identically against
Cloudflare. The language of the scraper has approximately zero effect on site coverage;
the TLS handshake and whether a real browser can be pointed at a challenge have almost all
of it. §7 is therefore the highest-value section in this document, and it is the work
already named as "doc 36 step 7 (WebView)" that keeps getting deferred.

---

## 1. Prior art: seven systems, and what each is worth stealing

| System | Unit of distribution | Runtime | Isolation | Install | Site coverage |
|---|---|---|---|---|---|
| **CloudStream `.cs3`** | ZIP of Android DEX | JVM sidecar here **[measured]** | process | repo JSON URL | ~400 archives, our current corpus |
| **Stremio addon** | *nothing* — a URL | the addon's own server | total (it is not our code) | paste a URL | hundreds, public |
| **Kodi addon** | ZIP with `addon.xml` | in-process CPython | none | repo ZIP | thousands, all media types |
| **Aniyomi / Mihon** | Android APK | in-process, dynamically loaded | signature pinning only | repo `index.min.json` | ~1000 anime/manga sources |
| **Jellyfin plugin** | .NET assembly | in-process CLR | none (trusted) | server catalogue | n/a — server features |
| **consumet / p-stream** | npm package | your app's own JS | none | `npm i` | tens, curated |
| **yt-dlp extractor** | Python class in one repo | CPython subprocess | process | ships with the binary | **~1,800 sites** |
| **Extism / WASM** | `.wasm` module | Wasmtime | linear memory + capability imports | any | n/a — a mechanism |

What each got right, in one line:

- **Stremio** — *the extension is a URL, not a file.* **[researched]** A manifest at
  `/manifest.json` and resources at `/{resource}/{type}/{id}.json` over plain HTTP, with
  `catalog`, `meta`, `stream`, `subtitles`. There is no runtime, no sandbox and no
  translation problem, because the code never enters our process. Its `Stream` object
  already carries the two fields we had to reinvent — `behaviorHints.notWebReady` (the host
  cannot play this natively) and `behaviorHints.proxyHeaders` (send these headers) — which
  is exactly the negotiation §6.5 proposes. Steal the protocol *and* be a client of it: the
  day we can install a Stremio addon URL, we inherit an entire live ecosystem.
- **Kodi** — *the manifest declares what the addon provides and depends on*
  (`<extension point="xbmc.python.pluginsource" library="…">`, `<provides>video</provides>`,
  versioned `<requires>` on shared script modules). **[researched]** Shared library modules
  as first-class dependencies is the piece our `.cs3` corpus lacks: today every extension
  vendors its own copy of the same extractor code.
- **Aniyomi / Mihon** — *trust is pinned to a signing certificate, per repository.*
  **[researched]** Extensions declare an NSFW flag in their manifest and the app verifies
  the signing fingerprint, prompting when an extension is not from a trusted repo. We have
  the NSFW gate already; we do not have signing.
- **yt-dlp** — *the largest site corpus in existence, and we already ship the binary.*
  Treating "this site is handled by yt-dlp" as a legitimate extension kind costs almost
  nothing and adds ~1,800 sites the Kotlin corpus does not cover.
- **Extism / the component model** — *capability-scoped, polyglot, one ABI.*
  **[researched]** Host functions are injected as WASM imports; plugins get nothing they
  were not handed. WASI 0.2 (component model + WIT) landed in 2024 and 0.3 (async) in Feb
  2026, but threading is still unresolved and the toolchain tax for a scraper author is
  real. Reserve the lane; do not open with it.
- **consumet / p-stream** — *a scraper is 200 lines of `fetch` plus a CSS selector.* Both
  are ordinary TypeScript packages with a swappable fetcher and an embed/extractor split.
  That is the ergonomic bar our SDK has to clear, and it is far below Kotlin + Gradle + ADB.

What to avoid, also one line each: Kodi's and Jellyfin's *no isolation at all*; Aniyomi's
*your extension is an APK*, which is the exact trap we are already paying for; consumet's
*no sandbox because the scrapers are in your bundle*, which makes every provider fix an app
release.

---

## 2. The decision: four lanes, one contract

One `Provider` interface and one `Source` object. Four ways to supply an implementation.
The host does not care which lane a provider came from, beyond provenance and trust.

```
                    ProviderRegistry  (one interface, one Source object)
                              │
   ┌──────────────┬───────────┴───────────┬───────────────────┐
   │              │                       │                   │
 L0 .cs3        L1 .csx                 L2 addon URL        L3 yt-dlp
 DEX→JVM        QuickJS sandbox         remote HTTP         subprocess
 sidecar        (the new standard)      (Stremio-compatible) (declarative)
 EXISTS         BUILD THIS              CHEAPEST WIN        NEARLY FREE

   └────────── L4 reserved: .wasm component, same manifest, different binary ──────────┘
```

| Lane | Author writes | Runs in | Trust boundary | When it is the right answer |
|---|---|---|---|---|
| **L0 `.cs3`** | Kotlin (Android) | JVM sidecar | process + classloader | The existing corpus. Never breaks. **[measured]** works today |
| **L1 `.csx`** | TypeScript | QuickJS-on-WASM in a utility process | capability manifest, brokered I/O | New providers, ports, anything needing local cookies or settings |
| **L2 addon URL** | anything, hosted | the author's server | none needed — it is not our code | Aggregators, debrid, catalogues, IPTV, anything with a backend |
| **L3 yt-dlp** | a JSON rule | `yt-dlp` subprocess | process | ~1,800 sites we would otherwise hand-write |
| **L4 `.wasm`** | Rust/Go/Zig/Kotlin-native | Wasmtime | component imports | Perf-critical or polyglot. Not now |

### 2.1 Why QuickJS-on-WASM and not a V8 isolate

Doc 27 §6.2 said "V8 isolated context". Against 2026 reality that is the wrong pick:

- `isolated-vm` shares the host V8 process and has a documented sandbox-escape class
  (**[researched]** CVE-2022-39266: untrusted V8 cached data passed through
  `CachedDataOptions` escapes the isolate). A scraper ecosystem is *definitionally*
  untrusted third-party code; "isolated except for the escapes" is not a security model.
- `vm2` is abandoned for exactly this reason. **[researched]**
- QuickJS compiled to WASM (`quickjs-emscripten`, **[researched]** actively maintained,
  QuickJS-NG on a ~2-month cadence) gives a **separate linear memory** with no reference to
  our heap, plus the three controls a plugin host actually needs: `setMemoryLimit`,
  `setMaxStackSize`, and `setInterruptHandler` (runtime-level, called during execution —
  this is how a hung provider gets killed).

And the decisive one, which is specific to *this* product:

> **Extractors routinely have to execute obfuscated JavaScript from the page they are
> scraping** — `eval(function(p,a,c,k,e,d){…})` packers, rolling deobfuscators, JS-computed
> tokens. On Android this is done with Rhino (already on our runtime classpath
> **[measured]**). In a QuickJS host it is *free and safe*: spawn a nested QuickJS realm
> with **no host API bound at all**, run the string, take the value out. There is no
> equivalently cheap move in a V8-isolate design, and no move at all in a WASM-component
> design without shipping a JS engine inside the plugin.

Cost to be honest about: **[researched]** QuickJS is roughly an order of magnitude slower
than V8 on compute, and host async requires Asyncify, which can only suspend one call at a
time. Neither matters for a scraper — the work is three HTTP round trips and a CSS query,
and concurrency lives at the *provider* level (we already cap 8 searches in flight
**[measured]**), not inside one plugin.

### 2.2 Why not make everything a Stremio addon

Because a hosted addon cannot hold the user's cookies, cannot show a settings screen, and
cannot be pointed at a browser to solve a challenge on the user's own IP — and because a
community scraper with no server is the modal case in this ecosystem. L2 is additive, not a
replacement.

---

## 3. S-EXT — the extension contract

### 3.1 The bundle

`.csx` — a ZIP, so it is inspectable, diffable and installable by drag-and-drop.

```
myprovider.csx
├── manifest.json        required
├── main.js              required — one bundled ESM file, no imports at runtime
├── icon.png             optional, ≤ 64 KB
├── settings.json        optional — declarative settings schema (no UI code, ever)
└── fixtures/            optional — recorded HTTP cassettes for `csx test` (§5.3)
```

**One file, pre-bundled, no runtime module resolution.** Every dynamic-import scheme becomes
a filesystem or network capability we then have to police. The SDK bundles with esbuild; the
host loads a string.

**No UI code in an extension, at any lane.** This is the biggest lesson from the `.cs3`
corpus: **[measured]** the androidx UI closure (`View`, `Dialog`, `Fragment`,
`AppCompatActivity`) exists purely so that scrapers sharing an archive with a settings
screen can still link. A declarative `settings.json` rendered by the host removes that
entire failure class permanently.

### 3.2 `manifest.json`

```jsonc
{
  "schema": 1,
  "id": "com.example.myprovider",       // reverse-DNS, globally unique, immutable
  "apiVersion": "^1.0",                 // semver range against the host SDK
  "name": "MyProvider",
  "version": "1.4.2",
  "authors": ["someone"],
  "language": "en",                     // BCP-47, or "multi"
  "types": ["Movie", "TvSeries"],       // TvType[] — drives the facet filters we already have
  "nsfw": false,                        // gates on the existing adult opt-in
  "minAppVersion": "0.9.0",

  "capabilities": {
    "network": { "hosts": ["*.example.com", "cdn.example.net"] },
    "webview": false,                   // may ask the host to solve a challenge (§7)
    "storage": true,                    // scoped KV
    "ytdlp": false,                     // may hand a URL to the yt-dlp lane
    "impersonate": "chrome"             // requested TLS profile (§7); the host may refuse
  },

  "providers": [
    { "name": "MyProvider", "types": ["Movie"], "mainUrl": "https://example.com" }
  ],
  "extractors": ["MyHost", "MyHost2"]   // declared so the host can route embeds
}
```

Three fields carry most of the weight:

- **`capabilities.network.hosts` is an allow-list, and it is enforced, not advisory.** A
  scraper that declares two hosts and then reaches a third is either broken or hostile, and
  both cases should be visible. This is what makes the sandbox mean anything; a "sandboxed"
  plugin with unrestricted `fetch` is a plugin with unrestricted exfiltration.
- **`apiVersion` is a range, not a floor.** Doc 27 PLG-V-2 asked for a minimum; a range also
  lets us *deprecate*, which a minimum cannot express.
- **`extractors`** — declaring them lets the host route an embed URL to the right extractor
  across extension boundaries, which is how Android's `ExtractorApi` registry works and why
  one extension's Voe extractor serves twenty other providers.

### 3.3 The provider interface

```ts
import { definePlugin, type Provider } from '@cs3/sdk';

const myProvider: Provider = {
  name: 'MyProvider',
  mainUrl: 'https://example.com',
  types: ['Movie', 'TvSeries'],

  // Home-screen rows. Optional; the host has its own catalogues.
  async getMainPage(ctx, page, request) { /* … */ },

  // `page` is part of the primary overload — the 4.8.0 lesson [measured]
  async search(ctx, query, page = 1): Promise<SearchResponse[]> { /* … */ },

  async load(ctx, url): Promise<LoadResponse> { /* … */ },

  // Never returns a bare empty array. See §3.6.
  async loadLinks(ctx, data, opts): Promise<LinkResult> { /* … */ },
};

export default definePlugin({ providers: [myProvider], extractors: [myExtractor] });
```

`ctx` is the host API (§4). It is passed in rather than imported so that every capability
use is attributable to a call, which is what makes the diagnostics we already have
(`cs3/diagnostics.ts`) work for L1 with no new plumbing.

### 3.4 `Source` — the one object every lane produces

The union of what Android's `ExtractorLink` carries, what Stremio's `Stream` carries, and
what this codebase already learned it needs. **We already parse most of it** —
`electron/cs3/providerLinks.ts` **[measured]** — so L0 and L1 land in the same shape with no
adapter in between.

```ts
interface Source {
  // exactly one address
  url?: string;                    // http(s)
  magnet?: string;                 // magnet: — the real infohash is the dedupe identity [measured]
  torrentUrl?: string;
  externalUrl?: string;            // open in a browser; not playable

  name: string;                    // release name — the ranker parses this
  provider: string;                // provider identity, and the cs3ext:// address
  extractor?: string;              // the file host (Voe, Gdshine) — NOT the provider [measured]

  // transport, declared by the provider and trusted over any URL heuristic [measured]
  type: 'VIDEO' | 'M3U8' | 'DASH' | 'TORRENT' | 'MAGNET';

  headers?: Record<string, string>;   // Referer / User-Agent — applied by mediaProxy
  drm?: { scheme: 'clearkey' | 'widevine' | 'playready' | 'unknown';
          kid?: string; key?: string; licenseUrl?: string;
          keyRequestParameters?: Record<string, string> };

  quality?: number;                   // 2160 | 1080 | …
  size?: number;                      // bytes
  filename?: string;
  expiresAt?: number;                 // epoch ms — see below
  audioTracks?: { language: string; url: string; headers?: Record<string, string> }[];
  playlist?: { name: string; url: string; part: number; of: number }[];

  // optional declarations that let the host skip a probe (§6.5)
  container?: string;
  videoCodec?: string;
  audioCodec?: string;
  channels?: number;
  hdr?: 'none' | 'hdr10' | 'hdr10plus' | 'dolbyvision' | 'hlg';
}
```

Four fields exist because we got burned without them, and none is in the Android model:

- **`expiresAt`.** **[measured]** Provider links are signed CDN addresses good for minutes.
  `sourceCache` already digs the deadline out of `Expires`/`exp`/a JWT claim because nobody
  declared it. A provider that *knows* should say so — and a direct link with no recorded
  deadline is treated as expired, deliberately, because guessing "still good" costs an
  ffmpeg start plus a player timeout while guessing "expired" costs one provider call.
- **`playlist`.** **[measured]** Android concatenates multi-part titles into one timeline; we
  render numbered rows. Either way the parts must survive the link, or a film silently ends
  after forty minutes.
- **`audioTracks[].headers`.** **[measured]** Separate audio tracks crossed as bare URLs and
  were 403'd by the hosts that use them.
- **`container` / `videoCodec` / `channels` / `hdr`.** Optional and *never* trusted over a
  probe, but they let a provider that already knows save 1.6–1.7 s per source **[measured]**,
  and they let the host prefer the source this machine can actually play (§6.5).

### 3.5 Subtitles

Provider subtitles are a first-class source and must ride with the links rather than being
fetched separately — **[measured]** this is the only subtitle path that works for
extension-sourced content with no IMDb id.

```ts
interface Subtitle {
  language: string; url: string;
  format?: 'srt' | 'vtt' | 'ass' | 'ssa';
  headers?: Record<string, string>;
  forced?: boolean;
}
```

The host converts (`electron/subtitles/convert.ts` **[measured]** — SubRip *and* ASS, with
charset detection, because `<track>` rejects `.srt` and `.ass` silently).

### 3.6 A failure is a diagnosis, never an empty array

```ts
interface LinkResult {
  sources: Source[];
  subtitles?: Subtitle[];
  diagnosis?: {
    code: 'blocked' | 'geo' | 'timeout' | 'not-found' | 'extractor-failed' | 'challenge';
    message: string; host?: string; status?: number;
  };
}
```

This promotes the existing `loadLinksDetailed` rule into the contract **[measured]**:
`loadLinks` returning `[]` is why "the extension provider returned no playable links" was
the only sentence anyone could ever be shown — one message covering a timeout, a blocked
host, a thrown extractor, and a title that genuinely has nothing. **An SDK that makes the
diagnosis optional will get `[]` forever; `LinkResult` makes returning nothing without a
reason the awkward path.**

---

## 4. S-HOST — what the sandbox is handed

`ctx`, and nothing else. No `fetch`, no `process`, no module resolution.

| Module | Surface | Enforced by |
|---|---|---|
| `ctx.http` | `get/post/head`, per-call headers, cookie jar, timeout, redirect policy, `impersonate` profile | host-side broker; manifest allow-list; per-host rate limit |
| `ctx.html` | `parse(html)` → CSS `select/attr/text`, plus `xpath` | host-side (linkedom/cheerio); returns handles, not a live DOM |
| `ctx.json` / `ctx.form` / `ctx.url` | parse/serialise helpers | in-sandbox |
| `ctx.crypto` | md5/sha1/sha256/hmac, AES-CBC/GCM, base64/hex, RSA verify | host-side (`node:crypto`) |
| `ctx.js.eval(src)` | run untrusted page JS in a **nested QuickJS realm with no `ctx`** | the nested realm |
| `ctx.storage` | scoped `get/set/remove` KV | per-plugin namespace |
| `ctx.settings` | typed reads of `settings.json` values | host |
| `ctx.log` | attributed logging into `cs3/diagnostics.ts` | host |
| `ctx.webview` | `solve(url)` → cookies + final HTML; `evalOnPage(url, js)` | **capability-gated**, user-visible, rate-limited (§7) |
| `ctx.player` | the host capability descriptor (§6.5) | read-only |
| `ctx.abort` | an `AbortSignal` for the whole call | interrupt handler |

Limits: a hard per-call timeout, a memory limit, and an interrupt handler that kills a
runaway loop. All three are `quickjs-emscripten` primitives **[researched]**, so this is
configuration rather than construction.

**Everything above is available to L0 too.** The android shim already provides the
equivalents (`Log`, `SharedPreferences`, `Uri`, `Handler`) **[measured]**; what changes is
that L1's version becomes the *specification* and L0's becomes an adapter to it, rather than
the reverse.

---

## 5. S-DIST — repositories, versioning and trust

### 5.1 The index

A superset of upstream's `plugins.json` (so existing repositories keep working unchanged)
plus the two fields it lacks:

```jsonc
{
  "schema": 1,
  "name": "Example Repo",
  "publicKey": "RWQf6…",              // ed25519 (minisign) — pinned on first install
  "plugins": [{
    "internalName": "MyProvider",
    "kind": "csx",                     // "cs3" | "csx" | "addon" | "ytdlp" | "wasm"
    "url": "https://…/MyProvider.csx",
    "fileHash": "sha256-…",            // strip the prefix before comparing [measured]
    "signature": "…",                  // detached, over fileHash
    "apiVersion": "^1.0",
    "version": 142, "versionName": "1.4.2",
    "tvTypes": ["Movie"], "language": "en", "nsfw": false,
    "status": 1
  }]
}
```

- **`kind` is what makes the four lanes one ecosystem.** A repository can publish a Kotlin
  `.cs3`, a TypeScript `.csx` and a hosted addon URL side by side, and the user installs all
  three the same way.
- **`publicKey`, pinned per repository, Aniyomi-style** **[researched]**. First install
  records the key; a later plugin signed by a different key is refused *with a named reason*
  rather than silently installed. This is the only defence that survives a repo takeover, and
  `fileHash` does not provide it — the hash comes from the same document as the URL.

### 5.2 Versioning

`apiVersion` is a semver range against the SDK. Breaking changes bump major and are
announced one release ahead (doc 27 PLG-V-3, kept). The host refuses an extension outside
the range **and says which side is old**, because "MyProvider needs a newer app" and
"MyProvider is too old for this app" are different user actions.

Rollback already exists **[measured]** (`extension:rollback`, one generation kept, restored
on `T4_BLOCKED`). It generalises to L1 unchanged: install, load, put the old bundle back if
the new one will not initialise.

### 5.3 The CLI, and why fixtures matter more than tests

```
npx @cs3/cli new myprovider     # scaffold
npx @cs3/cli dev                # hot-reload into the running app over a local WS
npx @cs3/cli test               # run against recorded fixtures/
npx @cs3/cli record "batman"    # capture live HTTP into fixtures/ as cassettes
npx @cs3/cli analyze ./dist     # manifest + capability lint, the L1 analogue of tiering
npx @cs3/cli publish            # sign, and emit the index entry
```

**Recorded cassettes are the load-bearing piece.** A provider test that hits the live site
fails when the site is slow, when the CI runner's IP is blocked, and when the title is no
longer listed — three failures that say nothing about the provider. **[measured]** The
vendor matrix already found that of 72 non-playing streams, *every one* was a host refusing
or expiring a link rather than a code defect; a CI that cannot tell those apart trains
maintainers to ignore it.

---

## 6. S-MEDIA — the playback contract, and how "maximum formats" is actually achieved

### 6.1 The rule already in force

The source declares; the host inspects; the host decides; only then is anything attached.
`media:prepare` is the only way to obtain a playable URL, and there is deliberately no
channel that hands back an unclassified one **[measured]**. That rule extends to every lane
and every engine without change — INV-RACE-1 is a property of the contract, not of the
`<video>` element.

### 6.2 The engine ladder

| Tier | Engine | Owns | Cost |
|---|---|---|---|
| 0 | `<video>` (Chromium) | H.264/VP8/VP9/AV1 + AAC/MP3/Opus/FLAC in MP4/WebM | free |
| 1 | hls.js | HLS incl. AES-128 / SAMPLE-AES **[measured]** | free |
| 1 | Shaka Player | DASH, and the only path to encrypted DASH **[measured]** | free |
| 2 | FFmpeg remux | container mismatch only (`-c:v copy -c:a copy`) | one process |
| 3 | FFmpeg transcode | anything Chromium cannot decode | 0.47x realtime at 4K **[measured]** — the stall |
| 4 | **mpv** | everything else, hardware-decoded | a process, and today a second window |
| 5 | External player | whatever the user prefers | handoff |

**Tier 4 is our ExoPlayer.** That is the right way to think about it: Android's answer to
"maximum formats" is not a clever transcoder, it is handing the bitstream to the device's
decoders. mpv is that, with a *larger* format surface than ExoPlayer — libavcodec covers
MPEG-2, VC-1, RealVideo and WMV, and libass renders ASS/SSA properly, none of which Chromium
or hls.js will ever do.

### 6.3 Coverage matrix

The Chromium column is **[measured]** on this Electron build; the mpv column is
**[researched]** plus the local mpv runs recorded in `AGENTS.md`.

| | Chromium | +hls.js/Shaka | +FFmpeg | mpv | Verdict |
|---|---|---|---|---|---|
| H.264 / VP9 / AV1 | ✅ | ✅ | — | ✅ | covered |
| HEVC 8-bit | build-dependent | — | transcode | ✅ hw | mpv |
| HEVC 10-bit / 4K / 8K | ❌ | — | stalls | ✅ hw | **mpv only** |
| MPEG-2, VC-1, MPEG-4 pt2, WMV | ❌ | — | transcode | ✅ | mpv |
| AAC / MP3 / Opus / FLAC | ✅ | ✅ | — | ✅ | covered |
| AC-3 / E-AC-3 / DTS | ❌ (silently! **[measured]**) | — | downmix to stereo | ✅ | **mpv** |
| TrueHD / DTS-HD MA / DTS:X | ❌ | — | lossy | ✅ + passthrough | **mpv only** |
| HDR10 / HLG | ❌ | — | tone-map to SDR **[measured]** | ✅ | mpv |
| HDR10+ / Dolby Vision | ❌ | — | ❌ | HDR10+ ✅; DV p5 falls back **[researched]** | mpv, with a caveat |
| MKV / AVI / TS / OGM / RM | partial | — | remux | ✅ | mpv |
| SRT / WebVTT | via `<track>` after conversion | ✅ | extract | ✅ | covered |
| ASS/SSA styling | ❌ (converted; styling lost) | — | — | ✅ libass | mpv |
| PGS / VOBSUB / DVB bitmap | ❌ | — | ❌ (listed, never offered **[measured]**) | ✅ | **mpv only** |
| HLS / DASH | — | ✅ | ✅ | ✅ | covered |
| ClearKey | ✅ EME **[measured]** | ✅ | progressive only | — | covered |
| **Widevine / PlayReady** | ❌ no CDM | ❌ | ❌ (holds no keys) | ❌ | **the only real hole** |

Read the matrix as one sentence: **with mpv fully wired, exactly one row is left, and it is a
licensing problem rather than an engineering one.**

### 6.4 What is missing to close it

1. **Embed mpv** (roadmap Option B — the libmpv render API through a native addon). It runs
   in its own window today **[measured]**, which is the only reason tier 4 is not simply the
   default for everything hard. **[researched]** the render API is the recommended embedding
   path, and there is a 2026 precedent of exactly this in an Electron app.
   *This is the single highest-value item in §6.*
2. **Audio passthrough** — `audio-spdif=ac3,eac3,dts,dts-hd,truehd` with
   `audio-exclusive=yes` **[researched]**. One settings toggle, and it gives bit-perfect
   Atmos/DTS-HD to a receiver, which no browser path can ever do.
3. **Widevine**: the only route is the castLabs Electron for Content Security fork plus free
   EVS VMP signing **[researched]** (Windows/macOS full; Linux partial — no persistent
   licenses). It is a fork of Electron, so it is a *product* decision, not a module.
   Recommendation: **defer, and keep naming it accurately in the UI**, which is what we do
   now.
4. **A stream URL is never handed to any engine unprepared.** The mpv entry point already
   refuses a raw link **[measured]**; keep that invariant when the surface becomes embedded.

### 6.5 Capability negotiation — Stremio's `notWebReady`, generalised

`ctx.player` hands the extension a descriptor:

```ts
interface HostCapabilities {
  videoCodecs: string[];     // measured in the renderer at startup [measured]
  audioCodecs: string[];
  containers: string[];
  transports: ('progressive' | 'hls' | 'dash')[];
  drm: ('clearkey' | 'widevine' | 'playready')[];
  nativeEngine: boolean;     // mpv present → "I can play essentially anything"
  hardwareEncode: boolean;
}
```

Two uses, and the second matters more. A provider offering both a 4K HEVC and a 1080p H.264
rip can *order them correctly for this machine*. And a provider that would otherwise have
returned nothing can return the source it knows is expensive, flagged — strictly better than
today, where the host discovers the problem only after a probe.

---

## 7. S-NET — the actual limit on "maximum websites"

**[researched]**, and it is the least comfortable section:

- **TLS fingerprinting decides most blocks before a byte of HTML is parsed.** Cloudflare and
  its peers hash the ClientHello (JA3) and the HTTP/2 settings frame and compare against
  known browser profiles. A stock Java/Node/Python client is identifiable as non-browser on
  the handshake, with no JavaScript involved. This is why the same scraper logic works on
  Android and fails here, and it has nothing to do with the language.
- **FlareSolverr is effectively dead against modern configurations** — reported at a 0% pass
  rate on Cloudflare Enterprise targets, because Playwright-bundled Chromium's own JA3
  matches no real Chrome release. Byparr inherits the same problem. Do not build on either.
- **What works is impersonation at the wire level** (curl-impersonate / `curl_cffi` / rustls
  with a Chrome profile) *plus* a real browser for the challenge itself.

We are unusually well placed here, and are not using it:

| Capability | We have | Android has | Note |
|---|---|---|---|
| A real Chromium with a genuine fingerprint | ✅ offscreen `BrowserWindow` | WebView | **unused** — `CloudflareKiller` forwards rather than solves **[measured]** |
| Per-host cookie jar, persisted | partial | ✅ | needed by the challenge flow |
| Header injection into playback | ✅ `mediaProxy` **[measured]** | ExoPlayer datasource | done |
| TLS impersonation for scrape traffic | ❌ | ❌ (but Conscrypt reads as Android) | the gap |

**Recommendation, in priority order:**

1. **`ctx.webview.solve(url)`** — an offscreen `BrowserWindow`, real UA, real fingerprint;
   returns cookies plus the final HTML. Capability-gated in the manifest, rate-limited,
   visible to the user. This is doc 36 step 7, it is the largest single divergence from
   Android **[measured]**, and it buys more site coverage than any new runtime.
2. **A fetch broker with impersonation profiles** — one HTTP client for all four lanes, with
   a Chrome-shaped ClientHello, per-host cookie jars, politeness limits and full attribution
   into `providerAnalytics` / `diagnostics`. L0 gets it too, which incidentally fixes the JVM
   SNI `unrecognized_name` divergence **[measured]** at the right layer instead of with a
   global flag that would disable SNI for every CDN in the corpus.
3. **Per-host politeness and back-off, centrally.** Hundreds of extensions scraping small
   community sites in parallel is how an IP gets blocked; the prefetcher's restraint rules
   **[measured]** should be a broker policy rather than one caller's good manners.

---

## 8. Sequencing

| Phase | Work | Buys |
|---|---|---|
| **A** | Freeze the contract: `src/types/extension.ts`; refactor `PluginManager` into a `ProviderRegistry` with a `.cs3` adapter behind it | Every later lane becomes additive; nothing else starts cleanly first |
| **B** | **L2 Stremio-compatible addon client** | An entire live ecosystem, for the least work in this document |
| **C** | **S-NET broker + `webview.solve`** | The biggest *real* site-coverage gain, and it fixes L0 at the same time |
| **D** | L1: QuickJS host, `@cs3/sdk`, `csx` CLI, signing, index `kind` field | Our own standard, and an on-ramp that is not Kotlin + Gradle |
| **E** | L3 yt-dlp lane | ~1,800 sites for a JSON rule and a subprocess we already ship |
| **F** | mpv embedding + passthrough (§6.4) | Closes the format matrix to one row |
| **G** | L4 WASM component ABI | Only if a real author asks for it |

B and C before D is deliberate, and is the recommendation worth defending hardest: **a new
extension standard adds authors, and authors add sites slowly. An addon client and a
challenge solver add sites immediately — and they make the standard worth writing against
by the time it lands.**

---

## 9. Decisions to take now

1. **`Source` is frozen before any lane is written.** It is the object every part of the app
   already consumes; changing it later is a migration across the player, the cache, the
   library, the exporter and the diagnostics.
2. **Capability allow-listing is P0, not P1.** A sandbox with no network allow-list is a
   sandbox against accidents only.
3. **No UI code in extensions, ever.** Declarative settings, host-rendered.
4. **The diagnosis field is part of the return type.** See §3.6.
5. **Widevine is deferred and named honestly.** Do not fork Electron for one row of §6.3
   until the rest of that column is closed.

Open, and genuinely undecided:

- **Do we publish `.csx` as a *CloudStream* standard or a *this-app* standard?** Upstream's
  KMP direction (doc 27 §6.2 Runtime 2) may converge with it; a fourth incompatible format
  helps nobody if it does.
- **Does L2 mean we also *serve* our providers as Stremio addons?** It would make every
  `.cs3` in our corpus reachable from Stremio itself. That is a large ecosystem move, with
  licensing (GPL-3.0) and abuse implications worth deciding deliberately rather than
  discovering after it becomes possible by accident.
- **Where does the fetch broker live** — main process, or the sidecar? One implementation
  serving both is the goal; the JVM's own TLS stack is the complication.

---

## 10. Sources

Protocol and ecosystem references consulted 2026-08-23:

- Stremio addon protocol, manifest and Stream objects —
  <https://stremio.github.io/stremio-addon-sdk/protocol.html>,
  <https://stremio.github.io/stremio-addon-sdk/api/responses/manifest.html>,
  <https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/api/responses/stream.md>
- Kodi add-on structure and Python scrapers — <https://kodi.wiki/view/Add-on_structure>,
  <https://kodi.wiki/view/Addon.xml>,
  <https://kodi.wiki/view/Python_movie_scraper_development>
- Aniyomi / Mihon extension model and repository index —
  <https://deepwiki.com/aniyomiorg/aniyomi/6-extensions-and-sources>,
  <https://github.com/yuzono/aniyomi-extensions>
- Extism plugin framework and host functions —
  <https://extism.org/docs/concepts/host-functions/>, <https://github.com/extism/extism>
- WASI 0.2 / 0.3 and the component model —
  <https://byteiota.com/wasi-0-3-0-webassembly-component-model-goes-production/>
- QuickJS sandboxing controls — <https://github.com/justjake/quickjs-emscripten>,
  <https://github.com/sebastianwessel/quickjs>
- `isolated-vm` / `vm2` advisories —
  <https://advisories.gitlab.com/pkg/npm/isolated-vm/CVE-2022-39266/>
- TLS fingerprinting, FlareSolverr / Byparr, curl_cffi —
  <https://scrapeops.io/web-scraping-playbook/how-to-bypass-cloudflare/>,
  <https://godberrystudios.com/posts/byparr-scrapling-flaresolverr-cloudflare-bypass-2026/>
- MediaFlow Proxy (HLS/DASH proxying with ClearKey decryption) —
  <https://github.com/mhdzumair/mediaflow-proxy>
- castLabs Electron for Content Security / Widevine VMP —
  <https://github.com/castlabs/electron-releases>,
  <https://castlabs.com/security/widevine-certification/>
- libmpv render API embedding — <https://mpv-player-mpv.mintlify.app/embedding/libmpv>,
  <https://4gray.github.io/iptvnator/blog/embedded-mpv-macos-experiment/>
- mpv HDR and passthrough configuration — <https://carlosfelic.io/misc/best-mpv-config-2026/>
- TypeScript scraper ecosystems — <https://providers.pstream.mov/>,
  <https://github.com/consumet/consumet.ts>
