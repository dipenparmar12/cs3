# Native media playback via mpv

> **Status: implemented 2026-08-19.** Option A (portable `mpv` driven over JSON IPC) is
> built, wired into the compatibility engine, and covered by tests that spawn a real mpv
> process. Option B (libmpv embedded via a native addon, video surface inside the Electron
> window) is **not** built — see "What is not built" below. The rest of this document is
> the original design discussion and is kept because the reasoning still holds.

## What was built

| Piece | Where |
|---|---|
| Engine: process supervision, JSON-RPC over named pipe / unix socket, property observation, tracks, seek, subtitles | `cs3_windows/electron/media/mpvEngine.ts` |
| Shared contract (`MpvSnapshot`, `MpvOpenRequest`, `MpvTrack`, `MpvEngineStatus`) | `cs3_windows/src/types/mpv.ts` |
| Routing decision (`NATIVE_MPV` strategy, `shouldRouteToNativeEngine`) | `cs3_windows/electron/media/decisionEngine.ts` |
| Pipeline integration — no ffmpeg session is opened for a routed stream | `cs3_windows/electron/media/playbackEngine.ts` |
| On-demand provisioning of a portable Windows build | `cs3_windows/electron/binaryDownloader.ts` (`setupMpv`) |
| IPC surface (`mpv:*`), policy persistence, shutdown wiring | `cs3_windows/electron/main.ts`, `preload.ts` |
| Player surface — our controls, mpv's playback | `cs3_windows/src/components/player/NativeEngineStage.tsx` |
| Settings: policy selector, install button, decoder listing | `cs3_windows/src/components/PlayerSettings.tsx` |
| Tests against a real mpv process (12 cases) | `cs3_windows/electron/media/mpvEngine.test.mts` |
| Routing rows in the decision matrix (13 new cases) | `cs3_windows/electron/media/decisionEngine.test.mts` |
| Vendor coverage harness — real providers, real streams, real playback | `tools/e2e/native-engine-matrix.mjs` |

## The one decision this document did not make

The document above proposes routing on a capability hierarchy and leaves the *policy* open.
What shipped is three policies, defaulting to `auto`:

- `off` — the FFmpeg ladder does everything, exactly as before.
- `auto` — mpv takes any stream the browser path would have **re-encoded**, plus lossless
  and object-based audio (TrueHD, DTS-HD MA, DTS:X, FLAC, PCM).
- `aggressive` — mpv takes everything not already playing natively, including the cheap
  container remux, which preserves 5.1/7.1 everywhere.

**AC-3 and E-AC-3 5.1 do not route under `auto`,** and the table in §1 of this document
would have routed them. The reason for departing from it is recoverability: a stereo
downmix of AC-3 loses a speaker layout, and the 5.1 is still in the file next time; a
re-encode of TrueHD to 192 kbit stereo destroys the thing the release exists for. Since the
engine renders in its own window today, routing AC-3 would push most television releases
out of the in-app player to save a few percent of one core. `aggressive` exists for anyone
who wants that trade, and it is not the default.

## What is not built

**Embedding.** mpv renders in its own window. Putting the video surface inside the Electron
window needs libmpv's render API through a native addon — Option B above — and a
three-window compositing scheme built on `--wid` plus a transparent overlay was rejected
rather than attempted: it could not be verified visually in this environment, and shipping
a half-working one is worse than a separate surface that behaves predictably.
`MpvOpenRequest.windowHandle` exists and is passed through as `--wid`; nothing sets it yet,
so that is the single seam Option B has to fill.

**DRM.** Unchanged, and unchanged for the reason §"One major Electron consideration" gives:
mpv holds no CDM. Widevine, PlayReady and ClearKey streams are classified and reported by
name, and `shouldRouteToNativeEngine` explicitly refuses to send them to the engine —
handing an encrypted stream to mpv produces the same undecryptable noise FFmpeg would,
minus the EME pipeline that could actually have played it.

