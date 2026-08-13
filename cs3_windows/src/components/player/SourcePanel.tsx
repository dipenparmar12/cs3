import React, { useEffect, useMemo, useState } from 'react';
import {
  X, Play, RefreshCw, Loader2, Users, HardDrive, Radio, Check, AlertTriangle, Download, Filter,
} from 'lucide-react';
import type { TorrentResult } from '../../types/torrent';
import { SourceFilterBar } from '../SourceFilterBar';
import {
  DEFAULT_FILTER_STATE,
  filterAndSortSources,
  type SourceFilterState,
} from '../../utils/sourceFilter';

/**
 * In-player source switcher.
 *
 * Android exposes the release a stream came from and lets you change it without
 * leaving playback, because the top-ranked source is a guess: it may be the
 * wrong audio language, a hardsubbed rip, or a swarm that dies ten minutes in.
 * Sending the viewer back to a detail page to fix that loses their position and
 * their place in the series.
 *
 * "Refresh" re-runs the original query rather than re-using the list, which is
 * what makes it useful for providers whose links expire — a stale list refetched
 * is still stale.
 */

interface SourcePanelProps {
  open: boolean;
  sources: TorrentResult[];
  activeInfoHash?: string;
  /** True while discovery is still running, so the list is known to be partial. */
  searching: boolean;
  searched: number;
  totalIndexers: number;
  /** Set while a chosen source is being started. */
  switchingTo?: string | null;
  error?: string;
  onClose: () => void;
  onSelect: (source: TorrentResult) => void;
  onRefresh: () => void;
  /** Offered per source, so a viewer can grab the release they are watching. */
  onDownload?: (source: TorrentResult) => void;
}

function formatSize(bytes: number): string {
  if (!bytes) return '—';
  const gb = bytes / 1e9;
  return gb >= 1 ? `${gb.toFixed(2)} GB` : `${(bytes / 1e6).toFixed(0)} MB`;
}

/** The tags that decide whether a release is the one you want, in one line. */
function describe(source: TorrentResult): string {
  const p = source.parsed;
  const parts: string[] = [];
  if (p.resolution) parts.push(`${p.resolution}p`);
  if (p.source && p.source !== 'Unknown') parts.push(p.source);
  if (p.videoCodec && p.videoCodec !== 'Unknown') parts.push(p.videoCodec);
  if (p.hdr.length > 0) parts.push(p.hdr.join('/'));
  if (p.audioCodecs.length > 0) parts.push(p.audioCodecs.join('/'));
  if (p.isDualAudio) parts.push('Dual audio');
  else if (p.isMultiAudio) parts.push('Multi audio');
  if (p.languages.length > 0) parts.push(p.languages.join(', ').toUpperCase());
  if (p.hasHardcodedSubs) parts.push('Hardsubs');
  return parts.join(' · ');
}

export const SourcePanel: React.FC<SourcePanelProps> = ({
  open,
  sources,
  activeInfoHash,
  searching,
  searched,
  totalIndexers,
  switchingTo,
  error,
  onClose,
  onSelect,
  onRefresh,
  onDownload,
}) => {
  const [filterState, setFilterState] = useState<SourceFilterState>(DEFAULT_FILTER_STATE);
  const [showFilterBar, setShowFilterBar] = useState(true);

  const displayedSources = useMemo(
    () => filterAndSortSources(sources, filterState),
    [sources, filterState]
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <aside className="player-panel player-panel--sources" aria-label="Stream sources">
      <header className="player-panel__head player-panel__head--sticky">
        <div>
          <h3>Sources</h3>
          <div className="player-panel__facts">
            <span>
              {displayedSources.length} showing (of {sources.length} total)
              {searching && totalIndexers > 0 && ` · searching ${searched}/${totalIndexers}`}
            </span>
          </div>
        </div>
        <div className="player-panel__head-actions">
          <button
            className={`icon-button${showFilterBar ? ' active' : ''}`}
            onClick={() => setShowFilterBar((v) => !v)}
            title="Filter and sort sources"
            aria-label="Filter sources"
          >
            <Filter size={18} />
          </button>
          <button
            className="icon-button"
            onClick={onRefresh}
            disabled={searching}
            title="Search again for fresh links"
            aria-label="Refresh sources"
          >
            {searching ? <Loader2 className="spin" size={18} /> : <RefreshCw size={18} />}
          </button>
          <button className="icon-button" onClick={onClose} aria-label="Close source list">
            <X size={18} />
          </button>
        </div>
      </header>

      {showFilterBar && (
        <SourceFilterBar
          filterState={filterState}
          onChange={setFilterState}
          totalCount={sources.length}
          filteredCount={displayedSources.length}
          compact
        />
      )}

      {error && (
        <p className="player-panel__error">
          <AlertTriangle size={14} /> {error}
        </p>
      )}

      {/*
        Play and download are separate, non-overlapping targets.

        Download used to be absolutely positioned over the bottom-right of the
        row — exactly where the play affordance sat — so aiming at play
        regularly started a download instead. Play is now a distinct button at
        the head of the row and download is a distinct button at its tail, with
        the text block between them.
      */}
      <ul className="player-panel__sources">
        {displayedSources.map((source) => {
          const isActive = source.infoHash === activeInfoHash;
          const isSwitching = switchingTo === source.infoHash;

          return (
            <li
              key={source.infoHash}
              className={`player-panel__source-row${
                isActive ? ' player-panel__source-row--current' : ''
              }`}
            >
              <button
                className="player-panel__source-play"
                onClick={() => onSelect(source)}
                disabled={isSwitching}
                aria-current={isActive || undefined}
                title={isActive ? 'Playing — restart this source' : 'Play this source'}
                aria-label={`Play ${source.title}`}
              >
                {isSwitching ? (
                  <Loader2 className="spin" size={16} />
                ) : isActive ? (
                  <Check size={16} />
                ) : (
                  <Play size={16} fill="currentColor" />
                )}
              </button>

              {/* The body selects too, so the whole row remains a play target —
                  just not one that overlaps download. */}
              <button
                className="player-panel__source-body"
                onClick={() => onSelect(source)}
                disabled={isSwitching}
              >
                <strong>{source.title}</strong>
                <span>{describe(source)}</span>
                <div className="player-panel__source-facts">
                  <span title="Seeders">
                    <Users size={12} /> {source.seeders}
                  </span>
                  <span title="Size">
                    <HardDrive size={12} /> {formatSize(source.sizeBytes)}
                  </span>
                  <span title="Indexer">
                    <Radio size={12} /> {source.indexerName}
                  </span>
                  {isActive && <span className="player-panel__now">Playing</span>}
                </div>
              </button>

              {onDownload && (
                <button
                  className="player-panel__source-download"
                  onClick={() => onDownload(source)}
                  title="Download this release"
                  aria-label={`Download ${source.title}`}
                >
                  <Download size={15} />
                </button>
              )}
            </li>
          );
        })}
      </ul>

      {sources.length === 0 && (
        <p className="player-panel__empty">
          {searching ? 'Searching for sources…' : 'No sources found.'}
        </p>
      )}
    </aside>
  );
};
