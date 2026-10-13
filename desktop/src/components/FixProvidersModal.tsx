import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, Download, Loader2, Power, X } from 'lucide-react';

/**
 * "These sources are not working — here is a checklist, fix them."
 *
 * The reported failure was a warning naming **seventy** providers as *selected
 * in the search scope but no longer installed or enabled*, with no action
 * attached. Everything needed to fix it existed and every one of them was in
 * Settings, behind a tree the user had to expand per repository, per extension,
 * per provider — for seventy names they did not choose individually in the
 * first place.
 *
 * ## Grouped by what it would take, not by name
 *
 * Seventy checkboxes in a flat list is a worse version of the same problem.
 * They fall into exactly three groups and each is a different decision:
 *
 *  - **A switch** — installed, switched off somewhere in the cascade. Free and
 *    instant, so it is preselected.
 *  - **A download** — not installed; recoverable, but it costs bandwidth and
 *    time. Never preselected, and the count is stated before the button is
 *    pressed rather than discovered while it runs.
 *  - **Neither** — nothing on this machine records where it came from. Listed
 *    but not selectable, because a checkbox that cannot do anything is the dead
 *    button this whole area is being fixed for.
 *
 * That grouping is also why the plan is fetched before the modal renders
 * anything: which group a provider is in is not knowable from its name.
 */

interface Plan {
  provider: string;
  steps: Array<{ kind: string; target: string; label: string; costly?: boolean }>;
  blocked?: string;
  extension?: { internalName: string; name: string; repositoryUrl?: string };
}

type Group = 'switch' | 'download' | 'stuck';

function groupOf(plan: Plan): Group {
  if (plan.blocked || plan.steps.length === 0) return 'stuck';
  return plan.steps.some((step) => step.costly) ? 'download' : 'switch';
}

