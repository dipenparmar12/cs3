# CloudStream 3 Desktop Universal Media Compatibility and Adaptive Playback Engine

## 1. Document Purpose

This PRD defines the end to end media playback architecture for CloudStream 3 Desktop.

The objective is to provide reliable playback for the widest practical range of external media sources while preserving:

- Native Chromium and DOM based rendering whenever practical
- Full React UI composition and overlays
- Efficient hardware accelerated playback
- Reliable playback of formats Chromium does not natively support
- Programmatic playback control
- HLS and DASH adaptive streaming
- DRM aware playback
- External provider authentication and signed URL handling
- Audio and subtitle compatibility
- Seeking and resume behavior
- Measurable playback quality
- Deterministic engine selection
- Minimal unnecessary transcoding
- A clear path toward future libmpv rendering integration

The system must not attempt to solve every media problem with one playback engine.

The system instead uses a controlled orchestration layer that selects the most appropriate playback strategy for each source.

The fundamental product objective is:

> Optimize for the best user visible playback path, not the fewest playback engines.

---

# 2. Product Goals

## 2.1 Primary Goals

CloudStream 3 Desktop must:

1. Reliably play common browser compatible media using Chromium.
2. Support HLS and DASH through specialized web playback engines.
3. Support media formats and codecs that Chromium cannot reliably decode through MPV.
4. Use FFmpeg for targeted media transformation when transformation provides a better user experience than native playback.
5. Preserve the existing React UI and DOM composition wherever practical.
6. Support external media servers requiring headers, cookies, referers, user agents and authorization.
7. Support long running playback where provider URLs expire.
8. Support DRM aware playback and report unsupported DRM clearly.
9. Support text subtitles and bitmap subtitle strategies.
10. Preserve audio quality according to the user's selected audio policy.
11. Provide deterministic, observable engine selection.
12. Measure real playback behavior before making future routing changes.

## 2.2 Secondary Goals

The architecture should:

- Minimize startup latency
- Minimize CPU and GPU overhead
- Avoid unnecessary disk usage
- Avoid unnecessary transcoding
- Preserve seekability
- Avoid engine switching after playback begins where possible
- Maintain a single player API regardless of the underlying engine
- Allow future replacement or addition of playback engines without rewriting the UI
- Allow future libmpv integration without making it a requirement for the current release

---

# 3. Non Goals

This PRD does not attempt to:

- Build a media decoder from scratch
- Replace FFmpeg
- Replace mpv
- Implement a proprietary DRM system
- Automatically bypass DRM restrictions
- Guarantee playback of content where the required DRM CDM is unavailable
- Guarantee playback of every possible codec or container
- Build a universal Windows audio topology detector
- Perform OCR on bitmap subtitles during normal playback
- Embed libmpv before its compositing requirements are understood
- Optimize engine routing without real playback telemetry

---

# 4. Design Principles

## 4.1 Web First, Native When Necessary

DOM based playback remains preferred because it provides:

- Native React composition
- Overlay controls
- Menus
- Animations
- Rounded corners
- Fullscreen integration
- PiP support
- Browser based accessibility
- Easy synchronization with React state

Native MPV playback is used when the web playback path cannot provide acceptable compatibility or media fidelity.

## 4.2 Transformation Is a Tool, Not the Player

FFmpeg is responsible for:

- Remuxing
- Audio transcoding
- Video transcoding
- Full transcoding
- Media inspection

MPV is responsible for native playback.

Web engines are responsible for browser playback.

## 4.3 No Blind Playback

No source should be attached to a playback engine before the required inspection and capability decision has completed.

## 4.4 Pre Playback Routing

The system should make a deterministic engine decision before user visible playback begins wherever possible.

## 4.5 Keep User Experience as the Primary Constraint

A technically compatible path is not automatically a good path.

Engine selection must consider:

- Rendering surface
- Subtitle compatibility
- Audio requirements
- Seeking
- Hardware acceleration
- DRM
- Startup latency
- Engine transition cost

## 4.6 Measure Before Optimizing

Current routing behavior becomes the baseline.

Routing should not be changed based solely on theoretical arguments.

Real playback telemetry must determine future policy changes.

---

# 5. Current High Level Architecture

