import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Check, ClipboardCopy, MoreHorizontal } from 'lucide-react';
import type { SourceCapabilityModel } from '../../types/media';
import type { TorrentResult } from '../../types/torrent';
import type { DownloadTask } from '../../types/download';
import {
  provenanceChain,
  sourceAddress,
  toSourceCsv,
  toSourceText,
  type SourceProvenance,
} from '../../utils/sourceExport';

/**
 * Copy actions for the player, grouped into one menu.
 *
 * The constraint this is built against is that the player should read as a
 * media player, not as a diagnostic console — so seven separate copy buttons
 * along the control bar was never an option, however useful each one is. One
 * quiet "more" affordance opens them, and the primary controls stay about
 * watching.
 *
 * The split between what is assembled here and what comes from the main process
 * follows what each side actually knows. Media, source, provider and download
 * facts are already on screen — the renderer has them and can format them
 * exactly as the viewer sees them. The error and full-log reports are built in
 * the main process because only it holds the environment (app, Electron,
 * platform and extension-runtime versions, which are the first thing any
 * maintainer asks for and the last thing a reporter can answer) and the
 * deduplicated diagnostics log.
 */

interface PlayerCopyMenuProps {
  title: string;
  episodeTitle?: string;
  streamUrl: string;
  capability: SourceCapabilityModel | null;
  provenance?: {
    provider?: string;
    extensionName?: string;
    repositoryName?: string;
  };
  activeSource?: TorrentResult | null;
  allSources?: TorrentResult[];
  download?: DownloadTask | null;
  /** Player state at the moment of copying: position, duration, engine, errors. */
  playerState: () => Record<string, string | number | boolean | undefined>;
  /** Delegates to the main process, which owns the environment and the log. */
  onCopyDiagnostics: (mode: 'current' | 'full') => Promise<string | null>;
}

/** Nothing empty, nothing undefined — a report full of blanks reads as broken. */
function block(heading: string, lines: Array<[string, unknown]>): string {
  const body = lines
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([label, value]) => `  ${label}: ${value}`)
    .join('\n');
  return body ? `${heading}\n${body}` : '';
}


