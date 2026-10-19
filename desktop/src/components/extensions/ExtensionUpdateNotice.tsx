import React, { useEffect, useState } from 'react';
import { AlertCircle, ArrowUpCircle, CheckCircle2, X } from 'lucide-react';
import { Button } from '../ui';
import { describeAutomaticUpdate, type Notice } from './updateNotice';

/**
 * What an automatic extension update did, said once, wherever the viewer is.
 *
 * The daily pass runs in the background and installs without asking, so it
 * mostly happens while nobody is on the Extensions screen — and a result only
 * that screen shows is one nobody sees. A short notice: how many updated, and,
 * when some failed or are waiting to be approved, one button to the Updates
 * tab. Nothing at all when nothing changed. Kept apart from the screen so it
 * does not pull that lazily loaded chunk into the first paint.
 */

export const ExtensionUpdateNotice: React.FC<{ onReview: () => void }> = ({ onReview }) => {
  const [notice, setNotice] = useState<Notice | null>(null);

  useEffect(
    () =>
      window.cloudstream?.onExtensionUpdateEvent?.((event, payload) => {
        const next = describeAutomaticUpdate(event, payload);
        if (next) setNotice(next);
      }),
    []
  );

  // A plain success leaves by itself; something to act on stays until dismissed.
  useEffect(() => {
    if (!notice || notice.review) return;
    const timer = window.setTimeout(() => setNotice(null), 6000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  if (!notice) return null;
  const Icon = notice.tone === 'ok' ? CheckCircle2 : notice.review ? AlertCircle : ArrowUpCircle;
  return (
    <div className={`toast ext-update-notice ext-update-notice--${notice.tone}`} role="status">
      <Icon size={15} aria-hidden />
      <span>{notice.text}</span>
      {notice.review && (
        <Button
          size="compact"
          variant="ambient"
          onClick={() => {
            setNotice(null);
            onReview();
          }}
        >
          Review
        </Button>
      )}
      <button type="button" className="ext-update-notice__close" aria-label="Dismiss" onClick={() => setNotice(null)}>
        <X size={13} />
      </button>
    </div>
  );
};