```text
                         Provider Source
                                |
                                v
                           SourceLease
                                |
                                v
                            MediaProxy
                                |
               +----------------+----------------+
               |                |                |
               v                v                v
        Manifest Inspector   Media Probe     DRM Discovery
               |                |                |
               |                |                |
               +----------------+----------------+
                                |
                                v
                       Capability Model
                                |
                                v
                         Decision Engine
                                |
             +------------------+------------------+
             |                  |                  |
             v                  v                  v
        Web Playback       FFmpeg Transform      MPV
             |                  |                  |
        +----+----+         Remux/Transcode    Native Decode
        |         |                             |
      HTML5     Shaka                         HW Decode
      hls.js                                  libass
             |                                    |
             +----------------+-------------------+
                              |
                              v
                    Unified Player State
                              |
                              v
                      React Player UI
```

---

# 6. Core Components

## 6.1 SourceLease

`SourceLease` represents the logical media source independently from its current provider URL.

Its purpose is to manage:

- Stable source identity
- Current resolved URL
- URL expiry
- Refresh state
- Refresh limits
- Re-resolution
- Reconnect behavior

A provider URL is not treated as the permanent identity of the media source.

### Required Concept

```ts
type SourceLease = {
  sourceId: string
  resolve(): Promise<ResolvedSource>
  expiresAt?: number
  refreshBudget: number
}
```

### Source Identity

`sourceId` must remain stable across provider URL refreshes.

Example:

```text
sourceId = movie-123-provider-x
URL #1 = signed-url-token-a
URL #2 = signed-url-token-b
```

Both belong to the same logical source.

### Refresh and Reconnect Must Be Separate

Connection failure:

```text
source connection
    |
    +-> reconnect
```

Expired or invalid lease:

```text
source lease
    |
    +-> re-resolve
```

The system must not treat every connection failure as a reason to resolve a new provider URL.

### Refresh Budget

The lease must have a bounded refresh budget.

Repeated failures must not create:

```text
403
-> resolve
-> 403
-> resolve
-> 403
-> resolve
```

indefinitely.

### Refresh Conditions

Refresh may be triggered by:

- Known expiration
- Expired `expiresAt`
- Provider-specific expiration response patterns
- Explicit lease invalidation

A generic 403 must not automatically cause unlimited re-resolution.

---

# 7. MediaProxy

MediaProxy remains the common network abstraction for all playback engines.

It runs on loopback:

```text
http://127.0.0.1:<port>/stream/<token>
```

## 7.1 Responsibilities

MediaProxy provides:

- Source header injection
- Referer
- Origin
- User-Agent
- Cookies
- Authorization
- Redirect handling
- Range support
- HTTP 206 behavior
- Connection reconnect
- SourceLease integration
- Upstream error handling
- Stable local playback URLs

## 7.2 Engine Independence

The same logical source must be usable by:

```text
HTML5
hls.js
Shaka
FFmpeg
MPV
```

without duplicating provider authentication logic in each engine.

## 7.3 Refresh Architecture

MediaProxy must be able to request a fresh source from SourceLease without changing the logical `sourceId`.

---

# 8. Source Inspection Architecture

The original fixed 2 MB probe is replaced by container-aware inspection strategies.

Inspection must not assume that every source is a normal byte-addressable media file.

## 8.1 URL Type Detection

URL type detection must be cheap and synchronous where possible.

Possible categories:

```text
DIRECT_MEDIA
HLS_MANIFEST
DASH_MANIFEST
UNKNOWN
```

Detection should use:

- URL extension
- Content-Type
- known provider metadata
- response headers when available

Detection should not perform expensive probing.

---

# 9. Manifest Inspection

## 9.1 HLS

HLS sources must be inspected as manifests.

The system should identify:

- Master playlist or media playlist
- Variants
- Video codecs
- Audio codecs
- Resolution
- Framerate where available
- Encryption
- Key method
- Subtitle tracks
- Audio groups
- Segment format

Do not use FFprobe on the playlist as a substitute for manifest inspection.

## 9.2 DASH

DASH sources must be inspected as manifests.

The system should identify:

- Adaptation sets
- Representations
- Video codecs
- Audio codecs
- Resolution
- Framerate
- Encryption
- `ContentProtection`
- Key system hints
- Subtitle tracks
- Segment format

DRM discovery for DASH is downstream of MPD parsing because encryption information exists inside the manifest.

---

# 10. Direct Media Inspection

Direct media inspection uses FFprobe through MediaProxy.

The inspector extracts:

### Container

```text
formatName
mimeType
duration where available
```

### Video

```text
codec
profile
level
bitDepth
pixelFormat
HDR
width
height
framerate
```

### Audio

```text
codec
channels
language
default track
bitrate where available
```

### Subtitles

```text
codec
language
default track
isBitmap
```

---

