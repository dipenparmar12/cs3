/**
 * What one automatic update event says to the viewer, if anything. Pure, so
 * the wording is tested (`updateNotice.test.mts`); drawn by
 * `ExtensionUpdateNotice.tsx`.
 */

export interface Notice {
  tone: 'ok' | 'attention';
  text: string;
  /** Whether the Updates tab has something to act on. */
  review: boolean;
}

interface CompletedPayload {
  outcomes?: Array<{ ok?: boolean }>;
}

interface AvailablePayload {
  updates?: unknown[];
}

export function describeAutomaticUpdate(event: string, payload: unknown): Notice | null {
  if (event === 'extension:autoUpdateCompleted') {
    const outcomes = Array.isArray((payload as CompletedPayload)?.outcomes) ? (payload as CompletedPayload).outcomes! : [];
    if (outcomes.length === 0) return null;
    const ok = outcomes.filter((outcome) => outcome?.ok).length;
    const failed = outcomes.length - ok;
    const noun = (n: number) => `extension${n === 1 ? '' : 's'}`;
    if (failed === 0) return { tone: 'ok', text: `Updated ${ok} ${noun(ok)}.`, review: false };
    return {
      tone: 'attention',
      text: ok > 0 ? `Updated ${ok} ${noun(ok)}. ${failed} couldn’t be updated.` : `${failed} ${noun(failed)} couldn’t be updated.`,
      review: true,
    };
  }
  if (event === 'extension:updatesAvailable') {
    const count = Array.isArray((payload as AvailablePayload)?.updates) ? (payload as AvailablePayload).updates!.length : 0;
    if (count === 0) return null;
    return { tone: 'attention', text: `${count} extension update${count === 1 ? ' is' : 's are'} ready to install.`, review: true };
  }
  return null;
}
