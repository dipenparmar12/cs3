import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, ClipboardCopy } from 'lucide-react';
import type { TorrentResult } from '../types/torrent';
import {
  sourceAddress,
  toSourceCsv,
  toSourceText,
  type SourceProvenance,
} from '../utils/sourceExport';

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
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const wrapper = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onOutside = (event: PointerEvent) => {
      if (wrapper.current && !wrapper.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', onOutside, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onOutside, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  const write = useCallback(async (label: string, text: string) => {
    setOpen(false);
    if (!text.trim()) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      // Clipboard access can be refused by the embedder; failing quietly is
      // acceptable here because nothing was lost — the list is still on screen.
    }
  }, []);

  if (sources.length === 0) return null;

  const label = heading ?? `Sources (${sources.length})`;

  return (
    <div className="source-export" ref={wrapper}>
      <button
        type="button"
        className={`source-export__main${compact ? ' source-export__main--compact' : ''}`}
        onClick={() => void write('csv', toSourceCsv(sources, provenanceFor))}
        title="Copy every source as CSV — release, quality, provider, extension, repository and link"
      >
        {copied ? <Check size={13} /> : <ClipboardCopy size={13} />}
        <span>{copied ? 'Copied' : `Copy ${sources.length}`}</span>
      </button>
      <button
        type="button"
        className="source-export__more"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Other copy formats"
        title="Other formats"
      >
        <ChevronDown size={13} />
      </button>

      {open && (
        <div className="source-export__menu" role="menu">
          <button
            type="button"
            role="menuitem"
            onClick={() => void write('csv', toSourceCsv(sources, provenanceFor))}
          >
            Copy as CSV
            <span>Spreadsheet columns, one row per source</span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => void write('text', toSourceText(sources, provenanceFor, label))}
          >
            Copy as text
            <span>Readable in a chat window or an issue</span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() =>
              void write(
                'links',
                sources
                  .map(sourceAddress)
                  .filter(Boolean)
                  .join('\n')
              )
            }
          >
            Copy links only
            <span>One per line, for a downloader or a browser</span>
          </button>
        </div>
      )}
    </div>
  );
};