# 11. Container Typed Probe Strategies

Inspection must be selected according to the detected or inferred container.

## 11.1 MP4 / MOV

Initial strategy:

```text
head probe
```

If metadata is incomplete:

```text
tail probe
```

This handles files where the `moov` atom is located near the end.

## 11.2 MPEG-TS

Do not assume a 2 MB head probe is sufficient.

Use larger:

```text
probesize
analyzeduration
```

values as required to identify streams reliably.

## 11.3 Unknown Containers

Use progressive probing.

The inspector must report insufficient inspection rather than falsely claiming unsupported media.

---

# 12. Inspection Failure Handling

The system must distinguish:

```text
INSPECTION_SUCCESS
INSPECTION_INCOMPLETE
INSPECTION_FAILED
UNSUPPORTED_CONTAINER
```

An incomplete probe must not be treated as proof of incompatibility.

The existing `blindFallbackPlan` remains a controlled safety path, but it must not blindly copy video when critical codec properties are unknown.

---

# 13. Capability Model

Capability describes what the current application environment can actually do.

Capability must be separated from preference.

## 13.1 Capability Questions

The system must separately answer:

```text
Can the container be demuxed?
Can direct playback accept the media type?
Can MSE accept the codec?
Can the decoder handle the exact configuration?
Is playback likely to be smooth?
Is playback power efficient?
Is the required DRM available?
Are subtitles compatible?
Is the required audio output compatible?
Can the output surface support the requested UI?
```

---

# 14. Browser Capability Detection

The primary browser capability API is:

```text
navigator.mediaCapabilities.decodingInfo()
```

The matrix must query relevant configurations for both:

```text
type: "file"
type: "media-source"
```

These results must be computed at application launch and cached.

The matrix must not be recomputed for every media source.

## 14.1 MediaSource Capability

Use:

```text
MediaSource.isTypeSupported()
```

as the MSE type acceptance signal.

## 14.2 Do Not Use canPlayType as the Primary Signal

`canPlayType()` is not sufficient for routing because it does not provide the same configuration level of:

- supported
- smooth
- power efficient

The capability layer should rely on:

```text
decodingInfo()
MediaSource.isTypeSupported()
container compatibility
actual environment probes
```

---

# 15. Capability Cache

Capability cache must be fingerprinted.

Fingerprint should include:

```text
appVersion
electronVersion
OS build
GPU identity
GPU driver
capability probe results
```

The capability cache must account for cases where Windows media support changes independently of application or OS version, such as HEVC support being installed or removed.

A known HEVC capability sanity probe should be stored and revalidated at launch when necessary.

---

# 16. Capability and Preference Separation

Two distinct operations must exist.

## 16.1 capabilities()

Produces what the current environment and source support.

Example:

```ts
capabilities(source, environment)
```

## 16.2 selectEngine()

Produces the preferred strategy according to:

- Source capabilities
- Browser capabilities
- Native capabilities
- DRM capabilities
- Subtitle requirements
- Audio policy
- Rendering requirements
- User preferences
- Current decision policy version

The DecisionEngine must remain side-effect free.

---

# 17. Rendering Surface Capability

Rendering surface is a first-class capability.

Possible surfaces:

```text
DOM
NATIVE_WINDOW
TEXTURE
```

The engine also exposes rendering properties:

```ts
type RenderTarget = {
  surface: "dom" | "native-window" | "texture"
  overlays: boolean
  alpha: boolean
  hdr: boolean
  colorspace: boolean
  fullscreen: boolean
  pip: boolean
}
```

## 17.1 Why This Matters

MPV in a separate process may render to a native window surface.

That creates limitations around:

- React overlays
- Menus
- Animations
- Rounded corners
- PiP
- Fullscreen composition
- Focus
- DPI
- Z-order

Therefore MPV is not automatically better merely because it can decode the media.

## 17.2 Future libmpv

The future libmpv render API is intended to investigate texture based integration.

The migration gate is not simply:

```text
Can libmpv be embedded?
```

It is:

```text
Can libmpv output be composed into the application's rendering pipeline
without unacceptable loss of HDR, 10-bit, PiP, fullscreen, timing or UI behavior?
```

---

# 18. Playback Engine Architecture

## 18.1 Web Playback

### HTML5

Use for compatible direct media.

Typical examples:

```text
MP4
WebM
H.264
VP9
AV1
AAC
Opus
```

subject to real capability detection.

### hls.js

Use for HLS when the browser requires JavaScript managed HLS.

Responsibilities include:

