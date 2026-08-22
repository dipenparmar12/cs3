/**
 * Which sites this install holds a session for, and how eagerly it asks.
 *
 * Two things belong here and nowhere else.
 *
 * **The policy.** A verification window is the only thing in this app that
 * takes over the screen without being asked, so how it may do that is a
 * setting. `ask` is the default and the right one — a background prefetch that
 * hit a challenge and opened a browser while someone was reading a synopsis
 * would be indefensible however useful it was.
 *
 * **A way to forget.** Verifying grants a site a persistent session in this
 * app. Someone who no longer wants that must be able to remove it without
 * clearing the whole profile, and must be able to *see* that it exists —
 * a session held silently is the kind of thing users are right to object to
 * when they find it later.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { ShieldCheck, Trash2, Loader2, ExternalLink } from 'lucide-react';
import { SettingGroup, SettingRow } from './SettingRow';
import type { ScopeStatus, VerificationPolicy } from '../../../electron/access/humanGateway';

const POLICY_LABELS: Array<{ value: VerificationPolicy; label: string; hint: string }> = [
  {
    value: 'ask',
    label: 'Ask first',
    hint: 'A blocked site is reported in the results with a Verify button. Nothing opens on its own.',
  },
  {
    value: 'always',
    label: 'Open automatically',
    hint: 'A blocked site opens its verification page as soon as it is hit, including during a background search.',
  },
  {
    value: 'never',
    label: 'Never',
    hint: 'Blocked sites are skipped silently. Their results are simply unavailable.',
  },
];

export const SiteAccessPanel: React.FC = () => {
  const [scopes, setScopes] = useState<ScopeStatus[]>([]);
  const [policy, setPolicy] = useState<VerificationPolicy>('ask');
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [list, stored] = await Promise.all([
      window.cloudstream?.getAccessScopes() ?? Promise.resolve([]),
      window.cloudstream?.getVerificationPolicy() ?? Promise.resolve('ask' as VerificationPolicy),
    ]);
    setScopes(list ?? []);
    setPolicy(stored ?? 'ask');
  }, []);

  useEffect(() => {
    void refresh();
    // A verification completed in a window somewhere else changes what this
    // panel should say; without this it keeps showing "not verified" beside a
    // site the user just unlocked.
    return window.cloudstream?.onAccessUpdate?.(() => void refresh());
  }, [refresh]);

  const run = useCallback(
    async (key: string, action: () => Promise<unknown>) => {
      setBusy(key);
      try {
        await action();
      } finally {
        setBusy(null);
        await refresh();
      }
    },
    [refresh]
  );

  return (
    <SettingGroup title="Site access" icon={<ShieldCheck size={15} />}>
      <SettingRow
        label="When a site asks you to verify"
        note={POLICY_LABELS.find((entry) => entry.value === policy)?.label}
        hint={
          <>
            Some sites run a browser check before they answer. This app does not try to get past
            one — it opens the site's own page so you can answer it yourself, and then carries on
            using the session that results.
          </>
        }
      >
        <select
          value={policy}
          onChange={(event) =>
            void run('policy', () =>
              window.cloudstream!.setVerificationPolicy(event.target.value as VerificationPolicy)
            )
          }
        >
          {POLICY_LABELS.map((entry) => (
            <option key={entry.value} value={entry.value}>
              {entry.label}
            </option>
          ))}
        </select>
      </SettingRow>

      <SettingRow
        label="Sites you have verified"
        note={scopes.length === 0 ? 'None yet' : `${scopes.length} known`}
        hint="Each of these keeps its own cookies, separate from every other site and from the rest of the app. Forgetting one means verifying again next time it asks."
        stacked
      >
        <div className="access-scopes">
          {scopes.map((scope) => (
            <div key={scope.id} className="access-scope">
              <div className="access-scope__text">
                <strong>{scope.name}</strong>
                <span className="access-scope__state">
                  {scope.pending
                    ? 'Verification window open'
                    : scope.cookieCount > 0
                      ? `Session held${scope.verifiedAt ? ` since ${new Date(scope.verifiedAt).toLocaleString()}` : ''}`
                      : 'No session yet'}
                </span>
              </div>
              <div className="access-scope__actions">
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={busy !== null}
                  onClick={() => void run(`verify:${scope.id}`, () => window.cloudstream!.verifyAccess(scope.id))}
                >
                  {busy === `verify:${scope.id}` ? (
                    <Loader2 size={13} className="spin" />
                  ) : (
                    <ExternalLink size={13} />
                  )}
                  Verify now
                </button>
                {/*
                  Offered only when there is something to forget. A "Forget"
                  button beside "No session yet" is a control that does nothing,
                  which is worse than no control.
                */}
                {scope.cookieCount > 0 && (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={busy !== null}
                    onClick={() => void run(`clear:${scope.id}`, () => window.cloudstream!.clearAccessSession(scope.id))}
                  >
                    <Trash2 size={13} /> Forget
                  </button>
                )}
              </div>
            </div>
          ))}
          {scopes.length === 0 && (
            <p className="muted">
              Nothing here yet. Sites appear once an extension that uses one is installed.
            </p>
          )}
        </div>
      </SettingRow>
    </SettingGroup>
  );
};
