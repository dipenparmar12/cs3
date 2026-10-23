# PRD: Download Progress Stability and Flexible TV Series Batch Downloading

## 1. Objective

Improve CS3's download experience by fixing inconsistent download progress and ETA displays, and introducing a flexible batch-download workflow for TV series.

The existing movie download functionality is working well and must remain stable. The improvements should focus on two areas:

1. **Download progress reliability:** Investigate and fix flickering progress, incorrect percentage changes, missing ETA, and inconsistent progress information in the Downloads section.
2. **TV series batch downloading:** Allow users to select multiple seasons and episodes, configure preferred quality and source preferences, and download selected episodes in a single workflow with minimal unnecessary interaction.

Every download must resolve to the correct episode and use a suitable, validated source. CS3 must not silently download unrelated content or use a source from an unintended provider when the requested source cannot be resolved.

## 2. Download Progress and ETA Stability

### 2.1 Current Problem

The Downloads section sometimes displays progress and ETA correctly and sometimes fails to display them. Progress may also fluctuate unexpectedly, for example:

- Progress increases from 20% to 50%, then drops back to 20%.
- Progress increases from 30% to 60%, then drops back to 30%.
- ETA appears intermittently, disappears, or changes erratically.
- Progress information is temporarily missing despite an active download.

This creates the impression that downloads are restarting, losing progress, or behaving unreliably, even when the underlying download may still be progressing normally.

The root cause must be established through code inspection and runtime diagnostics rather than assuming that the problem is purely visual.

### 2.2 Investigate the Existing Implementation

Review the complete download-progress data flow, including:

- Download manager and download service.
- Download task creation, identity, and lifecycle.
- Progress events emitted by the underlying downloader.
- Main-process to renderer-process communication.
- Progress aggregation and state updates.
- Pinia stores or other existing frontend state management.
- Downloads section and individual download-item components.
- ETA calculation and formatting.
- Pause, resume, retry, restart, and recovery behavior.
- Download persistence and restoration after application restart.
- Concurrent downloads and event subscriptions.

Determine whether progress fluctuations originate from the downloader, duplicated events, stale task updates, incorrect task identity, resumed-download byte accounting, competing state updates, or UI rendering.

Do not change existing download behavior without understanding the cause.

### 2.3 Stable Progress Calculation

Use the authoritative download task state and byte counts wherever available.

For each download, track the appropriate values:

- Total bytes downloaded.
- Expected total bytes.
- Current download percentage.
- Current download speed.
- ETA.
- Download state.
- Last progress update.
- Whether the total size is known.

Calculate percentage from the authoritative downloaded-byte count and total size when both are available:

`progress = downloadedBytes / totalBytes × 100`

Requirements:

- Ensure downloaded bytes and total bytes use consistent units and accounting rules.
- Do not calculate percentage by repeatedly adding incremental percentages.
- Do not mix the current attempt's byte counts with the cumulative progress of a resumed download.
- Do not allow stale events from a previous attempt to overwrite newer progress.
- Associate events with the correct download task and attempt.
- Avoid duplicate event subscriptions and duplicated progress processing.
- Validate incoming values before updating the UI.
- Keep progress within the valid range of 0% to 100%.
- Treat unknown total size as indeterminate progress rather than displaying a misleading percentage.
- Mark a download as complete only when the download manager confirms successful completion and the required file checks pass.

Progress must reflect actual download state, not an optimistic estimate.

### 2.4 Prevent Progress Flickering

Investigate and correct the underlying state-update mechanism.

The implementation should:

- Use a stable download identifier for each task.
- Prevent out-of-order progress events from overwriting newer state.
- Ignore obsolete events from cancelled, restarted, or superseded attempts.
- Keep the latest authoritative progress state when updates arrive out of order.
- Avoid unnecessary UI updates when the displayed values have not meaningfully changed.
- Throttle or coalesce high-frequency renderer updates where appropriate, without losing authoritative progress information.
- Ensure progress updates for one download cannot overwrite another download's state.
- Preserve valid progress when the application receives temporary event gaps.
- Reconcile restored downloads with the current downloader state after application restart.

Do not artificially force progress to increase if the actual download has legitimately restarted or the downloader has corrected its byte accounting. Instead, distinguish a genuine restart or resumed-transfer correction from an invalid state update and communicate meaningful state changes clearly.

### 2.5 ETA Calculation

ETA should be displayed only when there is enough reliable information to calculate it.

Use remaining bytes and a suitably smoothed estimate of download speed. Avoid calculating ETA from a single noisy speed sample.

Requirements:

- Display ETA when total size and a meaningful speed estimate are available.
- Show an appropriate indeterminate state when size or speed is unknown.
- Avoid rapid, unnecessary ETA fluctuations by smoothing speed estimates.
- Handle zero speed, paused downloads, stalled connections, and unknown total size.
- Clear or update ETA appropriately when a download is paused, completed, failed, or restarted.
- Avoid displaying stale ETA values after a download state changes