- Playlist loading
- Segment loading
- Adaptive bitrate
- Encryption handling where supported
- MSE integration

### Shaka Player

Use for DASH and DRM capable web playback.

Responsibilities include:

- DASH manifests
- MSE
- EME
- DRM configuration
- License requests
- Track selection
- Adaptive playback

---

# 19. Native MPV Engine

MPV is the native compatibility backend.

Current architecture:

```text
Electron
    |
    | IPC
    v
MPV process
```

Current IPC control must support:

```text
play
pause
stop
seek
volume
rate
audio track
subtitle track
timeline
state
errors
```

MPV can be restarted independently from Electron if necessary.

This process isolation is intentionally retained.

## 19.1 MPV Routing Candidates

MPV is appropriate for:

- Unsupported browser codecs
- Unsupported containers
- HEVC 10-bit
- HDR media where Chromium cannot reliably handle the source
- 8K media
- Lossless audio
- Multichannel audio when required by user policy
- Bitmap subtitles when native presentation is required
- User-selected native playback policy

## 19.2 MPV Is Not a Universal DRM Escape Hatch

Encrypted commercial DRM content must not fall through to MPV.

If required DRM is unavailable in the current Electron distribution:

```text
unplayable
reason = drm-unavailable
```

MPV must not be presented as the fallback.

---

# 20. FFmpeg Transformation Service

FFmpeg remains a transformation engine.

Supported strategies:

```text
REMUX_CONTAINER
AUDIO_TRANSCODE
VIDEO_TRANSCODE
FULL_TRANSCODE
```

## 20.1 Remux

Remuxing is preferred when:

- Video is already compatible
- Audio is compatible
- Container is the only problem
- Browser playback is desirable

Example:

```text
MKV
  +
H.264
  +
AAC
  |
  v
fMP4
```

This can be a very cheap compatibility bridge and should not be removed merely to simplify the architecture.

## 20.2 Audio Transcode

Audio transcoding may be used when:

- Video is browser compatible
- Audio is not
- User audio policy allows conversion
- Preservation of user selected output behavior is maintained

Do not treat every multichannel source as an automatic reason to transcode to stereo.

## 20.3 Video Transcode

Video transcoding is a last-resort compatibility path.

It should be below MPV for native-capable machines when:

- The source is HEVC
- 10-bit video is involved
- HDR would be lost
- GPU native decoding is available

Video transcoding introduces:

- CPU/GPU cost
- Quality loss
- HDR loss in some paths
- Startup overhead
- Seek restart behavior

---

# 21. Audio Policy

The product uses a simple three-way user setting:

```text
Stereo
Surround
Passthrough
```

Default:

```text
Stereo
```

## 21.1 Audio Setting Visibility

At application launch:

```text
AudioContext.destination.maxChannelCount
```

may be inspected once.

This is used only to determine whether the audio mode setting should be surfaced prominently during onboarding.

It is not the primary playback routing mechanism.

## 21.2 Routing

### Stereo

Prefer browser compatible audio.

Audio conversion may be appropriate when necessary.

### Surround

Prefer preserving multichannel output.

Route to MPV when the browser path would incorrectly downmix or otherwise fail to meet the selected policy.

### Passthrough

Prefer native playback where passthrough is required.

---

# 22. Subtitle Architecture

Subtitle compatibility is part of engine selection.

## 22.1 Text Subtitles

Supported examples:

```text
SRT
WebVTT
ASS
SSA
```

Browser compatible text subtitles may be normalized into WebVTT.

MPV may use libass for richer subtitle rendering.

## 22.2 Bitmap Subtitles

Examples:

```text
PGS
VOBSUB
```

Bitmap subtitles are not converted to WebVTT.

Supported strategies:

```text
native
dom-overlay
disable
```

### DOM Overlay Concept

Bitmap subtitle frames may be decoded into images with timing and positioning and rendered as absolutely positioned overlays above the HTML video.

This path must account for:

- Timing
- Position
- Scaling
- Fullscreen
- HDR
- Performance
- UI composition

OCR is not part of the normal playback path.

---

# 23. Decision Strategy

The strategy list remains:

```text
DIRECT
HLS_NATIVE
DASH_NATIVE
REMUX_CONTAINER
AUDIO_TRANSCODE
VIDEO_TRANSCODE
FULL_TRANSCODE
MPV_NATIVE
```

The list is a decision space, not a sequential retry chain.

The DecisionEngine evaluates the full capability model and selects one strategy.

---

# 24. Routing Policy

The current baseline policy remains web-first.

