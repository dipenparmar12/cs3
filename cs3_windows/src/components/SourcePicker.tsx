import React, { useCallback, useMemo, useState } from 'react';
import {
  X, Users, HardDrive, Loader2, AlertTriangle, Filter, ChevronDown,
  ChevronRight, Play, Download, Info, Zap, ShieldAlert, Square, Link2, Check,
  ClipboardCopy,
} from 'lucide-react';
import type { TorrentResult } from '../types/torrent';
import type { SourceDiagnosis } from '../types/diagnostics';
import { Resolution } from '../types/torrent';
import { SourceFilterBar } from './SourceFilterBar';
import { CopyErrorButton } from './CopyErrorButton';
import { SourceExportButton } from './SourceExportButton';
import { useSourceProvenance } from './useSourceProvenance';
import {
  provenanceChain,
  sourceAddress,
  sourceHost,
  toSourceDetails,
} from '../utils/sourceExport';
import {
  DEFAULT_FILTER_STATE,
  filterAndSortSources,
  type SourceFilterState,
} from '../utils/sourceFilter';
import { formatBytes } from '../utils/format';

export interface SourcePickerData {
  sources: TorrentResult[];
  filtered: Array<{ title: string; reason: string; seeders: number }>;
  indexerOutcomes: Array<{
    id: string;
    name: string;
    ok: boolean;
    count: number;
    latencyMs: number;
    error?: string;
    skipped?: string;
  }>;
  emptyReason?: string;
  /** The structured form of `emptyReason`, when the failure produced one. */
  diagnosis?: SourceDiagnosis;
  query: { title: string; season?: number; episode?: number; imdbId?: string };
}

interface SourcePickerProps {
  isOpen: boolean;
  /** A chosen source is being started — a genuinely blocking wait. */
  isLoading: boolean;
  /**
   * Discovery is still running.
   *
   * Deliberately separate from `isLoading`. Searching is *not* a blocking wait:
   * sources arrive one provider at a time and any of them is playable the moment
   * it appears, so hiding the list behind a spinner until the slowest indexer
   * finished — which is what this did — threw away most of the value of running
   * them in parallel in the first place.
   */
  searching?: boolean;
  /** Providers that have answered, out of how many are being asked. */
  searched?: number;
  totalSources?: number;
  /** The viewer stopped the search rather than it finishing. */
  cancelled?: boolean;
  /** Stops waiting for the rest, keeping whatever has been found. */
  onCancelSearch?: () => void;
  data: SourcePickerData | null;
  error?: string;
  contextLabel: string;
  onClose: () => void;
  onPlay: (source: TorrentResult) => void;
  onDownload: (source: TorrentResult) => void;
  onRetry: () => void;
}

/** Seeder count is the strongest predictor of whether a stream will actually start. */
function healthClass(seeders: number): string {
  if (seeders >= 50) return 'health-strong';
  if (seeders >= 10) return 'health-ok';
  if (seeders >= 1) return 'health-weak';
  return 'health-dead';
}

function resolutionLabel(resolution: number): string {
  switch (resolution) {
    case Resolution.UHD_4K: return '4K';
    case Resolution.QHD: return '1440p';
    case Resolution.FHD: return '1080p';
    case Resolution.HD: return '720p';
    case Resolution.SD: return '480p';
    case Resolution.LD: return '360p';
    default: return 'SD?';
  }
}

/**
 * Ranked source list.
 *
 * The design goal is that the user rarely needs to think: the top row is
 * pre-selected and "Play best" starts it. Everything else — the score reasons,
 * the filtered list, per-indexer diagnostics — is available but folded away,
 * because a source list that demands study on every play is a worse experience
 * than Android's, not a better one.
 */
