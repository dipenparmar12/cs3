# PRD Update: Audio/Video Synchronization and Robust Subtitle Management

## 1. Overview

Review the following project documents before making any implementation changes:

```text
D:\projects\cs3\docs\2026-10-050-errors_need_to_resolve.md
D:\projects\cs3\docs\2026-10-051-App-updates-prd-info.md
D:\projects\cs3\docs\2026-10-052-session-handoff.md
```

These documents should be treated as the current project context for the issues described below.

The primary objective of this update is to improve subtitle reliability across both **streaming playback and downloaded media**, while also verifying that the existing audio/video synchronization is functioning correctly.

An important principle for this work is:

> **Do not modify working playback behavior without first proving that a problem actually exists.**

The current architecture already contains a media inspection layer, subtitle ingestion/conversion, WebVTT handling, native mpv subtitle rendering, and cached media inspection. Pasted markdown(8) Pasted markdown(8)

Therefore, the first step should be diagnosis and validation rather than immediately replacing or rewriting existing playback logic.

---

# 2. Audio and Video Synchronization

## 2.1 Requirement

Whenever any media is played, audio and video must remain correctly synchronized throughout playback.

This applies to:

- Movies
- TV shows
- Episodes
- Trailers
- Live content
- HLS streams
- DASH streams
- Direct video sources
- Torrent playback
- MP4
- MKV
- WebM
- Other supported media formats
- Internal player
- Native mpv playback
- Transcoded playback
- Remuxed playback

---

# 3. Diagnose Before Changing Playback

We currently do not want to assume that the player has an audio/video synchronization problem.

The first task must be:

```text
Inspect
  ↓
Reproduce
  ↓
Measure
  ↓
Identify root cause
  ↓
Determine whether a real bug exists
  ↓
Only then modify implementation
```

If playback is already correctly synchronized across the supported playback paths, **do not introduce unnecessary changes**.

This is especially important because the current architecture already has several playback strategies, including direct playback, HLS, DASH, remuxing, transcoding, mpv, and external player handoff. Pasted markdown(8)

---

# 4. Synchronization Test Matrix

Test audio/video synchronization across the actual playback pipeline.

At minimum, verify:

| Scenario | Required validation |
|---|---|
| Direct MP4 | Audio/video synchronization |
| MKV | Audio/video synchronization |
| WebM | Audio/video synchronization |
| HLS | Audio/video synchronization |
| DASH | Audio/video synchronization |
| Remuxed media | Synchronization after remux |
| Transcoded media | Synchronization after transcode |
| mpv | Native synchronization |
| Seek forward | Sync maintained |
| Seek backward | Sync maintained |
| Pause/resume | Sync maintained |
| Source refresh | Sync maintained |
| Buffering/reconnect | Sync maintained |
| Quality/source switch | Sync maintained where supported |
| Trailer playback | Sync maintained |
| Downloaded file playback | Sync maintained |

---

# 5. Synchronization After Seeking

Seeking is an important part of this investigation.

Verify that:

```text
Current playback
      ↓
Seek +10 seconds
      ↓
Audio and video move together
```

and:

```text
Current playback
      ↓
Seek -10 seconds
      ↓
Audio and video move together
```

Repeated and rapid seeking must also be tested.

A stale asynchronous seek operation must not cause:

- Audio to remain at the old position
- Video to move to a different position
- Audio to jump
- Video to restart
- Gradual audio/video drift

---

# 6. Synchronization During Recovery

The existing architecture includes source re-evaluation, token refresh, mirror failover, and playback recovery. Pasted markdown(8)

Verify that these operations do not introduce synchronization problems.

For example:

```text
Playing
  ↓
Source expires
  ↓
New source resolved
  ↓
Playback resumes
```

The new playback position must remain synchronized.

Where possible, playback should resume at the appropriate position rather than restarting unnecessarily.

---

# 7. Transcoding and Remuxing

The current architecture can select different playback strategies depending on media compatibility. Pasted markdown(8)

If synchronization problems occur only when using:

- Remuxing
- Audio transcoding
- Video transcoding
- Full transcoding