## 24.1 Preferred Order

Conceptually:

```text
1. Web direct
2. Web remux
3. Audio transformation when appropriate
4. MPV native
5. Video transcode
6. Full transcode
```

However, the actual choice is determined by capability and user policy.

This is not a hard-coded sequential fallback chain.

## 24.2 Remux vs MPV

Remux remains above MPV when:

- Video is already browser compatible
- Audio is already browser compatible
- Only container compatibility is missing
- Remux startup is cheap
- DOM composition is beneficial
- Seek behavior remains acceptable

## 24.3 Video Transcode vs MPV

MPV is preferred when:

- Native playback is available
- Video transcoding would lose HDR
- Video transcoding would introduce unnecessary CPU/GPU work
- Video transcoding introduces unacceptable seek behavior
- Native playback provides better media fidelity

## 24.4 Audio Transcode vs MPV

Depends on the selected audio policy.

Audio transformation should not be globally ranked without considering user output requirements.

---

# 25. Seek Architecture

Seekability is a property of delivery strategy, not merely transformation type.

A pipe based FFmpeg output is not inherently seekable just because it is a remux.

## 25.1 Piped Transform Seek

For piped transforms:

```text
seek request
    |
    v
stop current FFmpeg
    |
    v
restart FFmpeg
    |
    v
-ss <target> before -i
    |
    v
reattach playback
```

This behavior must be implemented and measured.

## 25.2 Disk Backed Transform

Disk backed transformed media is not a Tier 1 requirement.

It may be considered later only if measurement shows piped restart seeking is inadequate.

Do not introduce a media transformation storage subsystem without evidence.

---

# 26. Transition Cost

Playback selection must consider engine transition cost.

Example:

```text
DOM playback
   |
   v
MPV
```

may lose or recreate:

- Buffer state
- Fullscreen state
- Subtitle state
- PiP state
- Exact presentation position
- DOM overlay state

Therefore pre-playback routing is preferred over reactive engine switching.

This reinforces the no-blind-playback invariant.

---

# 27. DRM Architecture

DRM is a first-class capability.

Example model:

```ts
type DRMCapability = {
  encrypted: boolean
  keySystem?: string
  supported: boolean
  persistentLicense: boolean
  robustness?: string[]
}
```

## 27.1 Manifest Dependent DRM Discovery

For HLS and DASH:

```text
manifest parsing
    |
    v
DRM information
    |
    v
DRM capability evaluation
```

DRM discovery cannot always happen independently of manifest inspection.

## 27.2 Unsupported DRM

If required DRM is unavailable in the current product build:

```text
Decision:
  kind = "unplayable"

reason:
  "drm-unavailable"
```

The UI must provide a meaningful message.

MPV must not be used as a DRM bypass.

## 27.3 Build Time DRM

Stock Electron and DRM capable Electron distributions are treated as build level choices.

A runtime player session does not hot-swap between Electron distributions.

---

# 28. Pre Playback Pipeline

Inspection must be parallelized where dependencies allow.

Correct architecture:

```text
Source
  |
  +-- URL type detection
        |
        +-- Manifest path
        |       |
        |       v
        |    parse manifest
        |       |
        |       v
        |    DRM discovery
        |
        +-- Direct media path
        |       |
        |       v
        |    FFprobe
        |
        +-- Cached capability matrix
                |
                v
             Decision
                |
                v
            Engine attach
                |
                v
            First frame
```

For HLS/DASH, DRM discovery is downstream of manifest parsing.

The capability matrix is already cached.

---

# 29. Performance Requirements

## 29.1 INV-PERF-1a

### Orchestration overhead

Exclude raw network transfer time.

Target:

```text
p50 <= 150 ms
p95 <= 300 ms
```

Includes:

```text
probe parse
capability lookup
decision
engine attach
```

This is an engineering gate.

Any new capability step that causes this budget to be exceeded must be optimized, cached, parallelized or removed from the pre-playback path.

## 29.2 INV-PERF-1b

### Wall clock to first frame

Target:

```text
p50 <= 1200 ms
p95 <= 2500 ms
```

This is a product health metric, not a strict engineering gate because external network latency is outside application control.

---

# 30. Probe Network Telemetry

The system must record separately:

```text
probeBytesTransferred
probeNetworkMs
probeParseMs
capabilityLookupMs
decisionMs
engineAttachMs
timeToFirstFrameMs
```

This makes it possible to distinguish application overhead from provider network latency.

---

# 31. Playback Telemetry

Every playback session must produce telemetry.

