/**
 * "This site wants to check you're a person" — and the one button that answers it.
 *
 * The sentence matters as much as the button. The user should never need to
 * know what Cloudflare is, what a 403 is, or that a cookie is involved; they
 * need to know that a site they asked about is waiting on them and that one
 * click deals with it. Everything below is written to that standard.
 *
 * Rendered only where a search has already reported the block. It is never
 * shown speculatively, and it never opens anything on its own — pressing the
 * button is what puts a window on screen, which is the whole reason the
 * verification policy defaults to `ask`.
 */
import React, { useCallback, useState } from 'react';
import { ShieldCheck, Loader2, ExternalLink } from 'lucide-react';
import type { VerificationRequest } from './verificationRequests';

interface VerificationPromptProps {
  requests: VerificationRequest[];
  /** Re-run whatever produced these, once a site has been unblocked. */
  onVerified?: (scopeId: string) => void;
  compact?: boolean;
}

/**
 * What the user is told, per intervention.
 *
 * Deliberately not the vendor's own wording, and deliberately not ours-about-
 * theirs either: "Cloudflare returned a managed challenge" describes the
 * machinery, and the person reading it wants to know what to do.
 */
const HEADLINE: Record<string, string> = {
  HUMAN_VERIFICATION: 'wants to check that you are a person',
  BOT_CHALLENGE: 'runs a browser check before it answers',
  LOGIN_REQUIRED: 'wants you signed in',
  CONSENT_REQUIRED: 'shows a notice you have to accept first',
  UNKNOWN: 'is not answering automated requests',
};

export const VerificationPrompt: React.FC<VerificationPromptProps> = ({
  requests,
  onVerified,
  compact,
}) => {
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<Record<string, string>>({});

  const verify = useCallback(
    async (request: VerificationRequest) => {
      setBusy(request.scopeId);
      setFailed((current) => {
        const next = { ...current };
        delete next[request.scopeId];
        return next;
      });
      try {
        const result = await window.cloudstream?.verifyAccess(request.scopeId, request.url);
        if (result?.verified) onVerified?.(request.scopeId);
        else {
          setFailed((current) => ({
            ...current,
            // A closed window is a decision, not an error. Saying "verification
            // failed" to someone who deliberately closed it is the app arguing
            // with a choice they just made.
            [request.scopeId]: result?.error ?? 'Not verified — the window was closed.',
          }));
        }
      } catch (error) {
        setFailed((current) => ({
          ...current,
          [request.scopeId]: error instanceof Error ? error.message : String(error),
        }));
      } finally {
        setBusy(null);
      }
    },
    [onVerified]
  );

  if (requests.length === 0) return null;

  return (
    <div className={`verify-prompt${compact ? ' verify-prompt--compact' : ''}`}>
      {requests.map((request) => (
        <div key={request.scopeId} className="verify-prompt__row">
          <ShieldCheck size={16} className="verify-prompt__icon" />
          <div className="verify-prompt__text">
            <strong>{request.scopeName}</strong>{' '}
            {HEADLINE[request.intervention] ?? HEADLINE.UNKNOWN}.
            <span className="verify-prompt__detail">
              {/*
                Said plainly, because the alternative is that this looks like the
                app circumventing something. It is not: the site's own page
                opens, the person answers it, and the session that results is
                the one used afterwards.
              */}
              The site's own page opens here — answer it and the search carries on.
            </span>
            {failed[request.scopeId] && (
              <span className="verify-prompt__error">{failed[request.scopeId]}</span>
            )}
          </div>
          <button
            type="button"
            className="btn btn--primary verify-prompt__action"
            disabled={busy !== null}
            onClick={() => void verify(request)}
          >
            {busy === request.scopeId ? (
              <Loader2 size={14} className="spin" />
            ) : (
              <ExternalLink size={14} />
            )}
            Verify
          </button>
        </div>
      ))}
    </div>
  );
};