the investigation should identify the exact layer responsible.

Check:

- Input timestamps
- Presentation timestamps
- Decode timestamps
- Audio start time
- Video start time
- Duration differences
- Timestamp discontinuities
- FFmpeg parameters
- Stream mapping
- Audio delay
- Video delay
- Transcoding buffering
- Fragmented MP4 output
- Live stream behavior

Do not change the direct-playback path merely because a transcoding path has a synchronization problem.

---

# 8. mpv Synchronization

The native mpv integration should also be tested independently.

The existing design uses mpv's native playback properties such as `time-pos`, `duration`, `pause`, `demuxer-cache-time`, and track information, with state pushed through IPC. Pasted markdown(8)

Verify that:

- The UI time position matches mpv.
- Seeking uses mpv's actual playback clock.
- Audio and video remain synchronized.
- Pause/resume does not introduce drift.
- Source switching does not corrupt timing.
- Subtitle timing follows the actual playback clock.

---

# 9. Subtitle System Audit

The subtitle system must be reviewed end-to-end before implementing additional functionality.

The existing architecture already supports:

- External subtitles
- Embedded subtitles
- SRT parsing
- Character-set detection
- SRT to WebVTT conversion
- ASS subtitle handling
- Bitmap subtitle routing to mpv
- WebVTT attachment to the player
- Native libass rendering through mpv Pasted markdown(8)

The objective is therefore to identify what is currently working, what is broken, and what is missing.

---

# 10. Subtitle Pipeline

The complete subtitle flow should be reviewed as:

```text
Subtitle Source
      ↓
Subtitle Discovery
      ↓
Subtitle Download
      ↓
Subtitle Validation
      ↓
Character Set Detection
      ↓
Subtitle Parsing
      ↓
SRT / ASS / Other Format Handling
      ↓
WebVTT Conversion where required
      ↓
Player Attachment
      ↓
Subtitle Rendering
```

Every stage should be tested independently.

---

# 11. Subtitle Validation

A major requirement is to prevent unrelated or incorrect subtitle files from being attached to media.

A subtitle should not be accepted simply because:

- The filename looks similar
- The provider returned it
- The language matches
- The subtitle download succeeded

The system should validate whether the subtitle actually belongs to the media being played or downloaded.

---

# 12. Subtitle-to-Media Matching

Subtitle validation should consider multiple signals where available:

- Media title
- Original title
- Normalized title
- Year
- Season
- Episode
- Episode title
- Language
- Provider metadata
- Subtitle metadata
- Release information
- Source filename
- Subtitle filename
- Subtitle duration
- Subtitle cue timestamps
- Subtitle provider identifiers

For series content, season and episode matching should be especially important.

Example:

```text
Media:
Example Show
Season 2
Episode 5

Subtitle:
Example Show
Season 2
Episode 5
```

should have a significantly higher confidence than:

```text
Example Show
Season 1
Episode 5
```

---

# 13. Subtitle Duration Validation

Subtitle duration should be used as an important validation signal.

For example:

```text
Media duration:      1h 00m
Subtitle duration:   1h 02m
```

may be acceptable depending on the source and timing.

However:

```text
Media duration:      1h 00m
Subtitle duration:   2h 05m
```

is a strong indication that the subtitle may belong to another release or another piece of content.

The system should therefore define a reasonable tolerance rather than requiring exact duration equality.

---

# 14. Duration Difference Must Not Be the Only Signal

Subtitle and media durations can legitimately differ because of:

- Different releases
- Intro/outro differences
- Recaps
- Credits
- Extended editions
- Censored/uncensored versions
- Different frame rates
- Timing offsets
- Provider-specific cuts
- Slight metadata inaccuracies

Therefore:

```text
Duration mismatch
```

should contribute to a confidence score rather than automatically determining validity.

A large mismatch should, however, be treated as a strong reason to reject the subtitle.

---

# 15. Subtitle Confidence Score

A robust validation mechanism should calculate a confidence score using available information.

Conceptually:

```text
Title match             +
Year match              +
Season match            +
Episode match           +
Language match          +
Duration compatibility  +
Provider metadata       +
Filename similarity
```