## Measured, on this machine

- HEVC 10-bit + 5.1 AC-3 in Matroska — three separate reasons Chromium refuses it —
  decoded by mpv at full resolution with `hwdec-current: d3d11va`, zero dropped frames.
- The same file through the FFmpeg ladder: `FULL_TRANSCODE`, and on a software-only host
  under 16 threads it is downscaled to 1080p by the encoder guard.
- Found while building the vendor harness, unrelated to mpv but fixed alongside it:
  FFmpeg 7.1's `-extension_picky` (default *on*, evaluated before the allow-list) had
  silently killed the `-allowed_extensions ALL` fix for providers serving HLS segments from
  `.png` and extensionless URLs. See `CLAUDE.md`.

---

# Original design discussion

Yes. The important distinction is that your Electron app is not limited to Chromium's `<video>` pipeline.

For your architecture, where you receive arbitrary streaming URLs from third party platforms and have no control over the source media, I would not try to force everything through the browser video element. Instead, use a native media engine inside the Electron application.

### Recommended architecture

```text
React UI
   |
   | play(url)
   v
Electron Main Process
   |
   v
Native Media Engine
   |
   +---- mpv / libmpv
   |       |
   |       +---- FFmpeg
   |       +---- Hardware decoding
   |       +---- HTTP/HLS/DASH/etc.
   |
   v
GPU
   |
   v
Video surface/window
```

For Windows, **mpv/libmpv is probably the strongest option** for what you are building.

mpv supports many codecs and containers, hardware video decoding, network URLs, and has an embeddable C API specifically intended for integration into other applications. ([mpv][1])

### Why mpv is a good fit

Your problem is not really "4K and 8K".

The actual problem is usually combinations such as:

```text
Resolution
Codec
Profile
Bit depth
HDR
Container
Transport
Hardware decoder availability
```

For example:

```text
3840x2160 HEVC 10-bit
7680x4320 HEVC 10-bit
AV1 8K
VP9 Profile 2
HDR10
Dolby Vision
60/120 FPS
```

Chromium's media pipeline may reject some of these combinations even though the Windows machine's GPU can decode them perfectly.

mpv can use native hardware decoding APIs. On Windows, its documented hardware decoding includes `d3d11va`, and it can also use NVIDIA-specific decoding such as `nvdec`. ([mpv][1])

So instead of:

```jsx
<video src={url} />
```

you effectively want:

```text
React
   ↓
Electron IPC
   ↓
libmpv
   ↓
FFmpeg
   ↓
D3D11VA / NVDEC / other hardware decoder
   ↓
GPU
```

### Option 1: Use libmpv embedded into your Electron window

This would be my preferred production architecture.

Your React application continues to own the UI:

```text
┌─────────────────────────────────────────────┐
│ React UI                                    │
│                                             │
│  Title                                      │
│                                             │
│  ┌───────────────────────────────────────┐  │
│  │                                       │  │
│  │             Native Video              │  │
│  │               Surface                 │  │
│  │                                       │  │
│  └───────────────────────────────────────┘  │
│                                             │
│  timeline  volume  subtitles  quality      │
└─────────────────────────────────────────────┘
```

React handles:

```text
Play
Pause
Seek
Volume
Subtitles
Tracks
Progress
Fullscreen
Quality
Loading
Error handling
```

libmpv handles:

```text
HTTP streaming
HLS
Codec detection
FFmpeg demuxing
HEVC
AV1
VP9
10-bit
HDR
Hardware decoding
Frame rendering
```

mpv itself exposes runtime hardware decoding and supports Windows D3D11 based decoding. ([mpv][1])

### Option 2: Run mpv as a separate child process

This is significantly easier to prototype.

Electron:

```text
Electron
    |
    +---- mpv.exe
             |
             +---- stream URL
```

For example conceptually:

