import React, { useCallback, useRef, useState } from 'react';
import { useFlash } from '../../utils/useFlash';
import { Check, ClipboardCopy, MoreHorizontal } from 'lucide-react';
import type { SourceCapabilityModel } from '../../types/media';
import type { TorrentResult } from '../../types/torrent';
import type { DownloadTask } from '../../types/download';
import {
  provenanceChain,
  sourceAddress,
  toSourceCsv,
  type SourceProvenance,
} from '../../utils/sourceExport';
import { useDismissable } from '../../utils/useDismissable';
import { useIsDeveloper } from '../../utils/ExperienceModeContext';

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
  onOpenChange?: (open: boolean) => void;
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
  onOpenChange,
}) => {
  const isDeveloper = useIsDeveloper();
  const [open, setOpen] = useState(false);
  const { message: copied, flash: setCopied } = useFlash<string>(2200);
  const wrapper = useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    onOpenChange?.(open);
  }, [open, onOpenChange]);

  const close = useCallback(() => setOpen(false), []);
  useDismissable(open, wrapper, close);

  const write = useCallback(async (label: string, text: string) => {
    setOpen(false);
    if (!text.trim()) return;
    try {
      await navigator.clipboard.writeText(text.trim());
      setCopied(label);
    } catch {
      // Clipboard access can be refused; Settings → Diagnostics is the way
      // through when it is, so failing quietly here is acceptable.
    }
  }, [setCopied]);

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

  /**
   * Two items for everyone, the rest for Developer mode.
   *
   * The menu had eight copy commands — media info, source, sources as CSV, as
   * text, links only, download info, error report, full debug log — in front
   * of every viewer. What a viewer actually does with this menu is one of two
   * things: open the video somewhere else (the link) or report that it does
   * not work (the problem report). Everything else is for whoever is fixing
   * it, and Developer mode is where the app already keeps that. "Sources as
   * text" is gone: the CSV carries the same rows and sorts.
   */
  const activeLink = activeSource ? sourceAddress(activeSource) : streamUrl;
  const everyday: Array<{ label: string; hint?: string; run: () => void }> = [
    ...(activeLink
      ? [{ label: 'Copy video link', hint: 'Open it in another player', run: () => void write('link', activeLink) }]
      : []),
    {
      label: 'Copy problem report',
      hint: 'What happened, for a bug report',
      run: () =>
        void onCopyDiagnostics('current').then((text) => {
          if (text) void write('error', text);
        }),
    },
  ];
  const technical: Array<{ label: string; hint?: string; run: () => void }> = isDeveloper
    ? [
        { label: 'Copy media info', run: () => void write('media', mediaInfo()) },
        { label: 'Copy source', run: () => void write('source', sourceInfo()) },
        ...(allSources && allSources.length > 0
          ? [
              {
                label: `Copy all sources as CSV (${allSources.length})`,
                run: () => void write('sources', toSourceCsv(allSources, provenanceForSource)),
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
          label: 'Copy full debug log',
          run: () =>
            void onCopyDiagnostics('full').then((text) => {
              if (text) void write('debug', text);
            }),
        },
      ]
    : [];

  return (
    <div
      className="player-copy"
      ref={wrapper}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        className="icon-button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="More"
        aria-label="More"
      >
        {copied ? <Check size={17} /> : <MoreHorizontal size={17} />}
      </button>

      {open && (
        <div className="player-copy__menu" role="menu">
          <p className="player-copy__heading">
            <ClipboardCopy size={12} /> Copy
          </p>
          {everyday.map((item) => (
            <button key={item.label} type="button" role="menuitem" onClick={item.run}>
              {item.label}
              {item.hint && <em className="player-copy__hint">{item.hint}</em>}
            </button>
          ))}
          {technical.length > 0 && (
            <>
              <p className="player-copy__heading player-copy__heading--sub">Developer</p>
              {technical.map((item) => (
                <button key={item.label} type="button" role="menuitem" onClick={item.run}>
                  {item.label}
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
};
