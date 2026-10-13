import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Check, Loader2, Play, RefreshCw, Trash2, Tv } from 'lucide-react';
import type { PlayedSource } from '../../types/library';
import type { TorrentResult } from '../../types/torrent';

/**
 * The stream that actually played, and the button that plays it again.
 *
 * The library already answers "what have I watched". This answers the question
 * underneath it — **"which of the thirty sources actually worked?"** — which
 * previously had no answer at all: returning to a title meant picking from the
 * list again, with nothing recording that the fourth one down is the only one
 * that ever delivered a frame.
 *
 * What it shows is the release, not the link. A URL is meaningless to read and
 * dead within the hour; the provider, the repository it came from and the
 * quality are what identify the thing and what survive a refresh.
 */

function formatWhen(timestamp: number): string {
  const days = Math.floor((Date.now() - timestamp) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  return new Date(timestamp).toLocaleDateString();
}

function describe(record: PlayedSource): string {
  const source = record.source;
  return [
    source.resolution ? `${source.resolution}p` : source.quality,
    source.videoCodec,
    source.audioCodecs?.length ? source.audioCodecs.join('/') : null,
    source.languages?.length ? source.languages.join('/') : null,
    source.sizeBytes ? `${(source.sizeBytes / 1e9).toFixed(1)} GB` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

export const PlayedSourcePanel: React.FC<{
  libraryKey: string;
  /** Plays the resolved source. The panel does the resolving; App does the playing. */
  onPlay: (source: TorrentResult, record: PlayedSource) => void;
  /** Offered when the saved release is gone and the viewer needs to choose again. */
  onChooseAnother?: (record: PlayedSource, alternatives: TorrentResult[]) => void;
}> = ({ libraryKey, onPlay, onChooseAnother }) => {
  const [records, setRecords] = useState<PlayedSource[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; tone: 'info' | 'bad' } | null>(null);

  const load = useCallback(async () => {
    const response = await window.cloudstream?.getPlayedSourcesForKey(libraryKey);
    setRecords(response?.ok ? response.records : []);
  }, [libraryKey]);

  useEffect(() => {
    void load();
  }, [load]);

  const slotOf = (record: PlayedSource) => `${record.season ?? ''}:${record.episode ?? ''}`;

  const play = useCallback(
    async (record: PlayedSource) => {
      setBusy(slotOf(record));
      setMessage(null);
      try {
        const response = await window.cloudstream?.resolvePlayedSource(
          record.key,
          record.season,
          record.episode
        );

        if (response?.ok && response.source) {
          /**
           * `refreshed` is worth saying out loud. The viewer asked for the
           * source they saved and got it — but the app went and re-resolved it,
           * which explains the two-second pause they just sat through.
           */
          if (response.resolution === 'refreshed') {
            setMessage({ text: 'The saved link had expired; it was refreshed.', tone: 'info' });
          }
          onPlay(response.source, response.record ?? record);
          void load();
          return;
        }

        /**
         * Gone from the provider. The record is kept and marked rather than
         * deleted — "the one that used to work is no longer offered" is more
         * useful than an entry that silently disappears — and the alternatives
         * come back so this is a choice rather than a dead end.
         */
        setMessage({
          text: response?.error ?? 'That source could not be reopened.',
          tone: 'bad',
        });
        if (response?.sources?.length && onChooseAnother) {
          onChooseAnother(record, response.sources);
        }
        void load();
      } finally {
        setBusy(null);
      }
    },
    [onPlay, onChooseAnother, load]
  );

  const forget = useCallback(
    async (record: PlayedSource) => {
      await window.cloudstream?.forgetPlayedSource(record.key, record.season, record.episode);
      void load();
    },
    [load]
  );

  if (records === null) {
    return (
      <p className="played-source__empty">
        <Loader2 className="spin" size={13} /> Loading saved sources…
      </p>
    );
  }

  if (records.length === 0) {
    return (
      <p className="played-source__empty">
        No source has played this yet. Once one does, it is saved here so you can go straight
        back to it.
      </p>
    );
  }

  return (
    <div className="played-source">
      {message && (
        <p className={`played-source__message played-source__message--${message.tone}`}>
          {message.tone === 'bad' ? <AlertTriangle size={13} /> : <Check size={13} />}
          {message.text}
        </p>
      )}

      {records.map((record) => {
        const unavailable = record.source.status === 'Unavailable';
        const isBusy = busy === slotOf(record);

        return (
          <div
            key={slotOf(record)}
            className={`played-source__row${unavailable ? ' played-source__row--gone' : ''}`}
          >
            <div className="played-source__what">
              {record.season != null && record.episode != null && (
                <span className="played-source__episode">
                  <Tv size={11} /> S{record.season} E{record.episode}
                </span>
              )}
              <strong>{record.source.title}</strong>
              <span className="played-source__detail">{describe(record)}</span>
              <span className="played-source__origin">
                {/* Provenance, because "which source worked" is only useful if
                    you can also tell where it came from. */}
                {[record.source.repository, record.source.extension, record.source.providerName ?? record.source.indexerName]
                  .filter(Boolean)
                  .join(' ▸ ')}
              </span>
              <span className="played-source__when">
                Played {formatWhen(record.playedAt)}
                {record.playCount > 1 ? ` · ${record.playCount} times` : ''}
                {unavailable && record.source.failureReason ? ` · ${record.source.failureReason}` : ''}
              </span>
            </div>

            <div className="played-source__actions">
              <button
                type="button"
                className="btn"
                onClick={() => void play(record)}
                disabled={isBusy}
                title={
                  unavailable
                    ? 'Try again — the provider may have it back'
                    : 'Play this exact source again'
                }
              >
                {isBusy ? (
                  <Loader2 size={14} className="spin" />
                ) : unavailable ? (
                  <RefreshCw size={14} />
                ) : (
                  <Play size={14} />
                )}
                <span>{unavailable ? 'Try again' : 'Play this source'}</span>
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-icon"
                onClick={() => void forget(record)}
                title="Forget this source"
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
};
