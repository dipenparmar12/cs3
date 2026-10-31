import type { PlaybackRuntimeReport } from '../../types/media.ts';

/**
 * What one prepared stream did in the element, for PRD-40.1 telemetry.
 *
 * Fed from `<video>` events and sent once as `media:reportPlayback` when the
 * stream is left. A `waiting` caused by a seek is the seek's cost, not a stall,
 * and nothing before the first frame is a stall either: that is startup.
 */
export class PlaybackStats {
  private readonly startedAt: number;
  private firstFrameAt: number | null = null;
  private playingSince: number | null = null;
  private playedMs = 0;
  private seekCount = 0;
  private seeking = false;
  private stallCount = 0;
  private stallStartedAt: number | null = null;
  private stallTotalMs = 0;

  constructor(now: number) {
    this.startedAt = now;
  }

  playing(now: number): void {
    if (this.firstFrameAt === null) this.firstFrameAt = now;
    this.endStall(now);
    if (this.playingSince === null) this.playingSince = now;
  }

  paused(now: number): void {
    this.stopClock(now);
  }

  waiting(now: number): void {
    this.stopClock(now);
    if (this.firstFrameAt === null || this.seeking || this.stallStartedAt !== null) return;
    this.stallCount += 1;
    this.stallStartedAt = now;
  }

  seekStarted(now: number): void {
    // A seek ends a stall it interrupts; the wait after it is the seek's.
    this.endStall(now);
    if (this.firstFrameAt !== null) this.seekCount += 1;
    this.seeking = true;
  }

  seekFinished(): void {
    this.seeking = false;
  }

  report(now: number, ended: boolean): PlaybackRuntimeReport {
    this.stopClock(now);
    this.endStall(now);
    return {
      firstFrameMs: this.firstFrameAt === null ? 0 : Math.max(1, Math.round(this.firstFrameAt - this.startedAt)),
      playbackSeconds: Math.round(this.playedMs / 100) / 10,
      seekCount: this.seekCount,
      stallCount: this.stallCount,
      stallTotalMs: Math.round(this.stallTotalMs),
      ended,
    };
  }

  private stopClock(now: number): void {
    if (this.playingSince === null) return;
    this.playedMs += now - this.playingSince;
    this.playingSince = null;
  }

  private endStall(now: number): void {
    if (this.stallStartedAt === null) return;
    this.stallTotalMs += now - this.stallStartedAt;
    this.stallStartedAt = null;
  }
}