Minimum fields:

```ts
{
  sourceFingerprint,
  selectedEngine,
  selectedStrategy,

  renderSurface,
  subtitleMode,
  transitionCount,

  prepareMs,
  firstFrameMs,

  probeBytesTransferred,
  probeNetworkMs,
  probeParseMs,
  capabilityLookupMs,
  decisionMs,
  engineAttachMs,

  seekCount,
  stallCount,
  playbackSeconds,

  fatalError,

  appVersion,
  electronVersion,
  decisionPolicyVersion,
  capabilityFingerprint
}
```

## 31.1 Stable Source Identity

Telemetry should be associated with stable logical source identity where appropriate.

Signed URL changes must not create a new logical media identity.

---

# 32. Decision Policy Version

Every telemetry row must include:

```text
decisionPolicyVersion
```

This value is manually incremented whenever routing behavior changes.

This makes before and after routing comparisons possible.

Example:

```text
policy v1
  -> baseline

policy v2
  -> remux change

policy v3
  -> MPV routing change
```

Data from different policies must never be treated as one homogeneous experiment.

---

# 33. Capability Fingerprint

Every telemetry row must include:

```text
capabilityFingerprint
```

The fingerprint represents the environment that produced the capability result.

It should incorporate:

```text
Electron version
OS build
GPU
GPU driver
capability probe results
```

This allows playback outcomes to be associated with specific runtime environments.

---

# 34. Sample Size Rules

Performance metrics must be interpreted according to sample size.

Suggested operational reporting:

```text
n < 30
    raw values / max

30 <= n < 100
    p50 + raw max

100 <= n < 300
    p50 + p95 with caution

n >= 300
    p50 + p95 as an operational metric
```

These are reporting guidelines rather than formal statistical guarantees.

No architecture decision should be based solely on an unstable small-sample p95.

---

# 35. Existing Invariants

## INV-RACE-1: No Blind Playback

No stream URL is attached to a playback engine until inspection completes or a cached capability record resolves the decision.

## INV-RACE-2: Probe Gate

`PlaybackSession` remains in `preparing` while required inspection and routing work completes.

The UI must show discovery/preparation feedback instead of displaying an unexplained black player.

## INV-RACE-3: No Copy on Incomplete Probe

Do not perform blind:

```text
-c:v copy
```

when critical video metadata is unknown.

## INV-RACE-4: Capability Synchronization

Renderer capability detection is performed at application launch and synchronized with the main process.

## INV-PERF-1a: Orchestration Budget

```text
p50 <= 150 ms
p95 <= 300 ms
```

excluding network transfer.

## INV-PERF-1b: First Frame Health

```text
p50 <= 1200 ms
p95 <= 2500 ms
```

tracked as product health.

## INV-OBS-1: Telemetry Provenance

Every telemetry row must identify:

```text
appVersion
electronVersion
decisionPolicyVersion
capabilityFingerprint
```

---

# 36. PlaybackSession

`PlaybackSession` is the authoritative lifecycle state machine.

Suggested states:

```text
idle
preparing
ready
playing
paused
seeking
buffering
stopping
ended
error
```

Source lease state must be independent from playback state.

Engine state must also be represented independently.

This avoids coupling:

```text
network failure
media failure
engine failure
UI state
```

into one state machine.

---

# 37. Failure Classification

Playback failures must produce structured reasons.

Examples:

```text
inspection-failed
inspection-incomplete
unsupported-container
unsupported-codec
browser-demuxer-unsupported
browser-decoder-unsupported
browser-decoder-not-smooth
drm-unavailable
license-failure
source-expired
source-refresh-failed
provider-forbidden
transform-failed
mpv-start-failed
mpv-crashed
subtitle-unsupported
audio-policy-conflict
seek-failed
```

These reason codes should be logged and surfaced selectively to users.

---

# 38. Provider URL Refresh Lifecycle

Example:

```text
ACTIVE
  |
  +--> CONNECTION_FAILURE
  |        |
  |        +--> RECONNECT
  |
  +--> LEASE_EXPIRED
           |
           +--> REFRESH_SOURCE
                    |
              +-----+-----+
              |           |
           SUCCESS      FAILURE
              |           |
              v           v
           ACTIVE      RETRY / ERROR
```

Refresh budget must prevent infinite resolution loops.

---

# 39. Current Playback Strategy Matrix

