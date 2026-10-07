# Player Architecture

Renderer: `src/components/VideoPlayer.tsx` (5,339 lines) + `src/components/player/*`. Main: `playbackSession.ts`,
`media/playbackEngine.ts`, `media/mpvEngine.ts`, `mediaProxy.ts`, `mediaTranscoder.ts`, `externalPlayer*.ts`.
The end-to-end source→pixels flow is in [streaming.md](streaming.md); this file covers the player itself.

## 1. Mount points and states
`App.tsx` renders `VideoPlayer` from three entry paths: a live `PlaybackSession` (after Play), a source picked on the
detail page, and local-file/torrent/history opens. Display modes: **full**, **mini** (in-app window), and the
floating modes `mini | floating | pip | background` (`useFloatingPlayer.ts`, `useMiniFrame.ts`, `MiniPlayerBar.tsx`).
**The `<video>` element is never remounted** across modes (remounting ends the stream). The full chrome is hidden with CSS
and mini has its own control set; keyboard shortcuts are disarmed in mini/hidden.

## 2. Transport — who holds the stream
`transport` is one derived answer: element (`<video>` + hls.js/Shaka), native engine (`NativeEngineStage` + mpv), or
external (VLC/mpv/others). Volume, mute and speed are applied to **all** engines so a handoff does not reset them.
* Chromium never receives a `NATIVE_MPV` URL (it would fail and trigger failover over a source that plays fine).
* mpv: `MpvEngine` spawns `mpv.com`, JSON IPC over a named pipe; flags include `--no-config`, `--idle=yes`,
  `--osc=yes`, `--osd-level=1`, `--input-default-bindings=no` (+ enumerated `NATIVE_KEY_BINDINGS`),
  `--input-vo-keyboard=yes`, `--ytdl=no`, `--load-scripts=no`, `--hwdec=auto-safe`, `--cache=yes`,
  `--demuxer-max-bytes=256MiB`, `--demuxer-readahead-secs=30`, `--sub-auto=no`, `--keep-open=yes`, `--volume-max`,
  `--gpu-context=d3d11` (Windows). `open/stop/shutdown` are serialised on one queue; snapshots are coalesced (200 ms, `mpvEmitPolicy.ts`).
  An explicit stop reports `idle`, not `ended` (so the next episode does not auto-advance).
* VLC is driven through its HTTP interface on a loopback port with a per-session password; MPC-HC/PotPlayer etc. are launch-only.
  Capability (`full | none`) is declared per player and can downgrade at runtime.

## 3. Controls (what is on screen)
Top area (`player__top`): Back, titles (title + original title + episode badge/count), provenance badge,
Incognito badge, swarm stats (peers, download speed) and top-right actions, including Minimise. Centre: click surface
and overlays (`SourceResolveOverlay`, `PlaybackErrorPanel`, `UpNextCard`, audio/strategy notes, external-player
banner, toasts — two flow columns `player__messages--top/--bottom`, never independently positioned). Bottom bar
(`player__controls`): seek track with played/buffer/torrent segments, hover preview and handle, buffer-ahead indicator,
elapsed/remaining toggle (`timeDisplay.ts`, `useTimelinePreview.ts`), previous/next episode, play/pause, mute + volume,
Episodes (E), Sources, Subtitles search, Download (with a downloads panel), copy menu, fullscreen. The playback-speed
control is shown only when the stored setting is on (default off); speed keys always work. Panels: `EpisodePanel`,
`SourcePanel`, `SubtitlePanel`, `PlayerDownloadPanel`, `PlayerCopyMenu`.

Keyboard (from `PlayerShortcutsPanel.tsx`): `Space`/`K` play-pause · `F` fullscreen · `Esc` exit fullscreen/close panel ·
`M` mute · `↑/↓` volume ±5% · `→`/`L` +10 s · `←`/`J` −10 s · `0–9` seek to 0–90% · `Home`/`End` · `C` subtitles on/off · `V` cycle
tracks · `S` subtitle & sync drawer · `>`/`]` faster · `<`/`[` slower · `N`/`P` next/previous episode · `E` episodes.
`Esc` is consumed in capture phase and only when it closed something.

## 4. Audio and subtitles
* Audio track choice persists as a **language**, never an index (`selectAudioTrack`, `normalizeLanguageCode`). A track
  switch re-derives the plan (`planForAudioTrack`).
* Subtitles (`subtitleService.ts`, `subtitles/convert.ts`, `subtitleLibrary.ts`): keyless OpenSubtitles v3 addon by IMDb id;
  SubRip/ASS/SSA → WebVTT (`<track>` rejects `.srt`); charset by UTF-8 check then chardet; saved `.vtt` reused per work.
  Auto-load order: stream track → saved file → online search, never blocking playback; preferred language English by default, explicit Off respected.
  Timing offset moves cues (element) or sets `sub-delay` (mpv). Appearance via one record rendered as `::cue` vars or mpv properties (`subtitleStyle.ts`).
* Embedded text subtitles are extracted by the transcoder.

## 5. Volume contract
Volume is a fraction for `HTMLMediaElement`, a percent for mpv/VLC. mpv is launched `--volume-max=100`, VLC's level is capped, and
`clampVolume` guards the element (`IndexSizeError` outside [0,1] used to unmount the player). Echo suppression uses a 700 ms window
**and** a value record (`engineAudio`).

## 6. Failure and recovery
`playbackRecovery.ts` decides what a transport failure costs next; `PlaybackErrorPanel` is the single failure surface
(first action: Download, if the source is alive; then other source, external players, "Find more sources"). Source
failover goes through the session (`skipCurrentSource`); the `media:prepare` effect keys on a serialised
`activeSourceKey` (never on object identity — buffer stalls produce new objects and would restart playback).
`recordBufferHeartbeat/recordBufferStall` feed the session. `ExternalPlayerFallback` offers detected players only when the source is alive.

## 7. Diagnostics
`media:getPlaybackDiagnostics(sessionId?)` (per-attempt telemetry from `PlaybackEngine`), developer-mode overlays
(`capability.explanation`, swarm stats, attempt list), `ProviderInspector` (F12). See
[../debugging/troubleshooting.md](../debugging/troubleshooting.md).

## 8. Floating modes
| Mode | Mechanism | Works when |
|---|---|---|
| mini | CSS geometry on the same element | this app is the front window |
| pip | native `requestPictureInPicture` | element is playing (not mpv/VLC) |
| floating | app window always-on-top (`window:setAlwaysOnTop`) | always |
| background | policy `continue | audio-only | pause` | audio-only hides the picture with `visibility`, and on mpv sets `vid=no` |
The Media Session record is set so PiP/media keys work; the pin un-applies on unmount.
