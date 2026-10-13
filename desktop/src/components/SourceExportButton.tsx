import React, { useCallback } from 'react';
import { useFlash } from '../utils/useFlash';
import { Check, ChevronDown, ClipboardCopy } from 'lucide-react';
import type { TorrentResult } from '../types/torrent';
import {
  sourceAddress,
  toSourceCsv,
  toSourceText,
  type SourceProvenance,
} from '../utils/sourceExport';
import { Menu } from './ui/Menu';

/**
 * "Copy these sources", wherever a source list is shown.
 *
 * CSV is the default and the primary click, because the useful operation on
 * thirty rows is sorting and filtering them and every machine already has
 * something that does that. The alternatives exist for two different
 * destinations that a spreadsheet serves badly: a chat window (prose) and a
 * downloader (links, one per line, nothing else to strip out).
 *
 * The links are the *provider's* addresses, never the loopback ones the player
 * is using — see `sourceAddress`. A `127.0.0.1` URL pasted into a download
 * manager looks like it should work and cannot.
 */
export const SourceExportButton: React.FC<{
  sources: TorrentResult[];
  provenanceFor?: (source: TorrentResult) => SourceProvenance | undefined;
  /** Names the export, so a pasted list says what it is a list of. */
  heading?: string;
  compact?: boolean;
}> = ({ sources, provenanceFor, heading, compact }) => {
  const { message: copied, flash: setCopied } = useFlash<string>(2000);

  const write = useCallback(async (label: string, text: string) => {
    if (!text.trim()) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
    } catch {
      // Clipboard access can be refused by the embedder; failing quietly is
      // acceptable here because nothing was lost — the list is still on screen.
    }
  }, [setCopied]);

  if (sources.length === 0) return null;

  const label = heading ?? `Sources (${sources.length})`;

  return (
    <div className="source-export">
      <button
        type="button"
        className={`source-export__main${compact ? ' source-export__main--compact' : ''}`}
        onClick={() => void write('csv', toSourceCsv(sources, provenanceFor))}
        title="Copy every source as CSV — release, quality, provider, extension, repository and link"
      >
        {copied ? <Check size={13} /> : <ClipboardCopy size={13} />}
        <span>{copied ? 'Copied' : `Copy ${sources.length}`}</span>
      </button>
      <Menu
        label="Other copy formats"
        trigger={(props) => (
          <button
            {...props}
            type="button"
            className="source-export__more"
            aria-label="Other copy formats"
            title="Other formats"
          >
            <ChevronDown size={13} />
          </button>
        )}
        items={[
          {
            label: 'Copy as CSV',
            description: 'Spreadsheet columns, one row per source',
            onSelect: () => void write('csv', toSourceCsv(sources, provenanceFor)),
          },
          {
            label: 'Copy as text',
            description: 'Readable in a chat window or an issue',
            onSelect: () => void write('text', toSourceText(sources, provenanceFor, label)),
          },
          {
            label: 'Copy links only',
            description: 'One per line, for a downloader or a browser',
            onSelect: () =>
              void write('links', sources.map(sourceAddress).filter(Boolean).join('\n')),
          },
        ]}
      />
    </div>
  );
};
