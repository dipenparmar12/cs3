import React, { useState } from 'react';
import { Bookmark, ChevronLeft, ChevronRight, RotateCcw } from 'lucide-react';

export type SyncStepMs = 50 | 100 | 250;

interface SubtitleSyncSliderProps {
  /** Current subtitle delay in seconds (positive = appears later). */
  delay: number;
  onDelayChange: (seconds: number) => void;
  /** Optional current video playback time in seconds (for bookmark calibration). */
  currentTime?: number;
  /** Optional active cue start time in seconds (for bookmark calibration). */
  activeCueStartTime?: number;
}

const MIN_MS = -10_000;
const MAX_MS = 10_000;

function formatMs(ms: number): string {
  if (ms === 0) return '0 ms';
  const sign = ms > 0 ? '+' : '-';
  const abs = Math.abs(ms);
  if (abs >= 1000) {
    return `${sign}${(abs / 1000).toFixed(2).replace(/\.?0+$/, '')} s`;
  }
  return `${sign}${abs} ms`;
}

export const SubtitleSyncSlider: React.FC<SubtitleSyncSliderProps> = ({
  delay,
  onDelayChange,
  currentTime,
  activeCueStartTime,
}) => {
  const [stepMs, setStepMs] = useState<SyncStepMs>(100);
  const [calibrationOpen, setCalibrationOpen] = useState(false);
  const [audioMark, setAudioMark] = useState<number | null>(null);
  const [cueMark, setCueMark] = useState<number | null>(null);

  const delayMs = Math.round(delay * 1000);
  const clampedSliderMs = Math.max(MIN_MS, Math.min(MAX_MS, delayMs));

  const nudge = (deltaMs: number) => {
    const next = Math.round((delayMs + deltaMs) / 10) / 100;
    onDelayChange(next);
  };

  const calibratedOffsetSeconds =
    audioMark !== null && cueMark !== null ? Math.round((audioMark - cueMark) * 100) / 100 : null;

  return (
    <div className="sub-sync">
      <div className="sub-sync__header">
        <span className="sub-sync__title">Timing offset</span>
        <span className="sub-sync__value" aria-live="polite">
          {formatMs(delayMs)}
          {delayMs > 0 ? ' · later' : delayMs < 0 ? ' · earlier' : ' · in sync'}
        </span>
      </div>

      <div className="sub-sync__buttons">
        <button
          type="button"
          className="sub-sync__step-btn"
          onClick={() => nudge(-stepMs)}
          title={`Subtitles appear ${stepMs} ms earlier`}
        >
          <ChevronLeft size={14} aria-hidden />
          <span>Move Earlier</span>
        </button>
        <button
          type="button"
          className="sub-sync__reset-btn"
          onClick={() => onDelayChange(0)}
          disabled={delayMs === 0}
          title="Reset timing offset to 0 ms"
        >
          <RotateCcw size={12} aria-hidden />
          <span>0 ms</span>
        </button>
        <button
          type="button"
          className="sub-sync__step-btn"
          onClick={() => nudge(stepMs)}
          title={`Subtitles appear ${stepMs} ms later`}
        >
          <span>Move Later</span>
          <ChevronRight size={14} aria-hidden />
        </button>
      </div>

      <div className="sub-sync__slider-wrap">
        <input
          type="range"
          min={MIN_MS}
          max={MAX_MS}
          step={50}
          value={clampedSliderMs}
          onChange={(e) => onDelayChange(Number(e.target.value) / 1000)}
          aria-label="Subtitle timing offset in milliseconds"
          className="sub-sync__slider"
        />
        <div className="sub-sync__ticks" aria-hidden>
          <span>-10.0s</span>
          <span>0 ms</span>
          <span>+10.0s</span>
        </div>
      </div>

      <div className="sub-sync__granularity" role="group" aria-label="Step size">
        <span className="sub-sync__granularity-label">Step:</span>
        {([
          { ms: 50, label: 'Fine (50ms)' },
          { ms: 100, label: 'Normal (100ms)' },
          { ms: 250, label: 'Coarse (250ms)' },
        ] as const).map((opt) => (
          <button
            key={opt.ms}
            type="button"
            className={`sub-sync__chip${stepMs === opt.ms ? ' sub-sync__chip--on' : ''}`}
            aria-pressed={stepMs === opt.ms}
            onClick={() => setStepMs(opt.ms)}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {typeof currentTime === 'number' && (
        <div className="sub-sync__cal-wrap">
          <button
            type="button"
            className="sub-sync__cal-toggle"
            aria-expanded={calibrationOpen}
            onClick={() => setCalibrationOpen((v) => !v)}
          >
            <Bookmark size={12} aria-hidden />
            <span>Audio-subtitle calibration</span>
          </button>
          {calibrationOpen && (
            <div className="sub-sync__cal-box">
              <p className="sub-sync__cal-hint">
                Mark when a distinct word is spoken, then mark when its subtitle appears.
              </p>
              <div className="sub-sync__cal-actions">
                <button
                  type="button"
                  className="sub-sync__chip"
                  onClick={() => setAudioMark(currentTime)}
                >
                  {audioMark !== null ? `Dialogue: ${audioMark.toFixed(2)}s` : '1. Mark Dialogue'}
                </button>
                <button
                  type="button"
                  className="sub-sync__chip"
                  onClick={() => setCueMark(activeCueStartTime ?? currentTime)}
                >
                  {cueMark !== null ? `Subtitle: ${cueMark.toFixed(2)}s` : '2. Mark Subtitle'}
                </button>
              </div>
              {calibratedOffsetSeconds !== null && (
                <div className="sub-sync__cal-apply">
                  <span>Computed offset: {formatMs(Math.round(calibratedOffsetSeconds * 1000))}</span>
                  <button
                    type="button"
                    className="sub-sync__chip sub-sync__chip--on"
                    onClick={() => {
                      onDelayChange(calibratedOffsetSeconds);
                      setAudioMark(null);
                      setCueMark(null);
                    }}
                  >
                    Apply Calibration
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
