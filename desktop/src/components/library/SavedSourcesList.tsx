/**
 * Everything discovery found for a library title, saved with it and playable.
 *
 * The library keeps these automatically (see `LibraryStore.mergeDiscoveredSources`),
 * so a title added last month still lists the releases that were found for it —
 * even when the site that served them is down today. Each row says whether its
 * link can be used as it is:
 *
 * - a torrent, or a provider link inside its signed window, plays straight away;
 * - an expired provider link still names the release, and "Find again" opens the
 *   title's page, where discovery re-resolves it. Pretending an expired link
 *   will play costs the viewer a player timeout before the truth.
 */
import React, { useMemo } from 'react';
import { Clock, Magnet, Play, RotateCw } from 'lucide-react';
import type { LibraryEntry } from '../../../electron/cs3/libraryStore';
import { storedSourceToTorrentResult } from '../../../electron/cs3/libraryStore';
import { isLinkUsable } from '../../../electron/cs3/playedSource';
import type { PlayedSource, StoredSource } from '../../types/library';
import type { TorrentResult } from '../../types/torrent';
import { formatReleaseSize } from '../../utils/format';
import { useIsDeveloper } from '../../utils/ExperienceModeContext';

interface Props {
  entry: LibraryEntry;
  onPlay: (source: TorrentResult, record: PlayedSource) => void;
  /** Opens the title's page, which is where an expired link is found again. */
  onOpenPage: () => void;
}

function groupLabel(source: StoredSource): string {
  if (source.episode !== undefined) {
    return source.season !== undefined
      ? `Season ${source.season} · Episode ${source.episode}`
      : `Episode ${source.episode}`;
  }
  return '';
}

function ago(timestamp: number | undefined): string | null {
  if (!timestamp) return null;
  const minutes = Math.round((Date.now() - timestamp) / 60_000);
  if (minutes < 60) return minutes <= 1 ? 'just now' : `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

export const SavedSourcesList: React.FC<Props> = ({ entry, onPlay, onOpenPage }) => {
  const isDeveloper = useIsDeveloper();

  const groups = useMemo(() => {
    const byLabel = new Map<string, StoredSource[]>();
    for (const source of entry.sources ?? []) {
      const label = groupLabel(source);
      byLabel.set(label, [...(byLabel.get(label) ?? []), source]);
    }
    return [...byLabel.entries()];
  }, [entry.sources]);

  if (!entry.sources || entry.sources.length === 0) {
    return (
      <p className="saved-sources__empty">
        Nothing saved yet. Sources are kept here automatically once they are found — open the
        title, or press Refresh above.
      </p>
    );
  }

  const play = (source: StoredSource) => {
    const record: PlayedSource = {
      key: entry.key,
      season: source.season,
      episode: source.episode,
      source,
      origin: { mediaUrl: entry.urls[0] ?? '', title: entry.title, year: entry.year },
      playedAt: 0,
      playCount: 0,
    };
    onPlay(storedSourceToTorrentResult(source), record);
  };

  return (
    <div className="saved-sources">
      {entry.lastSourcesRefreshedAt ? (
        <p className="saved-sources__stamp">
          <Clock size={12} /> Last updated {ago(entry.lastSourcesRefreshedAt)}
        </p>
      ) : null}
      {groups.map(([label, sources]) => (
        <section key={label || 'title'} className="saved-sources__group">
          {label ? <h5>{label}</h5> : null}
          <ul>
            {sources.map((source) => {
              const usable = isLinkUsable(source);
              const torrent = Boolean(source.magnet || source.torrentUrl) && !source.directUrl;
              return (
                <li key={source.id} className="saved-sources__row">
                  <div className="saved-sources__what">
                    <span className="saved-sources__title" title={source.title}>
                      {source.title || source.sourceName}
                    </span>
                    <span className="saved-sources__meta">
                      {source.quality ? <strong>{source.quality}</strong> : null}
                      <span>{source.providerName || source.indexerName || 'Direct link'}</span>
                      {source.sizeBytes ? <span>{formatReleaseSize(source.sizeBytes)}</span> : null}
                      {source.languages?.length ? <span>{source.languages.join(', ')}</span> : null}
                      {torrent ? (
                        <span>
                          <Magnet size={11} /> torrent
                        </span>
                      ) : null}
                      {isDeveloper && source.videoCodec ? <span>{source.videoCodec}</span> : null}
                      {isDeveloper && source.seeders !== undefined && torrent ? (
                        <span>{source.seeders} seeders</span>
                      ) : null}
                      <span className="saved-sources__found">found {ago(source.discoveredAt)}</span>
                    </span>
                  </div>
                  {usable ? (
                    <button type="button" className="btn btn-primary btn-sm" onClick={() => play(source)}>
                      <Play size={12} /> Play
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      title="This link has expired. Open the title to find this release again."
                      onClick={onOpenPage}
                    >
                      <RotateCw size={12} /> Find again
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
};
