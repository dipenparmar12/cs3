import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useFlash } from '../../utils/useFlash';
import {
  X, Play, RefreshCw, Loader2, Users, HardDrive, Radio, Check, AlertTriangle, Download, Filter,
  Square, Globe, Link2, Package,
} from 'lucide-react';
import type { TorrentResult } from '../../types/torrent';
import { SourceFilterBar } from '../SourceFilterBar';
import { SourceExportButton } from '../SourceExportButton';
import { useSourceProvenance } from '../useSourceProvenance';
import { provenanceChain, sourceAddress, sourceHost } from '../../utils/sourceExport';
import {
  DEFAULT_FILTER_STATE,
  filterAndSortSources,
  type SourceFilterState,
} from '../../utils/sourceFilter';
import { formatReleaseSize } from '../../utils/format';

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
  /** True when the last search was stopped by the viewer rather than finishing. */
  cancelled?: boolean;
  /** Set while a chosen source is being started. */
  switchingTo?: string | null;
  error?: string;
  onClose: () => void;
  onSelect: (source: TorrentResult) => void;
  onRefresh: () => void;
  /**
   * Look beyond the providers this title was found on.
   *
   * Absent, or present with `canWiden` false, when there is nothing wider to
   * ask — a title opened from the home screen was never bound to a provider, so
   * its first search already looked everywhere.
   */
  onWiden?: () => void;
  /** True when widening would reach providers and indexers not yet asked. */
  canWiden?: boolean;
  /** Stops waiting for the rest; the sources already found stay on the list. */
  onCancelSearch?: () => void;
  /** Offered per source, so a viewer can grab the release they are watching. */
  onDownload?: (source: TorrentResult) => void;
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
  cancelled,
  switchingTo,
  error,
  onClose,
  onSelect,
  onRefresh,
  onWiden,
  canWiden,
  onCancelSearch,
  onDownload,
}) => {
  const [filterState, setFilterState] = useState<SourceFilterState>(DEFAULT_FILTER_STATE);
  const [showFilterBar, setShowFilterBar] = useState(true);
  const { message: copiedLink, flash: setCopiedLink } = useFlash<string>(1800);
  const { provenanceFor } = useSourceProvenance(sources);

  /**
   * One source's address, copied.
   *
   * Offered per row rather than only in bulk because the common need is
   * singular: this release will not play here and the viewer wants to give
   * *this* link to a downloader or a browser. The address copied is the
   * provider's, not the loopback proxy the player is using.
   */
  const copyLink = useCallback(async (source: TorrentResult) => {
    const address = sourceAddress(source);
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopiedLink(source.infoHash);
    } catch {
      // Refused clipboard access loses nothing — the bulk export is still there.
    }
  }, [setCopiedLink]);

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
          <h3>Select a source</h3>
          <div className="player-panel__facts">
            <span>
              {displayedSources.length} showing (of {sources.length} total)
              {cancelled && !searching && ' · search stopped'}
            </span>
          </div>
        </div>
        <div className="player-panel__head-actions">
          {/* Every source, with its provider, extension, repository and link —
              for feeding a downloader, or for saying which provider is broken. */}
          <SourceExportButton
            sources={displayedSources}
            provenanceFor={provenanceFor}
            heading={`Sources (${displayedSources.length})`}
            compact
          />
          <button
            className={`icon-button${showFilterBar ? ' active' : ''}`}
            onClick={() => setShowFilterBar((v) => !v)}
            title="Filter and sort sources"
            aria-label="Filter sources"
          >
            <Filter size={18} />
          </button>
          <button className="icon-button" onClick={onClose} aria-label="Close source list">
            <X size={18} />
          </button>
        </div>
      </header>

      {/*
        Search state and the action on it, spelled out.

        This was an unlabelled circular-arrow icon in the header, which is the
        same glyph the app uses for "retry a download" and reads as "redraw this
        list" rather than "go and look again" — so the one control that fixes an
        expired link was the one nobody would find. It is now a labelled action
        with the count beside it, and while a search is running the same slot
        becomes the way to stop it.
      */}
      <div className="player-panel__search-state">
        {searching ? (
          <>
            <div className="player-panel__search-line">
              <Loader2 className="spin" size={14} />
              <span>
                {totalIndexers > 0
                  ? `Searching sources… ${searched} / ${totalIndexers}`
                  : 'Searching sources…'}
              </span>
              <strong>
                {sources.length} found
              </strong>
            </div>
            {totalIndexers > 0 && (
              <div
                className="player-panel__search-track"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={totalIndexers}
                aria-valuenow={searched}
              >
                <div
                  className="player-panel__search-fill"
                  style={{
                    width: `${Math.min(100, Math.round((searched / totalIndexers) * 100))}%`,
                  }}
                />
              </div>
            )}
            {onCancelSearch && (
              <button className="player-panel__search-action" onClick={onCancelSearch}>
                <Square size={12} />
                Stop searching
                <span className="muted">keeps what has been found</span>
              </button>
            )}
          </>
        ) : (
          <>
            <button className="player-panel__search-action" onClick={onRefresh}>
              <RefreshCw size={13} />
              Search again
              <span className="muted">re-checks this title&apos;s providers</span>
            </button>
            {/*
              Offered only when it would ask something new.
              
              The default search asks the providers this title was actually
              found on, which is what the Android app does. This is the step
              beyond that — every other installed provider, plus the torrent
              indexers — and it is a separate button because it is a different
              question, not a harder version of the same one.
            */}
            {onWiden && canWiden && (
              <button className="player-panel__search-action" onClick={onWiden}>
                <Globe size={13} />
                Search all sources
                <span className="muted">every provider and torrent indexer</span>
              </button>
            )}
          </>
        )}
      </div>

      {showFilterBar && (
        <SourceFilterBar
          sources={sources}
          filterState={filterState}
          onChange={setFilterState}
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
        {displayedSources.map((source, rowIndex) => {
          /**
           * Exactly one row may be marked as playing — the invariant, enforced
           * where it is actually visible rather than assumed upstream.
           *
           * `infoHash` is a *synthetic* identity for a provider stream: the
           * SHA-1 of its URL. Two extensions that scrape the same file host hand
           * back the same URL and therefore the same identity, so a plain
           * equality test lit up every copy at once — the reported
           * "[x] Source A [x] Source B". Matching the first occurrence keeps the
           * display truthful about the one stream that is really open, and the
           * key below is disambiguated so React does not collapse the duplicates
           * into one row either.
           */
          const isActive =
            Boolean(activeInfoHash) &&
            source.infoHash === activeInfoHash &&
            displayedSources.findIndex((candidate) => candidate.infoHash === activeInfoHash) ===
              rowIndex;
          const isSwitching = switchingTo === source.infoHash;
          const chain = provenanceChain(source, provenanceFor(source));
          const host = sourceHost(source);
          const address = sourceAddress(source);

          return (
            <li
              key={`${source.infoHash}-${rowIndex}`}
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
                    <HardDrive size={12} /> {formatReleaseSize(source.sizeBytes)}
                  </span>
                  <span title="Host or extractor this link points at">
                    <Radio size={12} /> {host ?? source.indexerName}
                  </span>
                  {isActive && <span className="player-panel__now">Playing</span>}
                </div>

                {/*
                  Where this actually came from.

                  `indexerName` above is the *extractor* for an extension link —
                  a file host the provider chose, like "Voe" or "Server 3". It
                  is not the provider, and showing only it means a source that
                  starts failing cannot be traced to whose code or whose
                  repository to turn off. The chain answers that.
                */}
                {chain && (
                  <div className="player-panel__source-origin" title={chain}>
                    <Package size={11} />
                    <span>{chain}</span>
                  </div>
                )}
              </button>

              {address && (
                <button
                  className="player-panel__source-link"
                  onClick={() => void copyLink(source)}
                  title={`Copy this link — ${address.slice(0, 120)}`}
                  aria-label={`Copy the link for ${source.title}`}
                >
                  {copiedLink === source.infoHash ? <Check size={14} /> : <Link2 size={14} />}
                </button>
              )}

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
          {searching
            ? 'Searching for sources…'
            : cancelled
              ? 'Search stopped before any source answered. Search again to retry.'
              : 'No sources found.'}
        </p>
      )}
    </aside>
  );
};
