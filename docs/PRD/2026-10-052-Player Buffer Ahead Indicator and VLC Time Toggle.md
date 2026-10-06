# PRD: Native Player Buffer Ahead Indicator and VLC-Style Timeline Time Toggle

## 1. Executive Summary & Purpose

Modern enterprise-grade media players (such as **mpv**, **VLC Media Player**, and **MPC-HC**) provide users with two fundamental stream diagnostics and timeline interactions that dramatically improve streaming UX:

1. **Real-Time Buffer Ahead Indicator (Banked Cache Readout):**
   - When streaming media (direct HTTP, HLS, or WebTorrent), users frequently fast-forward or jump forward along the seekbar. Without buffer diagnostics, users do not know how far ahead media has already been downloaded into memory or disk cache, leading to unexpected playback pauses and buffering spinners.
   - Native mpv and VLC communicate this by rendering the banked buffer duration (e.g. `+2m 30s buffered` or `+45s cached`), giving the viewer complete confidence regarding how far they can seek ahead instantly without stuttering.

2. **Timeline Time Display Toggle (VLC-Style Elapsed vs. Remaining Time):**
   - Standard web players lock the timeline timecode to a rigid `Current / Total` display (e.g. `12:45 / 1:45:00`).
   - VLC pioneered the ability to click directly on the time readout to toggle between:
     - **Elapsed / Total Duration:** `12:45 / 1:45:00`
     - **Elapsed / Remaining Time:** `12:45 / -1:32:15`
     - **Focused Remaining Time:** `-1:32:15`
   - This toggle interaction must be persistent across episode transitions and player sessions.

This document specifies the architectural requirements, dual-engine support (Native mpv and HTML5 `<video>`), user interaction models, preference persistence, and exact file reference mapping for these two features in CloudStream 3 Desktop.

---

## 2. Feature 1: Real-Time Buffer Ahead Indicator

### 2.1 Problem & Use Case
Currently, CS3 renders a subtle buffer bar on the seekbar track. However, on high-resolution displays or when the control bar is active, the viewer cannot ascertain the exact quantity of cached media. A 5% sliver on a 3-hour movie represents 9 minutes of buffer, while a 5% sliver on a 20-minute episode represents only 1 minute.

A precise textual readout provides clear situational awareness:
- When a stream is struggling or network throughput fluctuates, seeing `+4s buffered` informs the user to pause briefly.
- When high-speed buffering occurs, seeing `+4m 20s buffered` assures the user they can jump through intros or recaps without lag.

### 2.2 Dual-Engine Extraction Architecture

```text
┌────────────────────────────────────────────────────────────────────────┐
│                          MEDIA PLAYBACK ENGINES                        │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
           ┌────────────────────────┴────────────────────────┐
           ▼                                                 ▼
┌──────────────────────────────────────┐  ┌──────────────────────────────┐
│          Native mpv Engine           │  │      HTML5 <video> Engine    │
│      (electron/media/mpvEngine.ts)   │  │  (components/VideoPlayer.tsx)│
├──────────────────────────────────────┤  ├──────────────────────────────┤
│ Read property via IPC socket:        │  │ Inspect media element:       │
│ • "demuxer-cache-time" (seconds)     │  │ • video.buffered (TimeRanges)│
│ • "time-pos" (current position)      │  │ • video.currentTime         │
│ • "demuxer-cache-state"              │  │ • calculate end - currentTime│
└──────────────────┬───────────────────┘  └──────────────┬───────────────┘
                   │                                     │
                   └──────────────────┬──────────────────┘
                                      ▼
┌────────────────────────────────────────────────────────────────────────┐
│                   UNIFIED BUFFER DURATION CALCULATION                  │
│                                                                        │
│  bufferedAheadSeconds = max(0, cachedEndTimestamp - currentPosition)   │
└─────────────────────────────────────┬──────────────────────────────────┘
                                      ▼
┌────────────────────────────────────────────────────────────────────────┐
│                   ADAPTIVE TIME FORMATTER UTILITY                      │
│                                                                        │
│ • If bufferedAhead < 60s:          "+45s"                              │
│ • If 60s <= bufferedAhead < 3600s:  "+2m 15s"                          │
│ • If bufferedAhead >= 3600s:       "+1h 10m"                           │
└─────────────────────────────────────┬──────────────────────────────────┘
                                      ▼
┌────────────────────────────────────────────────────────────────────────┐
│                             UI READOUTS                                │
│                                                                        │
│ 1. Player Control Bar:   Adjacent to .player__time                     │
│ 2. Seekbar Hover Pill:   "01:14:20 (+2m 15s buffered)"                 │
│ 3. Mini-Player Toolbar:  Compact badge in .player-mini__time           │
└────────────────────────────────────────────────────────────────────────┘
```