Result:

```text
HIGH CONFIDENCE
MEDIUM CONFIDENCE
LOW CONFIDENCE
INVALID
```

Only sufficiently reliable subtitles should be automatically selected.

---

# 16. Invalid Subtitle Handling

If a subtitle fails validation:

```text
Subtitle downloaded
      ↓
Validation
      ↓
Invalid
      ↓
Do not attach to player
      ↓
Do not keep as the default downloaded subtitle
```

The application should not silently present an obviously unrelated subtitle.

Where appropriate, the user can still manually select a subtitle, but automatic subtitle selection should prioritize validated results.

---

# 17. Subtitle Validation for Downloads

When the user downloads media, the application should not simply download the video and blindly attach the first subtitle returned by the provider.

The flow should be:

```text
Download media
      ↓
Download completes or reaches usable state
      ↓
Resolve subtitles
      ↓
Validate subtitle
      ↓
Accept only valid subtitle
      ↓
Save subtitle alongside media
```

The downloaded subtitle should be associated with the downloaded media.

---

# 18. Downloaded Subtitle Output

For a downloaded media file such as:

```text
Movie Name.mkv
```

the subtitle should be stored in an appropriate related form, such as:

```text
Movie Name.en.srt
```

or another format supported by the application's download architecture.

The exact filename convention should be standardized so that:

- Media players can discover it
- The application can identify the relationship
- Multiple languages can coexist
- Duplicate downloads are avoided

---

# 19. Multiple Subtitle Languages

The system must not restrict downloaded subtitles to English.

The user should eventually be able to select:

```text
English
Hindi
Gujarati
Spanish
French
Japanese
German
...
```

and download the selected validated subtitle.

The current default behavior of showing English first can remain.

The requirement is to expand beyond English rather than remove the existing default.

---

# 20. Subtitle Settings Audit

We also need to investigate the current subtitle settings and configuration.

The existing project context indicates that subtitle-related settings already exist in the Android-derived configuration model, including subtitle settings and subtitle language filtering. Pasted markdown (3)

The desktop implementation should be audited to determine:

- Which settings currently exist
- Which settings are actually connected to the player
- Which settings are persisted
- Which settings are ignored
- Which settings are partially implemented
- Whether customization is being applied correctly

---

# 21. Subtitle Customization Regression

There is a concern that a previous player subtitle customization change may have caused subtitles to stop displaying correctly.

This must be investigated carefully.

Do not assume whether the issue is caused by:

- Application code
- Player configuration
- Subtitle conversion
- WebVTT generation
- CSS
- Browser rendering
- Subtitle track attachment
- Subtitle timing
- Player state
- Provider subtitle format
- User settings

The investigation must establish the actual root cause.

---

# 22. Subtitle Customization Test

Test subtitle customization independently:

```text
Default subtitle
    ↓
Change font size
    ↓
Change font
    ↓
Change color
    ↓
Change background
    ↓
Change opacity
    ↓
Change position
    ↓
Change outline/shadow
    ↓
Save settings
    ↓
Restart player
    ↓
Verify settings remain functional
```

Customization must not cause subtitles to disappear.

---

# 23. Embedded vs External Subtitle Handling

The player must distinguish between:

### Embedded subtitles

Contained within:

```text
MKV
MP4
WebM
Other media containers
```

### External subtitles

Such as:

```text
SRT
ASS
VTT
```

The system should not accidentally apply external-subtitle processing to embedded streams or vice versa.

The existing media inspection model already identifies subtitle codec information and whether a subtitle is bitmap-based. Pasted markdown(8)

---

# 24. Bitmap Subtitle Handling

Bitmap subtitles such as:

- PGS
- VOBSUB
- DVB subtitles

must not be treated as ordinary text subtitles.

The current architecture routes bitmap subtitles to mpv because they cannot be represented as ordinary text tracks. Pasted markdown(8)

This behavior should be verified rather than unnecessarily replaced.

---

# 25. Subtitle Search

The player currently provides only basic subtitle options, including English and Off.

We need to expand this into a proper subtitle discovery system.

