import React, { useEffect, useState } from 'react';
import { Download, ExternalLink, MonitorPlay, RefreshCw } from 'lucide-react';

/**
 * The way out when the built-in player cannot play something.
 *
 * There is a category of file this app will never decode natively, and pretending
 * otherwise leaves the viewer at a dead end with a source that works perfectly
 * well in the player already on their machine. VLC and mpv carry their own
 * ffmpeg and play essentially anything, so handing the stream over is not an
 * admission of defeat — it is the correct answer.
 *
 * The URL passed is whatever the player is currently using, proxy and all: that
 * loopback address already carries the provider's `Referer`, and external
 * players each have their own incompatible way of setting one.
 *
 * When nothing is installed, the download links open in the system browser.
 * Fetching an installer on the user's behalf is not something this should do
 * quietly, and there is no version of that which is not a surprise.
 */
export const ExternalPlayerFallback: React.FC<{ streamUrl: string; compact?: boolean }> = ({
  streamUrl,
  compact = false,
}) => {
  const [players, setPlayers] = useState<Array<{ id: string; name: string }>>([]);
  const [downloads, setDownloads] = useState<
    Array<{ id: string; name: string; url: string; note: string }>
  >([]);
  const [status, setStatus] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const load = async (refresh = false) => {
    setChecking(true);
    const response = await window.cloudstream?.listExternalPlayers?.(refresh);
    setPlayers(response?.players ?? []);
    setDownloads(response?.downloads ?? []);
    setChecking(false);
  };

  useEffect(() => {
    void load(false);
  }, []);

  const open = async (id: string, name: string) => {
    const response = await window.cloudstream?.openInExternalPlayer?.(id, streamUrl);
    setStatus(response?.ok ? `Opening in ${name}…` : (response?.error ?? `Could not start ${name}.`));
    setTimeout(() => setStatus(null), 4000);
  };

  if (players.length === 0 && downloads.length === 0) return null;

  return (
    <div className={`extplayer${compact ? ' extplayer--compact' : ''}`}>
      {players.length > 0 ? (
        <>
          <span className="extplayer__label">
            <MonitorPlay size={13} /> Play in another player
          </span>
          <div className="extplayer__row">
            {players.map((player) => (
              <button key={player.id} className="btn btn-secondary" onClick={() => open(player.id, player.name)}>
                {player.name}
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          <span className="extplayer__label">
            <Download size={13} /> No other player found
          </span>
          <p className="extplayer__note">
            A general-purpose player handles formats this one cannot. These open in your
            browser — nothing is downloaded for you.
          </p>
          <div className="extplayer__row">
            {downloads.map((entry) => (
              <button
                key={entry.id}
                className="btn btn-secondary"
                title={entry.note}
                onClick={() => window.cloudstream?.openExternalLink?.(entry.url)}
              >
                <ExternalLink size={12} /> {entry.name}
              </button>
            ))}
            <button className="btn btn-secondary" onClick={() => load(true)} disabled={checking}>
              <RefreshCw size={12} /> {checking ? 'Checking…' : 'Check again'}
            </button>
          </div>
        </>
      )}

      {status && <span className="extplayer__status">{status}</span>}
    </div>
  );
};