| Strategy | Primary Use |
|---|---|
| DIRECT | Browser-native compatible media |
| HLS_NATIVE | HLS through hls.js or native supported path |
| DASH_NATIVE | DASH through Shaka |
| REMUX_CONTAINER | Browser-compatible media in incompatible container |
| AUDIO_TRANSCODE | Browser-compatible video with incompatible audio and suitable user audio policy |
| VIDEO_TRANSCODE | Browser fallback where native playback is unavailable or unacceptable |
| FULL_TRANSCODE | Final compatibility fallback |
| MPV_NATIVE | Native playback for media Chromium cannot appropriately handle |

The actual strategy must be selected from capability and preference data.

---

# 40. Tier 1 Implementation Plan

Tier 1 is intended to fix current real failures without changing routing policy.

## 40.1 SourceLease

Implement:

- Stable `sourceId`
- `expiresAt`
- refresh method
- refresh budget
- refresh state
- reconnect state
- source re-resolution
- structured failure reasons

## 40.2 Container Typed Inspection

Implement:

- MP4/MOV head probe
- MP4/MOV tail probe when needed
- TS probe with appropriate `probesize`
- TS probe with appropriate `analyzeduration`
- HLS manifest inspection
- DASH manifest inspection
- container-specific failure telemetry

## 40.3 Playback Telemetry

Write one telemetry record for every session, including failures.

Record baseline routing behavior before changing routing logic.

## 40.4 Transform Seeking

Implement restart-on-seek for piped FFmpeg transforms.

Use input seeking:

```text
-ss <target> -i <input>
```

Measure actual behavior.

## 40.5 Performance Telemetry

Implement:

```text
INV-PERF-1a
INV-PERF-1b
```

with network and orchestration components separated.

---

# 41. Tier 1 Definition of Done

Tier 1 is complete when all of the following are true:

- `SourceLease` maintains stable `sourceId` across re-resolution.
- `SourceLease` supports expiration and bounded refresh.
- Reconnect and refresh paths are separate.
- A two-hour playback using a 15-minute-token source can complete without failing due to URL expiration.
- Container-specific inspection strategies exist.
- Probe failure rate is recorded by container.
- Every playback session generates telemetry, including failures.
- `decisionPolicyVersion` is present in every telemetry row.
- `capabilityFingerprint` is present in every telemetry row.
- Seek on piped remux has an actual measured p50.
- Orchestration overhead is measured.
- Wall-clock to first frame is measured.

No routing changes are required for Tier 1 completion.

---

# 42. Tier 2

Tier 2 begins only after sufficient real playback telemetry exists.

## 42.1 Capability Matrix

Implement:

```text
decodingInfo(file)
decodingInfo(media-source)
MediaSource.isTypeSupported()
container compatibility table
live HEVC sanity probe
DRM capability
```

All expensive capability work must be cached.

## 42.2 Capability and Preference Separation

Refactor:

```text
capabilities()
selectEngine()
```

into separate pure functions.

## 42.3 Subtitle Capability

Implement:

```text
text
ASS/SSA
bitmap
dom-overlay
native
disable
```

## 42.4 Audio Policy

Implement:

```text
Stereo
Surround
Passthrough
```

Surface the setting prominently for users whose environment supports more than two channels.

## 42.5 DRM Terminal State

Implement:

```text
unplayable: drm-unavailable
```

and structured DRM failure reporting.

## 42.6 Pre Playback Fan Out

Implement dependency-aware parallel processing.

Manifest parsing and direct media probing can run concurrently when the source type permits.

DRM discovery follows manifest parsing.

Cached capability lookup runs independently.

---

# 43. Tier 3: Future Native Rendering

Tier 3 is not currently scheduled.

Investigate libmpv only when:

1. MPV watch-time share demonstrates meaningful user impact.
2. The rendering architecture is defined.
3. Texture integration is proven.
4. HDR and 10-bit behavior are validated.
5. Color space handling is validated.
6. PiP behavior is validated.
7. Fullscreen behavior is validated.
8. React overlays work correctly.
9. Failure isolation remains acceptable.

The goal is not merely embedding MPV.

The goal is native decoding with application controlled compositing.

---

# 44. Future libmpv Architecture

Potential future architecture:

```text
React UI
   |
Electron Renderer
   |
Native Bridge
   |
libmpv
   |
GPU Decode / FFmpeg
   |
Render API
   |
Application Texture
```

The current MPV process architecture remains the safer production architecture until this rendering model is proven.

---

# 45. Current Architecture Decision

CloudStream 3 Desktop will continue with:

```text
Electron
  +
React
  +
MediaProxy
  +
FFprobe
  +
Shaka
  +
hls.js
  +
FFmpeg
  +
MPV process
```