The user should be able to search for subtitles when:

- No local subtitle exists
- The provider does not provide a suitable subtitle
- The selected language is unavailable
- The existing subtitle fails validation
- The user wants another language
- The user wants a better matching subtitle

---

# 26. Online Subtitle Search

The player should provide an option such as:

```text
Subtitles
 ├── Off
 ├── English
 ├── ...
 └── Search Online
```

Selecting **Search Online** should open a subtitle-search interface.

---

# 27. Automatic Search Metadata

The subtitle search should automatically populate information from the currently playing media.

For example:

```text
Title:
Singh Redemption

Year:
2026

Season:
2

Episode:
4

Current language:
English
```

The user should not have to manually re-enter the title in the normal case.

---

# 28. User-Editable Search Metadata

The user must still be able to modify the search information.

For example:

```text
Title: [ Singh Redemption        ]
Year:   [ 2026 ▼                 ]
Season: [ 2                      ]
Episode:[ 4                      ]

Language:
[ English ▼ ]

[ Search ]
```

This is important because provider titles are not always standardized.

---

# 29. Subtitle Search by Title and Year

The system should support searching by:

- Title
- Original title
- Year
- Season
- Episode
- Language

The user should be able to correct the title if automatic metadata matching is inaccurate.

---

# 30. Subtitle Language Selection

The subtitle search UI should provide a language selector.

It should support:

- English
- User's preferred languages
- Common languages
- Searchable language list
- Multiple language selection where appropriate

The user's preferred subtitle languages should be remembered.

---

# 31. Automatic Subtitle Search

Where enabled, the application may automatically search for subtitles when:

```text
No suitable embedded subtitle
        AND
No suitable provider subtitle
        ↓
Search configured online subtitle sources
```

However, automatic searches should respect:

- User privacy
- Incognito mode
- Network settings
- Provider/API limitations
- Rate limits
- User subtitle preferences

---

# 32. Subtitle Provider Architecture

Subtitle providers should be represented separately from media providers.

Conceptually:

```text
Media Provider
      ↓
Media Source

Subtitle Provider
      ↓
Subtitle Source
```

This prevents subtitle discovery from being tightly coupled to the video provider.

---

# 33. Subtitle Source Ranking

When multiple subtitles are found, rank them based on:

1. Exact title match
2. Year match
3. Season/episode match
4. Language match
5. Duration compatibility
6. Release/version match
7. Provider confidence
8. User preference

The highest-confidence subtitle should be presented first.

---

# 34. Subtitle Preview and Selection

Before applying a subtitle, the user should be able to see:

- Language
- Provider
- Match confidence where appropriate
- Release/version
- Subtitle format
- Download size
- Relevant metadata

The UI should remain compact and easy to use.

---

# 35. Apply Subtitle Without Restarting Playback

When a valid subtitle is selected during playback:

```text
Search
  ↓
Select subtitle
  ↓
Validate
  ↓
Attach subtitle
  ↓
Continue playback
```

The application should not unnecessarily restart the media.

Playback position, audio, video, and player state should remain intact.

---

# 36. Subtitle Search and Download

The same validated subtitle should be usable for both:

### Streaming

```text
Find
  ↓
Validate
  ↓
Attach
```

### Download

```text
Find
  ↓
Validate
  ↓
Download
  ↓
Associate with media
```

This avoids implementing completely separate subtitle-matching logic.

---

# 37. Subtitle Cache

Validated subtitles should be cached where appropriate.

The cache should include:

```text
Media identity
Title
Year
Season
Episode
Language
Subtitle provider
Subtitle identity
Subtitle URL
Validation result
Downloaded state
Timestamp
```

Temporary URLs should be refreshable without losing the subtitle's identity.

---

# 38. Prevent Invalid Subtitle Reuse

If a subtitle is known to be invalid for one media release, the system should avoid repeatedly selecting the same invalid subtitle.

For example:

```text
Subtitle X
    ↓
Validated against Media A
    ↓
Invalid
```

should be recorded as a failed match for that media context.

This prevents repeated downloads and validation failures.

---