```bash
mpv.exe \
  --hwdec=auto \
  --force-window=yes \
  "https://third-party-provider/video.mkv"
```

mpv can directly consume HTTP/HTTPS streams using its network backend, including HTTP/2 and HTTP/3 when available. ([mpv][1])

The downside is that you now have to solve window embedding, IPC, synchronization, and UI integration.

For a serious player, I would move from this prototype to libmpv.

### Option 3: VLC/libVLC

Another reasonable choice is libVLC.

Architecture:

```text
React
  ↓
Electron
  ↓
libVLC
  ↓
FFmpeg
  ↓
GPU
```

It is mature and very capable.

However, for a modern streaming application where you want tight control over the rendering pipeline, subtitles, playback state, hardware acceleration, and custom UI, I would evaluate **libmpv before libVLC**.

### Do not transcode through your own server

In your case, I would specifically avoid this architecture:

```text
Third-party source
        ↓
Your server
        ↓
FFmpeg
        ↓
H.264
        ↓
Electron
```

That would solve browser compatibility, but it creates exactly the infrastructure you said you do not have:

```text
bandwidth costs
CPU/GPU costs
server infrastructure
latency
copyright/content handling complexity
scaling problems
```

You do not need to do that simply because Chromium cannot decode a particular stream.

### Important distinction: container vs codec

You should first inspect what the URL actually provides.

For example:

```text
MP4
 └── HEVC
     └── 10-bit
```

may be completely playable through mpv even though Chromium rejects it.

Similarly:

```text
MKV
 └── HEVC
```

or:

```text
MPEG-TS
 └── HEVC
```

could work without any conversion.

Windows itself has Media Foundation support for HEVC decoding, including MP4 and M2TS playback scenarios, but actual hardware capabilities still depend on the GPU, driver, codec profile and configuration. ([Microsoft Learn][2])

### Your player should therefore have a capability hierarchy

I would implement something like:

```text
                   Streaming URL
                         |
                         v
                 Detect stream type
                         |
               ┌─────────┴─────────┐
               │                   │
         Chromium compatible   Not compatible
               │                   │
               v                   v
        HTML5 video          Native player
                                |
                                v
                              mpv
                                |
                     ┌──────────┼──────────┐
                     │          │          │
                   D3D11VA    NVDEC      CPU
                     │          │          │
                     └──────────┴──────────┘
                                |
                                v
                              Output
```

This gives you the best of both worlds.

For normal streams:

```text
H264 + MP4
VP9 + WebM
normal HLS
```

you can potentially continue using Chromium.

For difficult streams:

```text
HEVC
10-bit
8K
AV1
MKV
HDR
unusual profiles
```

switch to the native engine.

### Even better: don't decide purely based on 4K/8K

I would not write:

```javascript
if (width >= 3840) {
    useNativePlayer()
}
```

Instead, determine whether Chromium can actually play the stream.

Conceptually:

```javascript
const canPlay = video.canPlayType(mimeType)

if (canPlay) {
    useChromiumPlayer()
} else {
    useNativePlayer()
}
```

But because you often don't know the real codec from a streaming URL, you may need stream probing.

For example:

```text
URL
 ↓
probe headers / manifest
 ↓
codec = HEVC
bit depth = 10
resolution = 7680x4320
HDR = yes
 ↓
native player
```

For HLS/DASH, you can inspect the manifest rather than downloading the media itself.

### One major Electron consideration

Do not put the native decoder implementation directly into your React renderer.

Keep it behind Electron IPC.

```text
React Renderer
      |
      | IPC
      v
Electron Main
      |
      v
Native Player
```

For example:

```javascript
ipcRenderer.invoke("player:load", url)
ipcRenderer.invoke("player:play")
ipcRenderer.invoke("player:pause")
ipcRenderer.invoke("player:seek", position)
```

Then the native layer reports:

```text
time
duration
buffer
resolution
codec
fps
dropped frames
audio track
subtitle track
```