export const FixProvidersModal: React.FC<{
  /** The provider names the warning named. */
  providers: string[];
  onClose: () => void;
  /** Called after anything was actually fixed, so the caller can re-run. */
  onFixed: (fixed: string[]) => void;
}> = ({ providers, onClose, onFixed }) => {
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [failures, setFailures] = useState<Array<{ provider: string; error?: string }>>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await window.cloudstream?.planProviderRecoveryBulk?.(providers);
      if (cancelled) return;
      if (!result?.ok || !result.plans) {
        setError(result?.error ?? 'The extension runtime could not be asked about these.');
        setPlans([]);
        return;
      }
      const next = result.plans as Plan[];
      setPlans(next);
      /*
       * Free fixes start ticked; downloads do not. Preselecting a download
       * would spend someone's connection on a decision they never made, and
       * "select all" is one click away for anyone who does want it.
       */
      setChosen(new Set(next.filter((plan) => groupOf(plan) === 'switch').map((p) => p.provider)));
    })();
    return () => {
      cancelled = true;
    };
  }, [providers]);

  const groups = useMemo(() => {
    const out: Record<Group, Plan[]> = { switch: [], download: [], stuck: [] };
    for (const plan of plans ?? []) out[groupOf(plan)].push(plan);
    return out;
  }, [plans]);

  const toggle = useCallback((provider: string) => {
    setChosen((current) => {
      const next = new Set(current);
      if (next.has(provider)) next.delete(provider);
      else next.add(provider);
      return next;
    });
  }, []);

  const toggleGroup = useCallback((group: Group, on: boolean) => {
    setChosen((current) => {
      const next = new Set(current);
      for (const plan of groups[group]) {
        if (on) next.add(plan.provider);
        else next.delete(plan.provider);
      }
      return next;
    });
  }, [groups]);

  const apply = useCallback(async () => {
    const list = [...chosen];
    if (list.length === 0) return;
    setRunning(true);
    setFailures([]);
    setProgress({ done: 0, total: list.length });
    try {
      const result = await window.cloudstream?.recoverProviders?.(list);
      const results = result?.results ?? [];
      const bad = results.filter((row) => !row.ok);
      const good = results.filter((row) => row.ok).map((row) => row.provider);
      setFailures(bad.map((row) => ({ provider: row.provider, error: row.error })));
      if (good.length > 0) onFixed(good);
      /*
       * The modal stays open when anything failed. Closing on partial success
       * would report "fixed" for a run where a third of them did not — and the
       * user would find out by searching again and seeing the same warning.
       */
      if (bad.length === 0) onClose();
    } finally {
      setRunning(false);
      setProgress(null);
    }
  }, [chosen, onFixed, onClose]);

  const downloads = groups.download.filter((plan) => chosen.has(plan.provider)).length;

  const row = (plan: Plan, selectable: boolean) => (
    <li key={plan.provider} className={selectable ? '' : 'fix-modal__row--stuck'}>
      <label>
        <input
          type="checkbox"
          checked={chosen.has(plan.provider)}
          onChange={() => toggle(plan.provider)}
          disabled={!selectable || running}
        />
        <span className="fix-modal__name">{plan.provider}</span>
        {plan.extension && plan.extension.name !== plan.provider && (
          <span className="fix-modal__from">{plan.extension.name}</span>
        )}
      </label>
      {/* The reason, not just the fact — a greyed row with no explanation is
          indistinguishable from a bug in the list. */}
      {plan.blocked && <p className="fix-modal__why">{plan.blocked}</p>}
    </li>
  );

  const section = (group: Group, title: string, hint: string) => {
    const list = groups[group];
    if (list.length === 0) return null;
    const selectable = group !== 'stuck';
    const allOn = selectable && list.every((plan) => chosen.has(plan.provider));
    return (
      <section className="fix-modal__group">
        <header>
          <div>
            <h4>
              {group === 'download' && <Download size={13} />}
              {group === 'switch' && <Power size={13} />}
              {group === 'stuck' && <AlertTriangle size={13} />}
              {title} <span className="fix-modal__count">{list.length}</span>
            </h4>
            <p>{hint}</p>
          </div>
          {selectable && (
            <button
              type="button"
              className="fix-modal__all"
              onClick={() => toggleGroup(group, !allOn)}
              disabled={running}
            >
              {allOn ? 'None' : 'All'}
            </button>
          )}
        </header>
        <ul>{list.map((plan) => row(plan, selectable))}</ul>
      </section>
    );
  };

  return (
    <div className="fix-modal__backdrop" role="dialog" aria-modal="true" aria-label="Fix sources">
      <div className="fix-modal">
        <header className="fix-modal__head">
          <h3>Turn these sources back on</h3>
          <button type="button" onClick={onClose} disabled={running} aria-label="Close">
            <X size={16} />
          </button>
        </header>

        {plans === null ? (
          <div className="fix-modal__loading">
            <Loader2 size={22} className="spin" />
            <p>Working out what each one needs…</p>
          </div>
        ) : (
          <>
            <div className="fix-modal__body">
              {error && (
                <p className="fix-modal__error">
                  <AlertTriangle size={14} /> {error}
                </p>
              )}
              {section(
                'switch',
                'Just switched off',
                'Installed already. Turning these on is instant and costs nothing.'
              )}
              {section(
                'download',
                'Not installed',
                'These have to be downloaded again. Pick the ones you want.'
              )}
              {section(
                'stuck',
                'Nothing recorded',
                'This machine has no record of where these came from, so they cannot be reinstalled from here.'
              )}
              {failures.length > 0 && (
                <section className="fix-modal__group fix-modal__group--failed">
                  <h4>
                    <AlertTriangle size={13} /> Could not be fixed
                    <span className="fix-modal__count">{failures.length}</span>
                  </h4>
                  <ul>
                    {failures.map((row_) => (
                      <li key={row_.provider}>
                        <span className="fix-modal__name">{row_.provider}</span>
                        <p className="fix-modal__why">{row_.error ?? 'No reason was given.'}</p>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>

            <footer className="fix-modal__foot">
              <p className="fix-modal__summary">
                {chosen.size === 0
                  ? 'Nothing selected.'
                  : `${chosen.size} selected${
                      downloads > 0
                        ? ` — ${downloads} need${downloads === 1 ? 's' : ''} downloading`
                        : ''
                    }.`}
              </p>
              <div className="fix-modal__actions">
                <button type="button" className="btn btn-ghost" onClick={onClose} disabled={running}>
                  Close
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => void apply()}
                  disabled={running || chosen.size === 0}
                >
                  {running ? <Loader2 size={15} className="spin" /> : <Check size={15} />}
                  {running
                    ? progress
                      ? `Working… ${progress.done}/${progress.total}`
                      : 'Working…'
                    : `Turn on ${chosen.size}`}
                </button>
              </div>
            </footer>
          </>
        )}
      </div>
    </div>
  );
};
