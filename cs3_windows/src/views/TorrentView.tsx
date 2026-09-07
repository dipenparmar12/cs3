import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  Download,
  FileText,
  Film,
  Folder,
  Loader2,
  Play,
  Search,
  Subtitles,
  X,
} from 'lucide-react';
import type { TorrentContents, TorrentContentFile } from '../../electron/torrent/torrentContents';
import type { TorrentImportRecord } from '../../electron/torrent/torrentImport';
import { formatBytes } from '../utils/format';
import { EmptyState } from '../components/EmptyState';
import { useFlash } from '../utils/useFlash';

/**
 * What is inside a torrent, before a byte of it has been fetched.
 *
 * The whole point is the ordering: metadata first, choice second, bytes third.
 * A torrent client opens by starting a download; this opens by showing a
 * catalogue, because the interesting question about a season pack is which
 * episode to start, not how fast the whole thing is arriving.
 *
 * ## Nothing is hidden
 *
 * Samples, extras and non-media are behind a filter rather than dropped.
 * `torrentContents.ts` makes the same argument for the same reason: a file the
 * parser judged uninteresting and discarded is one the viewer cannot reach at
 * all, which is PRD 43's F-1 wearing a different hat. The default view is the
 * playable files, and the count of what is filtered out is stated rather than
 * silently applied.
 *
 * ## Searching costs nothing
 *
 * `searchTorrentFiles` runs over metadata already in hand, so a 400-file pack
 * is searchable instantly and before any commitment. That is the difference
 * between this and a download manager, where finding the right episode means
 * fetching the whole thing first.
 */

type Filter = 'playable' | 'video' | 'subtitles' | 'all';

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: 'playable', label: 'Playable' },
  { id: 'video', label: 'All video' },
  { id: 'subtitles', label: 'Subtitles' },
  { id: 'all', label: 'Everything' },
];

export interface TorrentPlayRequest {
  infoHash: string;
  fileIndex: number;
  fileName: string;
  /** For the player's title and for the library record. */
  title: string;
  season?: number;
  episode?: number;
}