back to React.

### What I would build for your application

Given that you are building an online streaming desktop application, I'd structure it as:

```text
packages/
  player/
    chromium/
      ChromiumPlayer.jsx

    native/
      MpvPlayer.jsx

    core/
      PlayerManager.js
      StreamDetector.js
      PlayerEvents.js
```

With:

```javascript
class PlayerManager {
    async play(stream) {
        if (await chromiumCanPlay(stream)) {
            return chromiumPlayer.play(stream)
        }

        return nativePlayer.play(stream)
    }
}
```

Then your React UI doesn't care which engine is being used.

```text
                 PlayerManager
                      |
             ┌────────┴────────┐
             |                 |
        Chromium           Native mpv
             |                 |
          Browser            FFmpeg
          decoder           hardware
                              decoder
```

### One more important issue: DRM

There is a major caveat.

If the third party provides something like:

```text
Widevine DRM
PlayReady DRM
encrypted DASH
encrypted HLS
```

then merely adding mpv does not automatically solve it.

For non-DRM streams, native playback is straightforward.

For DRM-protected streams, the architecture becomes substantially different because the DRM/CDM, license acquisition and protected decoding pipeline must be supported.

So I would classify your sources as:

```text
1. Normal browser-compatible
        ↓
   Chromium

2. Non-browser-compatible but unencrypted
        ↓
   libmpv

3. DRM protected
        ↓
   dedicated DRM/Chromium/CDM architecture
```

### My recommendation

For your specific application, I would **not abandon Chromium entirely** and I would **not build a transcoding server**.

Use:

```text
React
   ↓
Electron
   ↓
Player abstraction
   ├── Chromium <video>
   │
   └── libmpv
          ↓
       FFmpeg
          ↓
   Windows hardware decoding
          ↓
      GPU rendering
```

This gives you native playback for the streams Chromium cannot handle while keeping your existing browser-based player for everything else.

mpv is particularly attractive here because it already handles network streams, broad codec/container support and hardware decoding, including Windows D3D11-based decoding. ([mpv][1])

For your project, I would build the **libmpv integration first**, rather than implementing an FFmpeg decoder yourself. That avoids turning your application into a media-engine development project.

A next useful step would be designing the actual **Electron + React + libmpv Windows architecture**, including how to embed the native video surface inside the Electron UI and pass play/pause/seek/subtitle/progress events between React and mpv.

[1]: https://mpv.io/manual/master/?utm_source=chatgpt.com "mpv.io"
[2]: https://learn.microsoft.com/en-us/windows/win32/medfound/h-265---hevc-video-decoder?utm_source=chatgpt.com "H.265 / HEVC Video Decoder - Win32 apps | Microsoft Learn"


#

**Yes, absolutely. The proposal you provided outlines the **industry-standard architecture** used by high-performance desktop media clients (such as **Plex HTPC**, **Stremio Desktop**, **Jellyfin Media Player**, and **IINA**).

In Electron on Windows, delegating playback of difficult streams (4K/8K, HEVC 10-bit, HDR10, Dolby Vision, MKV, DTS:X, Dolby TrueHD) to a **native media engine like `mpv`** is vastly superior to transcoding them through FFmpeg to feed Chromium's `<video>` tag.

---

### 1. Current State vs. Native `mpv` Engine