No immediate replacement of the existing multi-engine architecture is required.

The architecture is considered valid.

The next improvements are primarily:

```text
network resilience
inspection reliability
observability
performance measurement
capability accuracy
routing policy refinement
```

---

# 46. What Must Not Happen

The implementation must avoid:

### One Engine for Everything

Do not force all content into Chromium.

Do not force all content into MPV.

### Blind FFmpeg Transcoding

Do not transcode media merely because a format looks unfamiliar if MPV can natively handle it.

### Unnecessary Remux Removal

Do not remove remux simply because MPV exists.

A cheap remux may preserve DOM composition and provide an excellent user experience.

### Blind Source Refresh

Do not repeatedly re-resolve providers after arbitrary 403 responses.

### Per Source Capability Detection

Do not repeatedly calculate launch-time browser capabilities.

### Serial Startup Pipeline

Do not turn every new capability check into another sequential startup step.

### Premature libmpv

Do not begin embedded libmpv development before the rendering requirements are understood.

### OCR Playback Pipeline

Do not introduce OCR as the normal bitmap subtitle compatibility mechanism.

---

# 47. Success Metrics

The system should ultimately be evaluated using:

## Reliability

```text
playback success rate
fatal playback failure rate
source refresh success rate
DRM failure rate
engine crash rate
```

## Performance

```text
orchestration p50
orchestration p95
first frame p50
first frame p95
stall rate
startup failure rate
```

## Media Quality

```text
HDR preservation
audio channel preservation
subtitle compatibility
seek success
track switching success
```

## Product Experience

```text
DOM playback percentage
MPV watch-time percentage
engine transition count
PiP success
fullscreen success
```

---

# 48. Decision Telemetry Questions

After Tier 1, the telemetry must answer:

1. How often does remux succeed?
2. How expensive is remux startup?
3. What is the actual p50 seek restart time?
4. How often does video transcoding occur?
5. How often would MPV avoid video transcoding?
6. How much watch-time is served by MPV?
7. Which media types cause MPV routing?
8. How often does MPV create UI or rendering limitations?
9. Which subtitle formats cause failures?
10. Which audio policies cause native routing?
11. How often do signed URLs expire during playback?
12. Which providers require repeated source re-resolution?
13. How much of the failure rate is caused by CDN behavior versus engine compatibility?
14. Which environments have different codec capability behavior?

These measurements determine Tier 2 routing changes.

---

# 49. Final Architectural Position

CloudStream 3 Desktop is not trying to build another media player.

It is building a media orchestration system around proven media engines.

The responsibilities are:

```text
MediaProxy
    = network normalization and source continuity

SourceLease
    = source identity and URL lifecycle

Inspectors
    = understand what the source actually contains

Capability Model
    = understand what this machine can actually play

DecisionEngine
    = choose the best playback path

HTML5 / hls.js / Shaka
    = web playback and DOM composition

FFmpeg
    = media transformation

MPV
    = native media playback

PlayerSession
    = playback lifecycle and state

React UI
    = user experience
```

The system should preserve this separation.

The preferred path is:

```text
Source
  -> inspect
  -> determine capabilities
  -> choose web playback when sufficient
  -> remux when that is the cheapest useful bridge
  -> use native MPV when browser playback would compromise compatibility or media fidelity
  -> transcode only when required
```

The future path is:

```text
MPV process
    -> proven native fallback

libmpv render API
    -> future unified native rendering
```

The final engineering rule is:

> Do not simplify the architecture by removing engines. Simplify it by giving each engine one clear responsibility and making the routing decision deterministic, observable, measurable and user-experience driven.

# 50. Immediate Implementation Sequence

### Tier 1

```text
1. SourceLease
2. Provider URL re-resolution
3. Container typed inspection
4. Session telemetry
5. Remux restart-on-seek
6. Performance instrumentation
```

### Tier 2

```text
7. Capability matrix
8. decodingInfo
9. MediaSource.isTypeSupported
10. Container compatibility table
11. Subtitle capability
12. Audio policy
13. DRM capability
14. Capability/preference separation
15. Parallel dependency-aware startup
```

### Tier 3

```text
16. Analyze MPV watch-time share
17. Define renderTarget requirements
18. Validate libmpv texture rendering
19. Validate HDR/10-bit/colorspace/PiP/fullscreen
20. Decide whether embedded libmpv justifies the engineering cost
```

No additional architecture redesign is required before Tier 1 implementation and telemetry collection.