export const TorrentView: React.FC<{
  infoHash: string;
  onPlay: (request: TorrentPlayRequest) => void;
  onDownload: (request: TorrentPlayRequest & { totalSize: number }) => void;
  onBack: () => void;
}> = ({ infoHash, onPlay, onDownload, onBack }) => {
  const [contents, setContents] = useState<TorrentContents | null>(null);
  const [record, setRecord] = useState<TorrentImportRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('playable');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [openSeasons, setOpenSeasons] = useState<Record<number, boolean>>({});
  const { message: notice, flash } = useFlash<string>(4000);

  const read = useCallback(async () => {
    const result = await window.cloudstream?.getTorrentContents?.(infoHash);
    if (!result?.ok) {
      setError(result?.error ?? 'That torrent could not be read.');
      setLoading(false);
      return;
    }
    setRecord(result.record ?? null);
    setContents(result.contents ?? null);
    setError(null);
    setLoading(false);
  }, [infoHash]);

  useEffect(() => {
    setLoading(true);
    setSelected(new Set());
    setQuery('');
    void read();
  }, [read]);

  /**
   * Fetches a magnet's file list from the swarm.
   *
   * Never automatic. Joining a swarm is the one expensive thing on this page
   * and it can fail slowly, so it is a press with a stated cost rather than
   * something the page starts on the viewer's behalf while they read the name.
   */
  const resolve = useCallback(async () => {
    setResolving(true);
    setError(null);
    try {
      const result = await window.cloudstream?.resolveMagnet?.(infoHash);
      if (result?.ok && result.contents) {
        setContents(result.contents);
        setRecord(result.record ?? null);
      } else {
        setError(result?.error ?? 'No peer offered this torrent’s file list.');
      }
    } finally {
      setResolving(false);
    }
  }, [infoHash]);

  const visible = useMemo(() => {
    if (!contents) return [];
    const base =
      filter === 'playable'
        ? contents.playable
        : filter === 'video'
          ? contents.files.filter((file) => file.kind === 'video')
          : filter === 'subtitles'
            ? contents.subtitles
            : contents.files;

    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return base;
    /*
     * The same rule as `searchTorrentFiles` in the main process, applied here
     * because the file list is already in the renderer and a round trip per
     * keystroke would make an instant search feel like a network call. The
     * shapes are identical, so a term that matches there matches here.
     */
    return base.filter((file) => {
      const haystack = [
        file.path.join('/'),
        file.title,
        file.resolution ? `${file.resolution}p ${file.resolution}` : '',
        file.season !== undefined && file.episode !== undefined
          ? `s${String(file.season).padStart(2, '0')}e${String(file.episode).padStart(2, '0')} ` +
            `${file.season}x${String(file.episode).padStart(2, '0')} ` +
            `season ${file.season} episode ${file.episode} ` +
            `e${file.episode} e${String(file.episode).padStart(2, '0')}`
          : '',
      ]
        .join(' ')
        .toLowerCase();
      return terms.every((term) => haystack.includes(term));
    });
  }, [contents, filter, query]);

  const titleFor = useCallback(
    (file: TorrentContentFile) => contents?.title || record?.name || file.title,
    [contents, record]
  );

  const requestFor = useCallback(
    (file: TorrentContentFile): TorrentPlayRequest => ({
      infoHash,
      fileIndex: file.index,
      fileName: file.name,
      title: titleFor(file),
      season: file.season,
      episode: file.episode,
    }),
    [infoHash, titleFor]
  );

  const toggle = useCallback((index: number) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }, []);

  const downloadSelected = useCallback(() => {
    if (!contents) return;
    const chosen = contents.files.filter((file) => selected.has(file.index));
    for (const file of chosen) {
      onDownload({ ...requestFor(file), totalSize: file.length });
    }
    const bytes = chosen.reduce((sum, file) => sum + file.length, 0);
    flash(`Queued ${chosen.length} file${chosen.length === 1 ? '' : 's'} · ${formatBytes(bytes)}`);
    setSelected(new Set());
  }, [contents, selected, requestFor, onDownload, flash]);

  if (loading) {
    return (
      <div className="torrent-view torrent-view--state">
        <Loader2 size={26} className="spin" aria-hidden />
        <p>Reading the torrent…</p>
      </div>
    );
  }

  // A magnet whose metadata has not arrived. Not an error: the name is known,
  // and fetching the rest is a choice with a cost worth stating.
  if (!contents) {
    return (
      <div className="torrent-view torrent-view--state">
        <EmptyState
          icon={Film}
          title={record?.name ?? 'Torrent'}
          description={
            error ??
            'This came from a magnet link, so its file list has to be fetched from other ' +
              'people sharing it. Nothing is downloaded except the list itself.'
          }
          action={{
            label: resolving ? 'Asking the swarm…' : 'Fetch the file list',
            onClick: () => void resolve(),
          }}
          secondary={{ label: 'Back', onClick: onBack }}
        />
      </div>
    );
  }

  const hiddenCount = contents.files.length - visible.length;
  const selectedBytes = contents.files
    .filter((file) => selected.has(file.index))
    .reduce((sum, file) => sum + file.length, 0);

  const fileRow = (file: TorrentContentFile, showPath = true) => (
    <li key={file.index} className="torrent-file">
      <label className="torrent-file__pick">
        <input
          type="checkbox"
          checked={selected.has(file.index)}
          onChange={() => toggle(file.index)}
          aria-label={`Select ${file.name}`}
        />
      </label>

      <span className="torrent-file__icon" aria-hidden>
        {file.kind === 'video' ? (
          <Film size={14} />
        ) : file.kind === 'subtitle' ? (
          <Subtitles size={14} />
        ) : (
          <FileText size={14} />
        )}
      </span>

      <span className="torrent-file__body">
        <span className="torrent-file__name">{file.name}</span>
        <span className="torrent-file__meta">
          {formatBytes(file.length)}
          {file.resolution ? ` · ${file.resolution}p` : ''}
          {file.isSample ? ' · sample' : ''}
          {file.isExtra ? ' · extra' : ''}
          {showPath && file.directory.length > 0 ? ` · ${file.directory.join('/')}` : ''}
        </span>
      </span>

      <span className="torrent-file__actions">
        {file.kind === 'video' && (
          <button
            type="button"
            className="btn btn-sm btn-primary"
            onClick={() => onPlay(requestFor(file))}
            title="Stream this file now — the rest of the torrent is not downloaded"
          >
            <Play size={13} /> Play
          </button>
        )}
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => onDownload({ ...requestFor(file), totalSize: file.length })}
          title="Download only this file"
        >
          <Download size={13} />
        </button>
      </span>
    </li>
  );

  return (
    <div className="torrent-view">
      <header className="torrent-view__head">
        <div>
          <p className="torrent-view__kicker">
            {contents.shape === 'series'
              ? 'Series'
              : contents.shape === 'collection'
                ? 'Collection'
                : contents.shape === 'mixed'
                  ? 'Mixed pack'
                  : contents.shape === 'empty'
                    ? 'No playable video'
                    : 'Film'}
            {record?.origin === 'magnet' ? ' · from a magnet link' : ' · from a .torrent file'}
          </p>
          <h1>{contents.title}</h1>
          <p className="torrent-view__facts">
            {formatBytes(contents.totalSize)} · {contents.files.length} file
            {contents.files.length === 1 ? '' : 's'}
            {contents.folderCount > 0
              ? ` in ${contents.folderCount} folder${contents.folderCount === 1 ? '' : 's'}`
              : ''}
            {contents.playable.length > 0 ? ` · ${contents.playable.length} playable` : ''}
          </p>
          {/* The hash is the identity every other part of the app keys on, so it
              is worth showing rather than hiding as an implementation detail. */}
          <p className="torrent-view__hash" title="Info hash">
            {infoHash}
          </p>
        </div>

        <div className="torrent-view__head-actions">
          {contents.primary && contents.shape !== 'series' && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => onPlay(requestFor(contents.primary!))}
            >
              <Play size={16} /> Play
            </button>
          )}
          <button type="button" className="btn" onClick={onBack}>
            Back
          </button>
        </div>
      </header>

      <div className="torrent-view__toolbar">
        <div className="torrent-view__search">
          <Search size={14} aria-hidden />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={`Search inside ${contents.files.length} files…`}
            aria-label="Search inside this torrent"
          />
          {query && (
            <button type="button" onClick={() => setQuery('')} aria-label="Clear search">
              <X size={13} />
            </button>
          )}
        </div>

        <div className="torrent-view__filters" role="tablist" aria-label="Filter files">
          {FILTERS.map((option) => (
            <button
              key={option.id}
              role="tab"
              aria-selected={filter === option.id}
              className={`torrent-view__filter${filter === option.id ? ' torrent-view__filter--on' : ''}`}
              onClick={() => setFilter(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {/* Stated, never silent. A list quietly shorter than the torrent is
          indistinguishable from a torrent with less in it. */}
      {hiddenCount > 0 && (
        <p className="torrent-view__hidden">
          {hiddenCount} other file{hiddenCount === 1 ? '' : 's'} not shown by this filter.
        </p>
      )}

      {contents.shape === 'series' && query.trim() === '' ? (
        <div className="torrent-view__seasons">
          {contents.seasons.map((season) => {
            const open = openSeasons[season.season] ?? true;
            return (
              <section key={season.season} className="torrent-season">
                <button
                  type="button"
                  className="torrent-season__head"
                  onClick={() =>
                    setOpenSeasons((current) => ({ ...current, [season.season]: !open }))
                  }
                  aria-expanded={open}
                >
                  {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  <Folder size={14} aria-hidden />
                  <strong>Season {season.season}</strong>
                  <span>
                    {season.episodes.length} episode{season.episodes.length === 1 ? '' : 's'}
                  </span>
                </button>
                {open && (
                  <ul className="torrent-files">
                    {season.episodes.map((episode) => fileRow(episode, false))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      ) : visible.length > 0 ? (
        <ul className="torrent-files">{visible.map((file) => fileRow(file))}</ul>
      ) : (
        <EmptyState
          icon={Search}
          compact
          title={query ? `Nothing matches “${query}”` : 'Nothing in this filter'}
          description={
            query
              ? 'Try an episode number, a resolution, or part of the file name.'
              : 'Switch the filter above to see the rest of this torrent.'
          }
        />
      )}

      {/* A bulk bar, appearing only when there is a selection to act on. */}
      {selected.size > 0 && (
        <div className="torrent-view__bulk" role="status">
          <span>
            {selected.size} selected · {formatBytes(selectedBytes)}
          </span>
          <div>
            <button type="button" className="btn btn-sm" onClick={() => setSelected(new Set())}>
              Clear
            </button>
            <button type="button" className="btn btn-sm btn-primary" onClick={downloadSelected}>
              <Download size={13} /> Download selected
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="torrent-view__error" role="status">
          <AlertTriangle size={14} /> {error}
        </p>
      )}
      {notice && (
        <p className="torrent-view__notice" role="status">
          <Check size={14} /> {notice}
        </p>
      )}
    </div>
  );
};