Here is how our existing **Universal Media Compatibility Engine** ([PRD-37](file:///D:/projects/cs3/docs/PRD/37-universal-media-compatibility-and-adaptive-playback-engine.md)) in `cs3_windows` compares to adding a native `mpv` engine:

| Stream Characteristic | Current Strategy ([PRD-37](file:///D:/projects/cs3/docs/PRD/37-universal-media-compatibility-and-adaptive-playback-engine.md)) | Native `mpv` Engine Strategy | Result with `mpv` |
|---|---|---|---|
| **MP4 / H.264 / AAC (1080p)** | Direct Play in Chromium `<video>` | Direct Play in Chromium `<video>` | Instant, 0% CPU |
| **MKV / H.264 / AC-3 or DTS** | FFmpeg Remux + Audio Xcode (`-c:v copy -c:a aac`) | Native `mpv` hardware playback | Instant, 0% CPU, preserves 5.1/7.1 audio |
| **4K / 8K HEVC 10-bit (`yuv420p10le`)** | GPU Transcode (`h264_nvenc`) or CPU downscale to 1080p | **Direct GPU Decode via D3D11VA / NVDEC** | **Zero transcoding lag, full 4K/8K 60fps, 1-2% CPU** |
| **HDR10 / Dolby Vision** | Tone-mapped to 8-bit SDR H.264 | **Direct Windows HDR / D3D11 passthrough** | **True 10-bit HDR on HDR displays** |
| **Exotic Codecs (VC-1, MPEG-2, RealVideo)** | CPU Re-encode via `libx264` | Native FFmpeg demux/decode | Instant, zero CPU re-encoding |

---

### 2. How `mpv` Solves the 4K / 8K & 10-bit Bottleneck

When Chromium encounters a 4K HEVC 10-bit stream (common in GDFlix, Google Drive, and high-quality torrents):
1. **Chromium's internal pipeline** does not ship with software HEVC decoders on desktop and often rejects 10-bit pixel formats or Matroska demuxing.
2. **Re-encoding 4K to H.264 in FFmpeg** requires significant GPU encoder bandwidth (or 100% CPU on 16 threads), generates heat, and strips HDR metadata.
3. **`mpv` bypasses Chromium entirely:** It talks directly to Windows **Direct3D 11 Video Acceleration (`d3d11va`)**, **DirectX Video Acceleration (DXVA2)**, and **NVIDIA NVDEC**. It feeds the compressed 4K/8K bitstream straight into the GPU decoder hardware and displays it directly onto the screen.

```text
┌────────────────────────────────────────────────────────────────────────┐
│                        Hybrid Playback Routing                         │
└────────────────────────────────────────────────────────────────────────┘
                                 Stream URL
                                     │
                                     ▼
                    Pre-Playback Inspection (ffprobe)
                                     │
         ┌───────────────────────────┼───────────────────────────┐
         ▼                           ▼                           ▼
  Standard Web Stream         DRM-Protected Stream      Heavy / Incompatible
 (MP4, WebM, H264, AV1)      (ClearKey, Widevine L3)    (4K/8K, HEVC 10-bit, HDR,
         │                           │                   MKV, DTS, High Bitrate)
         ▼                           ▼                           │
  Chromium <video>             Chromium EME                      ▼
   Direct Render              (dash.js / hls.js)          Native mpv Engine
                                                          (Direct GPU Decode:
                                                          D3D11VA / NVDEC / Vulkan)
```

---

### 3. Concrete Implementation Options in Electron (Windows)

There are two primary ways to integrate `mpv` into `cs3_windows`:

#### Option A: Headless `mpv.exe` with JSON IPC & Window Embedding (`--wid`) — *Recommended First Step*

Electron can launch a portable, bundled `mpv.exe` in the background (managed by [`binaryDownloader.ts`](file:///D:/projects/cs3/cs3_windows/electron/binaryDownloader.ts)), attach it to a designated window handle (`HWND`), and control it via JSON-RPC over a Windows Named Pipe (`\\.\pipe\mpvsocket`).

```typescript
// electron/mpvEngine.ts
import { spawn, ChildProcess } from 'child_process';
import net from 'net';

export class MpvEngine {
  private process: ChildProcess | null = null;
  private socket: net.Socket | null = null;
  private pipePath = '\\\\.\\pipe\\cs3_mpv_socket';

  public async start(streamUrl: string, windowHandle?: Buffer) {
    const args = [
      '--idle=yes',
      `--input-ipc-server=${this.pipePath}`,
      '--hwdec=auto-safe',           // Automatically use D3D11VA / NVDEC on Windows
      '--vo=gpu-next',               // High-quality GPU video output
      '--gpu-context=d3d11',         // Direct3D 11 context
      '--force-window=immediate',
      '--keep-open=yes',
    ];

    // If embedding into a specific container HWND:
    if (windowHandle) {
      const wid = windowHandle.readInt32LE(0);
      args.push(`--wid=${wid}`);
    }

    this.process = spawn('mpv.exe', args, { stdio: 'ignore' });

    // Connect to MPV JSON-RPC Named Pipe
    this.socket = net.connect(this.pipePath, () => {
      this.sendCommand(['loadfile', streamUrl]);
    });
  }

  public sendCommand(command: (string | number | boolean)[]) {
    if (this.socket && !this.socket.destroyed) {
      this.socket.write(JSON.stringify({ command }) + '\n');
    }
  }

  public seek(seconds: number) {
    this.sendCommand(['seek', seconds, 'absolute']);
  }

  public setVolume(volume: number) {
    this.sendCommand(['set_property', 'volume', volume]);
  }
}
```

#### Option B: C++ Native Node Addon with `libmpv` (`node-libmpv` / OpenGL / D3D11 texture sharing)

* **Architecture**: Uses `libmpv-2.dll` loaded directly inside the Electron process.
* **Rendering**: `libmpv` renders frames directly to an offscreen render target (FBO or D3D11 shared texture) which is displayed inside a WebGL / WebGPU canvas in React.
* **Benefit**: React controls 100% of the UI layering directly on top of the video canvas with no z-index or window management issues.

---

### 4. How to Integrate this into `cs3_windows`

We can integrate this into our existing codebase without breaking any existing features:

1. **Auto-Provision `mpv.exe` in [`binaryDownloader.ts`](file:///D:/projects/cs3/cs3_windows/electron/binaryDownloader.ts)**:
   Add `mpv` to the portable binary mirrors alongside `aria2c`, `yt-dlp`, and `ffmpeg`. Download the lightweight official Windows build (~25MB) into `%APPDATA%/cs3/bin/mpv.exe` on first launch.

2. **Update the Decision Matrix in [`decisionEngine.ts`](file:///D:/projects/cs3/cs3_windows/electron/media/decisionEngine.ts)**:
   Instead of forcing HEVC 10-bit or 4K/8K through CPU/GPU transcoding down to 8-bit H.264, route it directly to strategy `NATIVE_MPV`:
   ```typescript
   if (isTenBit || videoCodec === 'hevc' || resolution.height >= 2160) {
     return {
       strategy: 'NATIVE_MPV',
       directPlayable: false,
       plan: { action: 'native_mpv_gpu' },
       explanation: 'Direct GPU hardware playback via native mpv engine (4K/8K HDR)'
     };
   }
   ```

3. **Provide In-Player Source & Engine Switching in React**:
   In [`VideoPlayer.tsx`](file:///D:/projects/cs3/cs3_windows/src/components/VideoPlayer.tsx), allow the user to toggle between:
   - **Internal Browser Player** (standard web streams)
   - **Native Accelerated Engine (`mpv`)** (4K, HDR, 10-bit HEVC, Blu-ray Remuxes)
   - **External Player Handoff** (VLC, MPC-HC via [`externalPlayer.ts`](file:///D:/projects/cs3/cs3_windows/electron/externalPlayer.ts))

---

### Next Step

Would you like to start by:
1. Adding **portable `mpv` provisioning** to [`binaryDownloader.ts`](file:///D:/projects/cs3/cs3_windows/electron/binaryDownloader.ts)?
2. Implementing the **`MpvEngine` IPC controller** in `electron/` for Windows D3D11 hardware decoding?
3. Updating the **decision engine & player UI** to support seamless native playback switching?**