### 2.3 mpv Native Engine Property Observation
1. **Property Monitoring:** The native mpv process maintains a continuous demuxer cache. mpv exposes the `demuxer-cache-time` property (duration in seconds of packets buffered ahead in the demuxer cache).
2. **Snapshot Assembly:** In `electron/media/mpvEngine.ts`, property changes are collected via mpv IPC event subscriptions and packed into `MpvSnapshot`.
3. **IPC Broadcast:** The snapshot emits `bufferedSeconds` to the renderer via the existing `playback:update` push channel.

### 2.4 HTML5 `<video>` Engine Buffer Calculation
1. **TimeRanges Lookup:** In `src/components/VideoPlayer.tsx`, when using the Chromium `<video>` engine, the component inspects `video.buffered`.
2. **Current Range Determination:** Iterates across `video.buffered` to find the range where `start <= currentTime && end >= currentTime`.
3. **Delta Derivation:** `bufferedAhead = Math.max(0, range.end - currentTime)`.

### 2.5 Adaptive Formatting Rules
The formatting utility converts raw seconds into a human-friendly compact string:
- **Zero / Exhausted:** `+0s` (or subdued when buffering stalled).
- **Under 1 Minute:** `+Xs` (e.g. `+14s`, `+48s`).
- **Between 1 Minute and 1 Hour:** `+Xm Ys` (e.g. `+1m 30s`, `+8m 12s`).
- **Over 1 Hour:** `+Xh Ym` (e.g. `+1h 14m`).

### 2.6 Placement in Player UI
1. **Main Player Toolbar:** Positioned alongside the timecode container:
   ```text
   [ ▶ ] [ 12:45 / 1:45:00 ] [ +2m 30s buffered ]  ══════════════ [ ⚙ ] [ ⛶ ]
   ```
2. **Seekbar Hover Tooltip:** When hovering along the timeline, the tooltip displays the hovered timestamp along with the buffer delta at that position:
   ```text
   ┌────────────────────────────────┐
   │ 00:15:10  (+2m 30s cached)     │
   └───────────────▼────────────────┘
   ```
3. **Mini-Player:** Displays a compact indicator badge when expanded.

---

## 3. Feature 2: Timeline Time Display Toggle (VLC-Style)

### 3.1 Problem & Motivation
Viewers have diverse preferences regarding media time perception:
- Some prefer knowing how much of the movie has elapsed and the total runtime (`Elapsed / Total`).
- Many viewers prefer knowing exactly how much time remains until the movie or episode finishes (`Remaining Time`), which is standard behavior in VLC, MPC-HC, Apple TV, and Prime Video.

CS3 currently hardcodes `formatTime(currentTime) / formatTime(duration)` without any way for the user to switch to remaining time.

### 3.2 Toggle Modes & States

The player timecode component must support an interactive click cycle across three states:

```text
State 1: ELAPSED_TOTAL (Default)
Readout: 12:45 / 1:45:00
Meaning: 12 minutes 45 seconds played out of 1 hour 45 minutes total.

                  [ User clicks on .player__time ]
                                 ↓

State 2: ELAPSED_REMAINING
Readout: 12:45 / -1:32:15
Meaning: 12 minutes 45 seconds played, with 1 hour 32 minutes 15 seconds remaining.

                  [ User clicks on .player__time ]
                                 ↓

State 3: COMPACT_REMAINING
Readout: -1:32:15
Meaning: Focused remaining countdown display.

                  [ User clicks on .player__time ]
                                 ↓
                  (Cycles back to State 1)
```

