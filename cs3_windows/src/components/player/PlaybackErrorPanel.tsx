import React, { useCallback, useState } from 'react';
import {
  AlertTriangle,
  Check,
  ClipboardCopy,
  Download,
  Link2,
  List,
  RotateCcw,
} from 'lucide-react';
import type { SourceCapabilityModel } from '../../types/media';
import type { TorrentResult } from '../../types/torrent';
import { CopyErrorButton } from '../CopyErrorButton';
import { ExternalPlayerFallback } from './ExternalPlayerFallback';
import { provenanceChain, sourceAddress, type SourceProvenance } from '../../utils/sourceExport';

/**
 * The one surface shown when a stream will not play.
 *
 * There used to be two. `NativeEngineStage` rendered its own full-bleed
 * `.player__overlay` on an mpv failure *and* reported the same failure up
 * through `onError`, which made `VideoPlayer` render its error overlay too —
 * two translucent black panels stacked, each dimming the other, with two
 * different messages about one failure legible through each other. Both were
 * also painted under the native stage, which sits at a higher `z-index`, so on
 * the engine that fails most interestingly neither could be read at all.
 *
 * One owner fixes both halves: the engine reports, this renders, and there is
 * no second overlay to collide with.
 *
 * **A failure to *play* is not a failure to *fetch*.** That distinction is the
 * reason this offers a download at all: a 10-bit HEVC file with Dolby audio
 * behind a slow CDN can be impossible to decode here and perfectly ordinary to
 * download, and every report of "it will not play" from a source that would
 * have downloaded fine was a dead end we put in front of the viewer ourselves.
 * So the actions are ordered by what is most likely to actually get them the
 * film: download it, try another source, convert it, hand it to another player.
 */

export const PlaybackErrorPanel: React.FC<{
  message: string;
  title: string;
  episodeTitle?: string;
  streamUrl: string;
  capability: SourceCapabilityModel | null;
  activeSource?: TorrentResult | null;
  provenance?: SourceProvenance;
  /** How far the automatic failover has got, so "given up" reads differently to "still trying". */
  attempts?: { tried: number; total: number };
  /** True when mpv was holding the stream, which makes converting here a real alternative. */
  isNativeEngine?: boolean;
  /** The source is gone, not merely undecodable — no player and no downloader can help. */
  dead?: boolean;
  onDownload?: () => void;
  onChooseAnother: () => void;
  /** Forces the ffmpeg ladder in this window. Only meaningful off the native engine. */
  onConvertHere?: () => void;
}> = ({
  message,
  title,
  episodeTitle,
  streamUrl,
  capability,
  activeSource,
  provenance,
  attempts,
  isNativeEngine,
  dead,
  onDownload,
  onChooseAnother,
  onConvertHere,
}) => {
  const [copied, setCopied] = useState<string | null>(null);

  const write = useCallback(async (label: string, text: string) => {
    if (!text.trim()) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      // The main-process report below still works when the clipboard refuses.
    }
  }, []);

  const address = activeSource ? sourceAddress(activeSource) : '';
  const chain = activeSource ? provenanceChain(activeSource, provenance) : '';
  const stillTrying = attempts && attempts.tried < attempts.total;

  /** Everything about this failure, in the shape a maintainer can act on. */
  const sourceReport = () =>
    [
      `${title}${episodeTitle ? ` — ${episodeTitle}` : ''}`,
      '',
      `Problem: ${message}`,
      activeSource ? `Release: ${activeSource.title}` : '',
      chain ? `Origin: ${chain}` : '',
      activeSource?.indexerName ? `Host/extractor: ${activeSource.indexerName}` : '',
      capability?.requiredStrategy ? `Strategy: ${capability.requiredStrategy}` : '',
      capability?.metadata
        ? `Container: ${capability.metadata.formatName ?? capability.transport}`
        : '',
      capability?.metadata?.video
        ? `Video: ${capability.metadata.video.codec} ${capability.metadata.video.bitDepth}-bit ` +
          `${capability.metadata.video.width}x${capability.metadata.video.height}`
        : '',
      capability?.metadata?.audio?.length
        ? `Audio: ${capability.metadata.audio
            .map((track) => `${track.codec}/${track.channels}ch${track.language ? `:${track.language}` : ''}`)
            .join(', ')}`
        : '',
      address ? `Address: ${address}` : '',
    ]
      .filter(Boolean)
      .join('\n');

  return (
    <div className="player__overlay player__overlay--error">
      <div className="playback-error">
        <AlertTriangle size={32} className="playback-error__icon" />

        <h3 className="playback-error__headline">
          {dead ? 'That source is gone' : 'This source would not play'}
        </h3>
        <p className="playback-error__message">{message}</p>

        {/*
          What the app is doing about it right now. Failover is silent
          otherwise, and a viewer watching a dead frame has no way to tell
          "trying the next one" from "given up".
        */}
        {attempts && attempts.total > 0 && (
          <p className="playback-error__attempts">
            Tried {attempts.tried} of {attempts.total} source
            {attempts.total === 1 ? '' : 's'}
            {stillTrying ? ' — trying the next…' : ''}
          </p>
        )}

        {chain && <p className="playback-error__origin">{chain}</p>}

        {/*
          Download first, and deliberately so. Decoding and fetching are
          different capabilities: a file this build cannot decode is very often
          one that downloads perfectly, and offering only "pick another source"
          sends the viewer back to a list to look for a problem that is not in
          the list.
        */}
        <div className="playback-error__actions">
          {onDownload && !dead && (
            <button type="button" className="btn btn-primary" onClick={onDownload}>
              <Download size={16} /> Download it instead
            </button>
          )}
          <button type="button" className="btn" onClick={onChooseAnother}>
            <List size={16} /> Choose another source
          </button>
          {isNativeEngine && onConvertHere && (
            <button type="button" className="btn" onClick={onConvertHere}>
              <RotateCcw size={16} /> Convert and play here
            </button>
          )}
        </div>

        {onDownload && !dead && (
          <p className="playback-error__note">
            Playing and downloading are different jobs — a file this build cannot decode
            usually downloads without trouble, and plays once it is on disk.
          </p>
        )}

        {/* The facts, for a bug report or for a provider maintainer. */}
        <div className="playback-error__copy">
          {address && (
            <button type="button" className="link-button" onClick={() => void write('link', address)}>
              {copied === 'link' ? <Check size={13} /> : <Link2 size={13} />}
              {copied === 'link' ? 'Link copied' : 'Copy link'}
            </button>
          )}
          <button type="button" className="link-button" onClick={() => void write('info', sourceReport())}>
            {copied === 'info' ? <Check size={13} /> : <ClipboardCopy size={13} />}
            {copied === 'info' ? 'Details copied' : 'Copy source details'}
          </button>
          <CopyErrorButton
            compact
            context={{
              title: episodeTitle ? `${title} — ${episodeTitle}` : title,
              url: streamUrl,
              source: chain || activeSource?.indexerName,
              message,
            }}
          />
        </div>

        {/*
          Offered only when the source is actually there. A 404 plays no better
          in VLC, and sending someone to install a player that cannot help is
          worse than saying nothing.
        */}
        {!dead && <ExternalPlayerFallback streamUrl={streamUrl} compact />}
      </div>
    </div>
  );
};