# 39. Subtitle Download Sequence

The download workflow should become:

```text
User selects Download
        ↓
Resolve media source
        ↓
Start media download
        ↓
Resolve subtitle candidates
        ↓
Validate subtitle candidates
        ↓
Select best matching subtitle
        ↓
Download subtitle
        ↓
Verify subtitle
        ↓
Store beside media
```

If no valid subtitle is found:

```text
Media download succeeds
Subtitle download skipped
```

The media download must not fail simply because no suitable subtitle exists.

---

# 40. Subtitle Download Failure Isolation

Subtitle failure must not corrupt the media download.

For example:

```text
Video: SUCCESS
Subtitle: FAILED
```

should result in:

```text
Video available
Subtitle unavailable
```

rather than:

```text
Download failed
```

---

# 41. Subtitle Integrity Check

After downloading the subtitle, perform a final validation before marking it as successfully downloaded.

Verify:

- File exists
- File is readable
- File is not empty
- Format is valid
- Encoding is valid
- Subtitle belongs to the media
- Subtitle language matches requested language
- Subtitle is not obviously corrupted

---

# 42. Subtitle File Duration / Cue Validation

Where technically practical, inspect the subtitle cues.

For example:

```text
First cue:       00:01:12
Last cue:        00:58:45
Media duration:  01:00:12
```

This looks plausible.

Where:

```text
Last cue:        02:05:31
Media duration:  01:00:12
```

the subtitle should be considered suspicious and require additional validation or rejection.

---

# 43. Subtitle Timing Offset

A subtitle can be correct but shifted by a small amount.

The system should distinguish:

```text
Correct subtitle with timing offset
```

from:

```text
Completely unrelated subtitle
```

Small differences should not automatically invalidate a subtitle.

Where supported, a subtitle timing offset can be exposed as a player control.

---

# 44. Do Not Over-Validate

Validation should be robust but practical.

The system should not reject a valid subtitle simply because:

- Duration differs by a few minutes
- Intro differs
- Credits differ
- The release contains additional scenes
- Frame rate differs slightly
- The subtitle provider's metadata is incomplete

Use multiple signals together.

---

# 45. Subtitle State Model

A useful subtitle state model should distinguish:

```text
NOT_FOUND
SEARCHING
FOUND
VALIDATING
VALID
LOW_CONFIDENCE
INVALID
DOWNLOADING
DOWNLOADED
FAILED
```

This allows the UI to communicate what is happening without displaying misleading success states.

---

# 46. Player Subtitle UI

The subtitle menu should evolve from:

```text
English
Off
```

into something more capable:

```text
Subtitles

● English
○ Hindi
○ Gujarati
○ Spanish

──────────────

Search Online
Subtitle Settings
```

The exact design should remain consistent with the current player UI.

---

# 47. Subtitle Search Flow

Expected user flow:

```text
User opens Subtitle menu
        ↓
No suitable Hindi subtitle
        ↓
Search Online
        ↓
Title automatically populated
        ↓
Year automatically populated
        ↓
Season/Episode populated when applicable
        ↓
User selects language
        ↓
Search
        ↓
Subtitle candidates
        ↓
Validation/ranking
        ↓
User selects subtitle
        ↓
Subtitle attached
```

---

# 48. Subtitle Settings

The subtitle settings should provide configurable preferences such as:

- Default language
- Preferred languages
- Automatic subtitle selection
- Online subtitle search
- Subtitle font
- Font size
- Color
- Background
- Opacity
- Outline
- Position
- Timing offset where supported

Only settings actually supported by the selected playback engine should be exposed as active controls.

---

# 49. Player Engine Consistency

Subtitle behavior must remain consistent across:

```text
Chromium <video>
HLS
DASH
FFmpeg remux
FFmpeg transcode
mpv
```

Where an engine has limitations, the subtitle subsystem should translate the subtitle into the appropriate representation.

The existing architecture already provides WebVTT conversion for Chromium and libass handling for mpv. Pasted markdown(8)

---

# 50. Do Not Break Existing Working Subtitle Support

The current implementation already has significant subtitle functionality.

Therefore:

```text
Audit
  ↓
Identify working paths
  ↓
Identify broken paths
  ↓
Fix only confirmed problems
  ↓
Add missing capabilities
  ↓
Regression test existing functionality
```

Do not replace the subtitle pipeline simply because additional functionality is required.

---

# 51. Diagnostics

Subtitle-related diagnostics should capture enough information to identify failures.

For example:

```text
Media:
Title
Year
Season
Episode
Duration

Subtitle:
Provider
Language
Format
Duration
Match score
Validation result

Player:
Engine
Current position
Subtitle track state
Attachment state

Failure:
Reason
```

Sensitive URLs, cookies, and authentication information must be redacted.

---

# 52. Acceptance Criteria: Audio/Video

The implementation is complete when:

- Audio and video remain synchronized during normal playback.
- Audio and video remain synchronized after seeking.
- Repeated seeking does not create drift.
- Pause/resume does not create drift.
- Buffering/reconnection does not introduce persistent synchronization problems.
- Source refresh does not desynchronize playback.
- Remuxing does not introduce unintended synchronization problems.
- Transcoding does not introduce unintended synchronization problems.
- mpv playback remains synchronized.
- Trailer playback remains synchronized.
- No existing working playback path is changed unnecessarily.

---

# 53. Acceptance Criteria: Subtitle Validation

- Subtitles are validated before automatic use.
- Title matching is considered.
- Year matching is considered where available.
- Season/episode matching is considered.
- Language matching is enforced.
- Duration mismatch is considered.
- Large duration mismatches are rejected or strongly penalized.
- Small legitimate duration differences do not automatically reject a subtitle.
- Invalid subtitles are not automatically attached.
- Invalid subtitles are not automatically downloaded as successful subtitle files.
- Valid subtitles can be reused appropriately.

---

# 54. Acceptance Criteria: Downloaded Subtitles

- Downloading media can trigger subtitle discovery.
- Subtitle discovery does not block the core media download unnecessarily.
- The best matching subtitle is selected.
- Subtitle validation happens before final persistence.
- The subtitle is stored alongside the downloaded media.
- Multiple languages are supported.
- Subtitle failure does not fail the video download.
- Corrupt or empty subtitle files are rejected.
- Incorrect subtitles are not retained as valid downloads.

---

# 55. Acceptance Criteria: Online Subtitle Search

- User can search for subtitles from the player.
- Current title is automatically populated.
- Current year is populated when available.
- Season/episode information is populated when applicable.
- User can edit the search title.
- User can select the year.
- User can select the language.
- Multiple languages can be supported.
- Search results are validated/ranked.
- User can select a subtitle without restarting playback.
- The selected subtitle is attached to the current player session.

---

# 56. Acceptance Criteria: Subtitle Customization

- Existing subtitle settings are audited.
- Settings actually affect the player.
- Subtitle customization does not cause subtitles to disappear.
- Settings persist correctly.
- Web player subtitles render correctly.
- mpv subtitles render correctly.
- SRT conversion remains functional.
- ASS rendering remains functional.
- Bitmap subtitle handling remains functional.

---

# 57. Final Architecture Goal

The complete subtitle workflow should become:

```text
                    Media
                      │
                      ▼
              Media Inspection
                      │
          ┌───────────┴───────────┐
          │                       │
    Embedded Subtitle       Online Subtitle
          │                       │
          │                 Search Providers
          │                       │
          └───────────┬───────────┘
                      ▼
              Subtitle Validation
                      │
          ┌───────────┴───────────┐
          │                       │
        Valid                  Invalid
          │                       │
          ▼                       └── Reject
   Rank / Select
          │
          ▼
   Player / Download
      │         │
      ▼         ▼
   Streaming  Download
```

The overall objective is to make subtitles a **reliable, validated, reusable media component**, rather than simply downloading or attaching whatever subtitle a provider happens to return.

At the same time, audio/video synchronization must be treated as a **diagnose-first requirement**. If the existing playback pipeline is already synchronized correctly, preserve it. If a real synchronization bug is reproduced, identify the exact playback path and root cause before making targeted changes.