export const SourcePicker: React.FC<SourcePickerProps> = ({
  isOpen, isLoading, data, error, contextLabel, onClose, onPlay, onDownload, onRetry,
  searching = false, searched = 0, totalSources = 0, cancelled = false, onCancelSearch,
}) => {
  const [showFiltered, setShowFiltered] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [expandedHash, setExpandedHash] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState<string | null>(null);
  const [copiedDetails, setCopiedDetails] = useState<string | null>(null);
  const { provenanceFor } = useSourceProvenance(data?.sources ?? []);

  /** The provider's address, not the loopback one the player would be using. */
  const copyLink = useCallback(async (source: TorrentResult) => {
    const address = sourceAddress(source);
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopiedLink(source.infoHash);
      setTimeout(() => setCopiedLink(null), 1800);
    } catch {
      // Nothing is lost when the clipboard refuses — the bulk export remains.
    }
  }, []);
  /**
   * Everything the row knows, not just its address.
   *
   * A link on its own cannot be reported: it names no provider, no extension
   * and no repository, so a source that stops working arrives at a maintainer
   * with nothing identifying whose code produced it. The same columns the bulk
   * export uses, for the one row the viewer is actually looking at.
   */
  const copyDetails = useCallback(
    async (source: TorrentResult) => {
      try {
        await navigator.clipboard.writeText(toSourceDetails(source, provenanceFor(source)));
        setCopiedDetails(source.infoHash);
        setTimeout(() => setCopiedDetails(null), 1800);
      } catch {
        // Same as the link: the clipboard refusing loses nothing recoverable.
      }
    },
    [provenanceFor]
  );

  const [filterState, setFilterState] = useState<SourceFilterState>(DEFAULT_FILTER_STATE);

  const best = useMemo(() => data?.sources[0] ?? null, [data]);

  const displayedSources = useMemo(
    () => (data ? filterAndSortSources(data.sources, filterState) : []),
    [data, filterState]
  );

  if (!isOpen) return null;

  const failedIndexers = data?.indexerOutcomes.filter((o) => !o.ok && !o.skipped) ?? [];

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="source-picker"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Select a source"
      >
        <header className="source-picker__header">
          <div>
            <h2>Select a source</h2>
            <p className="source-picker__context">{contextLabel}</p>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </header>

        {/*
          Progress, and the action on it.

          Shown above the list rather than instead of it, so a source that has
          already arrived can be played while the slow providers are still
          scraping. The count is the honest one — providers settled out of
          providers asked — and the found total beside it is what tells someone
          whether waiting is still worth it.
        */}
        {searching && (
          <div className="source-picker__progress">
            <div className="source-picker__progress-line">
              <Loader2 className="spin" size={14} />
              <span>
                {totalSources > 0
                  ? `Searching sources… ${searched} / ${totalSources}`
                  : 'Searching sources…'}
              </span>
              <strong>{data?.sources.length ?? 0} found</strong>
              {onCancelSearch && (
                <button className="source-picker__progress-stop" onClick={onCancelSearch}>
                  <Square size={11} /> Stop
                </button>
              )}
            </div>
            {totalSources > 0 && (
              <div
                className="source-picker__progress-track"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={totalSources}
                aria-valuenow={searched}
              >
                <div
                  className="source-picker__progress-fill"
                  style={{ width: `${Math.min(100, Math.round((searched / totalSources) * 100))}%` }}
                />
              </div>
            )}
          </div>
        )}

        {isLoading && (
          <div className="source-picker__state">
            <Loader2 className="spin" size={28} />
            <p>Starting the stream…</p>
            <span className="muted">Connecting to the source you picked.</span>
          </div>
        )}

        {searching && !isLoading && (data?.sources.length ?? 0) === 0 && (
          <div className="source-picker__state">
            <Loader2 className="spin" size={28} />
            <p>Searching every enabled provider…</p>
            <span className="muted">Results appear here as each one answers.</span>
          </div>
        )}

        {!isLoading && error && (
          <div className="source-picker__state source-picker__state--error">
            <AlertTriangle size={28} />
            <p>Source search failed</p>
            <span className="muted">{error}</span>
            <button className="btn btn-primary" onClick={onRetry}>Try again</button>
          </div>
        )}

        {!isLoading && !searching && !error && data && data.sources.length === 0 && (
          <div className="source-picker__state">
            <AlertTriangle size={28} />
            <p>{cancelled ? 'Search stopped' : 'No playable sources found'}</p>
            <span className="muted">
              {cancelled
                ? 'No source had answered yet when the search was stopped.'
                : (data.emptyReason ?? 'Nothing matched this title.')}
            </span>

            {/*
              What to try, when the cause implies something.

              Separate from the sentence above and phrased as advice: "the file
              host refused the request" is a diagnosis, and on its own it reads
              as a dead end rather than as "other providers may still work".
            */}
            {data.diagnosis?.hint && !cancelled && (
              <span className="source-picker__hint">{data.diagnosis.hint}</span>
            )}

            {/*
              The tuple, behind a disclosure.

              Which provider, which address, what it took, what the host said.
              This is the whole reason the diagnosis is structured rather than a
              string — but it is debugging detail, so it stays folded away from
              a viewer who only wants to try something else.
            */}
            {data.diagnosis?.facts?.length ? (
              <details className="source-picker__facts">
                <summary>Technical detail</summary>
                <dl>
                  {data.diagnosis.facts.map((fact) => (
                    <React.Fragment key={`${fact.label}:${fact.value}`}>
                      <dt>{fact.label}</dt>
                      <dd>{fact.value}</dd>
                    </React.Fragment>
                  ))}
                </dl>
              </details>
            ) : null}

            <div className="source-picker__state-actions">
              <button className="btn" onClick={onRetry}>Search again</button>
              {data.filtered.length > 0 && (
                <button className="btn" onClick={() => setShowFiltered(true)}>
                  Show {data.filtered.length} filtered
                </button>
              )}
              {/* The most commonly hit dead end, and the one carrying the least
                  on screen — the provider's own reason is in the log. */}
              <CopyErrorButton
                compact
                context={{
                  title: data.query?.title,
                  source: data.diagnosis?.provider,
                  url: data.diagnosis?.address,
                  message: data.emptyReason ?? 'No playable sources found',
                }}
              />
            </div>
          </div>
        )}

        {!isLoading && !error && data && data.sources.length > 0 && (
          <>
            <div className="source-picker__toolbar">
              <span className="muted">
                {displayedSources.length} showing (of {data.sources.length} total)
                {data.query.imdbId && ` · matched on ${data.query.imdbId}`}
              </span>
              <div className="source-picker__toolbar-actions">
                {/* The list, with every provider, extension, repository and link
                    — pasteable into a spreadsheet or a downloader. */}
                <SourceExportButton
                  sources={displayedSources}
                  provenanceFor={provenanceFor}
                  heading={`${data.query?.title ?? 'Sources'} (${displayedSources.length})`}
                  compact
                />
                {best && (
                  <button className="btn btn-primary" onClick={() => onPlay(best)}>
                    <Zap size={15} /> Play best
                  </button>
                )}
              </div>
            </div>

            <SourceFilterBar
              sources={data.sources}
              filterState={filterState}
              onChange={setFilterState}
              filteredCount={displayedSources.length}
            />

            {failedIndexers.length > 0 && (
              <div className="source-picker__warning">
                <ShieldAlert size={15} />
                <span>
                  {failedIndexers.length} indexer{failedIndexers.length === 1 ? '' : 's'} failed —
                  results may be incomplete.
                </span>
                <button className="link-button" onClick={() => setShowDiagnostics((v) => !v)}>
                  details
                </button>
              </div>
            )}

            <ul className="source-list">
              {displayedSources.map((source, index) => {
                const isExpanded = expandedHash === source.infoHash;
                return (
                  <li
                    key={`${source.infoHash}-${source.indexerId}`}
                    className={`source-row${index === 0 ? ' source-row--best' : ''}`}
                  >
                    <div className="source-row__main">
                      <div className="source-row__badges">
                        <span className={`badge badge--res-${source.parsed.resolution}`}>
                          {resolutionLabel(source.parsed.resolution)}
                        </span>
                        {source.parsed.source !== 'Unknown' && (
                          <span className="badge">{source.parsed.source}</span>
                        )}
                        {source.parsed.videoCodec !== 'Unknown' && (
                          <span className="badge badge--muted">{source.parsed.videoCodec}</span>
                        )}
                        {source.parsed.hdr.map((h) => (
                          <span key={h} className="badge badge--hdr">{h}</span>
                        ))}
                        {source.parsed.isSeasonPack && (
                          <span className="badge badge--muted">Season pack</span>
                        )}
                      </div>

                      <p className="source-row__title" title={source.title}>{source.title}</p>

                      <div className="source-row__meta">
                        <span className={healthClass(source.seeders)}>
                          <Users size={13} /> {source.seeders}
                        </span>
                        <span><HardDrive size={13} /> {formatBytes(source.sizeBytes)}</span>
                        <span className="muted" title="Host or extractor this link points at">
                          {sourceHost(source) ?? source.indexerName}
                        </span>
                        {source.parsed.releaseGroup && (
                          <span className="muted">{source.parsed.releaseGroup}</span>
                        )}
                      </div>

                      {/* Repository, extension, provider. `indexerName` above is
                          the extractor an extension picked, not the extension —
                          so without this a failing source cannot be traced to
                          anything the user is able to turn off. */}
                      {provenanceChain(source, provenanceFor(source)) && (
                        <p
                          className="source-row__origin"
                          title={provenanceChain(source, provenanceFor(source))}
                        >
                          {provenanceChain(source, provenanceFor(source))}
                        </p>
                      )}
                    </div>

                    <div className="source-row__actions">
                      <button className="btn btn-primary btn-sm" onClick={() => onPlay(source)}>
                        <Play size={14} /> Play
                      </button>
                      <button
                        className="btn btn-sm"
                        onClick={() => onDownload(source)}
                        title="Download this source"
                      >
                        <Download size={14} />
                      </button>
                      {sourceAddress(source) && (
                        <button
                          className="icon-button"
                          onClick={() => void copyLink(source)}
                          aria-label={`Copy the link for ${source.title}`}
                          title="Copy this source's link"
                        >
                          {copiedLink === source.infoHash ? <Check size={15} /> : <Link2 size={15} />}
                        </button>
                      )}
                      <button
                        className="icon-button"
                        onClick={() => void copyDetails(source)}
                        aria-label={`Copy the details for ${source.title}`}
                        title="Copy this source's details"
                      >
                        {copiedDetails === source.infoHash
                          ? <Check size={15} />
                          : <ClipboardCopy size={15} />}
                      </button>
                      <button
                        className="icon-button"
                        onClick={() => setExpandedHash(isExpanded ? null : source.infoHash)}
                        aria-label="Why this ranking?"
                        title="Why this ranking?"
                      >
                        <Info size={15} />
                      </button>
                    </div>

                    {isExpanded && (
                      <div className="source-row__why">
                        <strong>Score {source.score}</strong>
                        <ul>
                          {source.scoreReasons.map((reason) => (
                            <li key={reason}>{reason}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}

        {data && (data.filtered.length > 0 || data.indexerOutcomes.length > 0) && (
          <footer className="source-picker__footer">
            {data.filtered.length > 0 && (
              <button className="link-button" onClick={() => setShowFiltered((v) => !v)}>
                {showFiltered ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <Filter size={14} /> {data.filtered.length} filtered out
              </button>
            )}
            <button className="link-button" onClick={() => setShowDiagnostics((v) => !v)}>
              {showDiagnostics ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              Indexer diagnostics
            </button>

            {showFiltered && (
              <ul className="filtered-list">
                {data.filtered.map((item) => (
                  <li key={`${item.title}-${item.reason}`}>
                    <span className="filtered-list__title">{item.title}</span>
                    <span className="muted">{item.reason}</span>
                  </li>
                ))}
              </ul>
            )}

            {showDiagnostics && (
              <table className="diagnostics-table">
                <thead>
                  <tr><th>Indexer</th><th>Result</th><th>Latency</th></tr>
                </thead>
                <tbody>
                  {data.indexerOutcomes.map((outcome) => (
                    <tr key={outcome.id}>
                      <td>{outcome.name}</td>
                      <td>
                        {outcome.skipped
                          ? <span className="muted">{outcome.skipped}</span>
                          : outcome.ok
                            ? `${outcome.count} results`
                            : <span className="error-text">{outcome.error ?? 'failed'}</span>}
                      </td>
                      <td className="muted">{outcome.latencyMs ? `${outcome.latencyMs} ms` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </footer>
        )}
      </div>
    </div>
  );
};
