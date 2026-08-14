import React, { useState } from 'react';
import { Check, ClipboardCopy } from 'lucide-react';

/**
 * Copies a failure in a form someone else can act on.
 *
 * The message alone is never enough. "Expected URL scheme 'http' or 'https'"
 * is a fact about a string, not about anything anyone can fix; what makes it
 * reproducible is which provider produced it, on which query, for which item,
 * at which address — plus the app and runtime versions, which the person
 * reporting is least likely to know and the person receiving asks for first.
 *
 * The report is assembled in the main process, which is the only side that has
 * the environment and the log. This button asks for it and puts it on the
 * clipboard, with the on-screen context added on top so a report always names
 * the thing the user was looking at, even when nothing was logged.
 */
export const CopyErrorButton: React.FC<{
  /** What the user was doing, in their terms. */
  context: { query?: string; title?: string; url?: string; message?: string; source?: string };
  /** Narrows the attached log to specific records; omit for recent ones. */
  recordIds?: string[];
  label?: string;
  compact?: boolean;
}> = ({ context, recordIds, label = 'Copy error details', compact = false }) => {
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  const copy = async () => {
    setBusy(true);
    try {
      const response = await window.cloudstream?.reportDiagnostics?.(recordIds);

      const header = [
        'What I was doing',
        context.query ? `  query:    ${context.query}` : null,
        context.title ? `  title:    ${context.title}` : null,
        context.source ? `  source:   ${context.source}` : null,
        context.url ? `  url:      ${context.url}` : null,
        context.message ? `  on screen: ${context.message}` : null,
        '',
      ]
        .filter(Boolean)
        .join('\n');

      await navigator.clipboard.writeText(`${header}\n${response?.text ?? ''}`.trim());
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Clipboard access can be refused; the diagnostics panel in Settings is
      // the way through when it is, so failing quietly here is acceptable.
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      className={`copy-error${compact ? ' copy-error--compact' : ''}`}
      onClick={copy}
      disabled={busy}
      title="Copies the provider, query, item and error, plus app and runtime versions"
    >
      {copied ? <Check size={13} /> : <ClipboardCopy size={13} />}
      <span>{copied ? 'Copied' : label}</span>
    </button>
  );
};