### 3.3 Visual Affordance & Accessibility
- **Interactive Cursor:** `.player__time` must render `cursor: pointer` with subtle hover styling (light background pill or text opacity boost) to indicate that it is an interactive control.
- **Tooltip Description:** A native or custom tooltip must display:
  - When in Elapsed/Total: `"Click to switch to remaining time"`
  - When in Elapsed/Remaining: `"Click to switch to compact remaining time"`
  - When in Compact Remaining: `"Click to switch to elapsed/total time"`
- **Keyboard Shortcut:** Toggling should also be triggerable via the `t` hotkey when the player has focus.

### 3.4 Preference Persistence
- **Storage:** Persisted in user preferences (`player_time_display_mode`: `'elapsed_total' | 'elapsed_remaining' | 'compact_remaining'`).
- **Scope:**
  - Persists across full application restarts.
  - Applies universally when auto-playing next episodes in a series.
  - Synchronizes between the main video stage (`.player__time`) and the floating/mini-player (`.player-mini__time`).

---

## 4. File Reference Directory & Module Responsibilities

The following directory maps the buffer ahead indicator and timeline toggle requirements to their exact files and components in the codebase. In compliance with project guidelines, no code snippets or implementation logic are included here; this directory provides explicit orientation for subsequent implementation.

| Component / Requirement | File Path | Line Range of Interest | Responsibility / Architectural Role |
|---|---|---|---|
| **Player Timeline & Time Readouts** | `cs3_windows/src/components/VideoPlayer.tsx` | `L4645–L4660`, `L4520–L4560` | Primary timecode container (`player__time`), seekbar buffer track, click toggle event handlers, and buffer-ahead readout rendering. |
| **Mini-Player Time Display** | `cs3_windows/src/components/VideoPlayer.tsx` | `L3730–L3745` | Floating and mini-player timecode container (`player-mini__time`) and synchronized time toggle handling. |
| **Time & Duration Formatting Utilities** | `cs3_windows/src/utils/format.ts` | `L1–L80` | Formatting functions for timecodes (`formatTimecode`), remaining time format (`-hh:mm:ss`), and adaptive buffer string (`+2m 30s`). |
| **Player Toolbar & Seekbar Styles** | `cs3_windows/src/sources.css` | `L2810–L2840`, `L4500–L4550` | Styling for `.player__time`, interactive hover states, tooltip feedback, and buffer ahead badge typography. |
| **Native mpv Cache & Buffer Observation** | `cs3_windows/electron/media/mpvEngine.ts` | `L70–L92`, `L1005–L1030` | mpv property observation (`demuxer-cache-time`, `time-pos`), snapshot assembly, and buffer duration reporting over IPC. |
| **Native Playback Snapshot Types** | `cs3_windows/src/types/mpv.ts` | `L1–L60` | Type definitions for `MpvSnapshot` including `positionSeconds`, `durationSeconds`, and `bufferedSeconds`. |
| **Player Preferences Store** | `cs3_windows/src/types/player.ts` | `L1–L80` | Configuration schema for persisting user time display mode (`elapsed_total` vs `elapsed_remaining`). |
| **Native Engine React Stage** | `cs3_windows/src/components/player/NativeEngineStage.tsx` | `L35–L65`, `L90–L120` | Native playback state consumption, progress synchronization, and bridge to player control bar. |

---

## 5. Acceptance Criteria

- [ ] When playing any stream in either Native mpv or HTML5 `<video>`, the banked cache duration is displayed in real-time (e.g. `+2m 30s buffered`).
- [ ] Buffer ahead duration automatically formats adaptively: seconds (`+45s`), minutes (`+2m 15s`), and hours (`+1h 10m`).
- [ ] Hovering over the seekbar displays both the hovered timestamp and the cached duration at that position.
- [ ] Clicking the timecode container (`.player__time`) toggles through Elapsed/Total (`12:45 / 1:45:00`), Elapsed/Remaining (`12:45 / -1:32:15`), and Compact Remaining (`-1:32:15`).
- [ ] The remaining time calculation correctly applies the negative sign (`-`) and decrements towards zero.
- [ ] Time display mode preference is saved locally and preserved when switching episodes, movies, or reopening the app.
- [ ] Mini-player time display (`.player-mini__time`) updates in lockstep with the main player timecode.
- [ ] Hovering over `.player__time` displays a tooltip explaining the click-to-toggle feature.
- [ ] No regressions in seeking, pausing, or existing progress bar drag interactions.
