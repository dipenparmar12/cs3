import React, { useCallback, useEffect, useState } from 'react';
import { Check, Loader2, Wrench, ChevronDown, ChevronRight, AlertTriangle } from 'lucide-react';

/**
 * One-click install for FFmpeg, phrased for people who have never heard of it.
 *
 * FFmpeg is needed for real work — identifying audio codecs, and remuxing audio
 * Chromium cannot decode — but none of that is the user's problem to understand.
 * The surface is a single button labelled in terms of the outcome. The tool
 * names, versions and install path live behind a disclosure for the people who
 * want them, which is the only audience for whom "FFmpeg" is a useful word.
 */

export const MediaComponentsCard: React.FC = () => {
  const [status, setStatus] = useState<{ ffmpeg: boolean; ffprobe: boolean; bundled: boolean } | null>(
    null
  );
  const [installing, setInstalling] = useState(false);
  const [progress, setProgress] = useState<{ status: string; percent: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const refresh = useCallback(async () => {
    const binaries = await window.cloudstream?.checkBinaries();
    if (binaries) {
      setStatus({
        ffmpeg: binaries.ffmpeg,
        ffprobe: binaries.ffprobe,
        bundled: binaries.bundled.ffmpeg && binaries.bundled.ffprobe,
      });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // The download is ~100 MB; without live progress the dialog looks hung.
  useEffect(() => {
    const dispose = window.cloudstream?.onBinarySetupProgress(setProgress);
    return () => dispose?.();
  }, []);

  const install = useCallback(async () => {
    setInstalling(true);
    setError(null);
    const response = await window.cloudstream?.setupFfmpeg();
    setInstalling(false);
    setProgress(null);

    if (!response?.ok) setError(response?.message ?? 'Installation failed.');
    await refresh();
  }, [refresh]);

  const installed = Boolean(status?.ffmpeg && status?.ffprobe);
  /**
   * Reported as "included" rather than "installed" when it shipped in the box.
   *
   * Saying "Installed" for something nobody installed teaches the reader that
   * this badge is decorative — and this is the same badge they will come back
   * to when something really is missing.
   */
  const bundled = Boolean(status?.bundled);

  return (
    <div className="settings-card">
      <div className="settings-card__head">
        <Wrench size={16} style={{ color: 'var(--accent-light)' }} />
        <h3>Media Components</h3>
        {installed && (
          <span className="settings-card__badge">
            <Check size={12} /> {bundled ? 'Included' : 'Installed'}
          </span>
        )}
      </div>

      <p className="muted">
        {installed
          ? bundled
            ? 'These ship with the app, so wider format support works out of the box. Nothing to install.'
            : 'Everything needed for wider format support is installed. Media with unusual audio will play normally.'
          : 'Some media uses audio formats Windows cannot play on its own. Installing these components fixes that, and improves download handling.'}
      </p>

      {installing && progress && (
        <div className="settings-card__progress">
          <div className="settings-card__progress-bar">
            <div style={{ width: `${Math.max(2, progress.percent)}%` }} />
          </div>
          <span className="muted">{progress.status}</span>
        </div>
      )}

      {error && (
        <p className="settings-card__error">
          <AlertTriangle size={14} /> {error}
        </p>
      )}

      <button
        className={`btn ${installed ? 'btn-secondary' : 'btn-primary'}`}
        onClick={install}
        disabled={installing}
        style={{ width: 'fit-content' }}
      >
        {installing ? <Loader2 className="spin" size={15} /> : <Wrench size={15} />}
        <span>
          {installing
            ? 'Installing…'
            : installed
              ? 'Reinstall components'
              : 'Install required media components'}
        </span>
      </button>

      <button
        className="settings-card__disclosure"
        onClick={() => setShowAdvanced((v) => !v)}
      >
        {showAdvanced ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        Technical details
      </button>

      {showAdvanced && (
        <div className="settings-card__advanced">
          <p>
            Installs <code>ffmpeg</code> and <code>ffprobe</code> from the BtbN
            FFmpeg-Builds GPL release into the app's private <code>bin</code>
            directory. Nothing is added to <code>PATH</code> and no system
            component is modified.
          </p>
          <ul>
            <li>
              ffmpeg: {status?.ffmpeg ? 'present' : 'not installed'}
            </li>
            <li>
              ffprobe: {status?.ffprobe ? 'present' : 'not installed'}
            </li>
          </ul>
          <p>
            <code>ffprobe</code> identifies the audio codec in a stream, which is
            what tells "this file has no audio" apart from "this audio codec
            cannot be decoded here" — identical silence otherwise.
          </p>
        </div>
      )}
    </div>
  );
};