export const PlayerCopyMenu: React.FC<PlayerCopyMenuProps> = ({
  title,
  episodeTitle,
  streamUrl,
  capability,
  provenance,
  activeSource,
  allSources,
  download,
  playerState,
  onCopyDiagnostics,
}) => {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const wrapper = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onOutside = (event: PointerEvent) => {
      if (wrapper.current && !wrapper.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onOutside, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onOutside, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const write = useCallback(async (label: string, text: string) => {
    setOpen(false);
    if (!text.trim()) return;
    try {
      await navigator.clipboard.writeText(text.trim());
      setCopied(label);
      setTimeout(() => setCopied(null), 2200);
    } catch {
      // Clipboard access can be refused; Settings → Diagnostics is the way
      // through when it is, so failing quietly here is acceptable.
    }
  }, []);

  const video = capability?.metadata?.video;
  const audio = capability?.metadata?.audio ?? [];

  const mediaInfo = () =>
    [
      block('Media', [
        ['Title', title],
        ['Episode', episodeTitle],
        ['Container', capability?.metadata?.formatName ?? capability?.transport],
        ['Duration', capability?.metadata?.durationSeconds
          ? `${Math.round(capability.metadata.durationSeconds)}s`
          : undefined],
        ['Video', video ? `${video.codec} ${video.bitDepth}-bit ${video.width}x${video.height}${video.isHdr ? ' HDR' : ''}` : undefined],
        ['Audio', audio.length
          ? audio.map((t) => `${t.codec}/${t.channels}ch${t.language ? `:${t.language}` : ''}`).join(', ')
          : undefined],
        ['Subtitles', capability?.metadata?.subtitles.length || undefined],
        ['Strategy', capability?.requiredStrategy],
        ['Direct playable', capability ? String(capability.directPlayable) : undefined],
      ]),
      block('Player', Object.entries(playerState()) as Array<[string, unknown]>),
    ]
      .filter(Boolean)
      .join('\n\n');

  const sourceInfo = () =>
    [
      block('Source', [
        ['Name', activeSource?.title],
        ['Resolution', activeSource?.parsed?.resolution],
        ['Quality', activeSource?.parsed?.source],
        ['Video codec', activeSource?.parsed?.videoCodec],
        ['Audio', activeSource?.parsed?.audioCodecs?.join('/')],
        ['Languages', activeSource?.parsed?.languages?.join('/')],
        ['HDR', activeSource?.parsed?.hdr?.join('/')],
        ['Size', activeSource?.sizeBytes ? `${(activeSource.sizeBytes / 1e9).toFixed(2)} GB` : undefined],
        ['Type', activeSource ? (activeSource.directUrl ? 'direct stream' : 'torrent') : undefined],
        ['Identity', activeSource?.infoHash],
        /**
         * The *original* address, not the loopback one the player is using. A
         * `http://127.0.0.1:…` URL is meaningless to anyone receiving this
         * report — it names our own proxy, not the provider's link.
         */
        ['Address', activeSource?.directUrl ?? activeSource?.magnet ?? streamUrl],
        ['Explanation', capability?.explanation],
      ]),
      block('Provider', [
        ['Provider', provenance?.provider ?? activeSource?.providerName],
        ['Extension', provenance?.extensionName],
        ['Repository', provenance?.repositoryName],
        /** The extractor the provider picked — a file host, not the provider. */
        ['Host/extractor', activeSource?.indexerName],
        ['Chain', activeSource ? provenanceChain(activeSource, provenance) : undefined],
      ]),
    ]
      .filter(Boolean)
      .join('\n\n');

  /**
   * The origin chain, for whichever provider a row names.
   *
   * Only the *active* source's ancestry is resolved here — that is what the
   * player was given. For the rest the provider's own name is what we have, and
   * it is still the fact that matters: `indexerName` is the extractor a
   * provider chose, not the provider.
   */
  const provenanceForSource = (source: TorrentResult): SourceProvenance | undefined => {
    if (activeSource && source.infoHash === activeSource.infoHash && provenance) return provenance;
    return source.providerName ? { provider: source.providerName } : undefined;
  };

  const sourcesHeading = `${episodeTitle ? `${title} — ${episodeTitle}` : title} — sources (${
    allSources?.length ?? 0
  })`;

  const downloadInfo = () =>
    download
      ? block('Download', [
          ['Title', download.title],
          ['State', download.state],
          ['Progress', download.totalBytes
            ? `${(download.bytesDownloaded / 1e6).toFixed(0)} MB / ${(download.totalBytes / 1e6).toFixed(0)} MB (${Math.floor((download.bytesDownloaded / download.totalBytes) * 100)}%)`
            : `${(download.bytesDownloaded / 1e6).toFixed(0)} MB`],
          ['Speed', download.downloadSpeed ? `${(download.downloadSpeed / 1e3).toFixed(0)} KB/s` : undefined],
          ['Retries', download.retryCount],
          ['Provider', download.providerName],
          ['Target', download.targetFilePath],
          ['Error', download.errorMessage],
        ])
      : 'No download is running for this media.';

  const items: Array<{ label: string; run: () => void }> = [
    { label: 'Copy media info', run: () => void write('media', mediaInfo()) },
    { label: 'Copy source', run: () => void write('source', sourceInfo()) },
    /**
     * Three destinations, because a source list goes to three different places
     * and each wants a different shape. CSV leads: the useful operation on
     * thirty rows is sorting and filtering them, and the links are what let a
     * viewer hand a stream we cannot play to something that can.
     */
    ...(allSources && allSources.length > 0
      ? [
          {
            label: `Copy all sources as CSV (${allSources.length})`,
            run: () => void write('sources', toSourceCsv(allSources, provenanceForSource)),
          },
          {
            label: 'Copy all sources as text',
            run: () =>
              void write('sources', toSourceText(allSources, provenanceForSource, sourcesHeading)),
          },
          {
            label: 'Copy source links only',
            run: () =>
              void write('links', allSources.map(sourceAddress).filter(Boolean).join('\n')),
          },
        ]
      : []),
    ...(download ? [{ label: 'Copy download info', run: () => void write('download', downloadInfo()) }] : []),
    {
      label: 'Copy error report',
      run: () =>
        void onCopyDiagnostics('current').then((text) => {
          if (text) void write('error', text);
        }),
    },
    {
      label: 'Copy full debug log',
      run: () =>
        void onCopyDiagnostics('full').then((text) => {
          if (text) void write('debug', text);
        }),
    },
  ];

  return (
    <div className="player-copy" ref={wrapper}>
      <button
        type="button"
        className="icon-button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Copy details"
        aria-label="Copy details"
      >
        {copied ? <Check size={17} /> : <MoreHorizontal size={17} />}
      </button>

      {open && (
        <div className="player-copy__menu" role="menu">
          <p className="player-copy__heading">
            <ClipboardCopy size={12} /> Copy
          </p>
          {items.map((item) => (
            <button key={item.label} type="button" role="menuitem" onClick={item.run}>
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
