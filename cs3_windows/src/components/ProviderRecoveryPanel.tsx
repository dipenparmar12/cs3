import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Download,
  Loader2,
  Power,
  PowerOff,
  Search,
} from 'lucide-react';

/**
 * The panel shown when a saved page names a provider that cannot answer.
 *
 * It replaced a button that did nothing, and the reason it did nothing is worth
 * keeping in view: it called `setProviderEnabled(name, true)`, which is one
 * third of a four-part gate. A provider answers only when it, its extension,
 * its repository and the adult gate all allow it — so on the ordinary
 * post-restore state the press succeeded, changed nothing, and returned the
 * user to the same message. On a machine where the extension was never
 * installed there was not even a switch to flip.
 *
 * ## It asks before it acts
 *
 * The fix can be a repository fetch and an extension download, so the panel
 * shows the plan — every step, in order, with the costly ones marked — before
 * anything runs. `planProviderRecovery` changes nothing; `recoverProvider`
 * does. A button that silently spent a minute of somebody's connection would
 * be a different failure, not a fixed one.
 *
 * ## It reports what actually happened
 *
 * `recoverProvider` verifies against the same predicate the rest of the app
 * uses rather than inferring success from having run its steps — the whole
 * point being that the previous version reported success and left the provider
 * unreachable. When it still cannot answer, the reason is the one
 * `explainMissingProvider` gives, which names the responsible switch or file.
 */

type StepKind =
  | 'add-repository'
  | 'install-extension'
  | 'enable-repository'
  | 'enable-extension'
  | 'enable-provider';

interface RecoveryStep {
  kind: StepKind;
  target: string;
  label: string;
  costly?: boolean;
}

interface RecoveryPlan {
  provider: string;
  steps: RecoveryStep[];
  blocked?: string;
  extension?: { internalName: string; name: string; repositoryUrl?: string };
}

export const ProviderRecoveryPanel: React.FC<{
  provider: string;
  /** The title being opened, for the "look elsewhere" escape hatch. */
  title: string;
  onBack: () => void;
  onSearch?: (query: string) => void;
  /** Called once the provider answers again, so the page can load. */
  onRecovered: () => void;
  /** The underlying failure, shown when there is nothing to recover. */
  reason?: string | null;
}> = ({ provider, title, onBack, onSearch, onRecovered, reason }) => {
  const [plan, setPlan] = useState<RecoveryPlan | null>(null);
  const [planning, setPlanning] = useState(true);
  const [running, setRunning] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  /** Which step is being worked on, so a long install is not a frozen button. */
  const [progress, setProgress] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setPlanning(true);
    setFailure(null);
    void (async () => {
      const result = await window.cloudstream?.planProviderRecovery?.(provider);
      if (cancelled) return;
      if (result?.ok && result.plan) setPlan(result.plan as RecoveryPlan);
      else setFailure(result?.error ?? 'The extension runtime could not be asked about this.');
      setPlanning(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [provider]);

  const run = useCallback(async () => {
    if (!plan || plan.steps.length === 0) return;
    setRunning(true);
    setFailure(null);
    /*
     * The label of the first costly step, not a generic "working…". An
     * extension install is tens of seconds and the difference between "Please
     * wait" and "Installing NetMirror" is whether the user believes the app has
     * hung.
     */
    setProgress(plan.steps[0]?.label ?? null);
    try {
      const result = await window.cloudstream?.recoverProvider?.(provider);
      if (result?.ok) {
        onRecovered();
        return;
      }
      setFailure(result?.error ?? 'The provider still could not be reached.');
      // Re-plan: some steps may have succeeded, so what is left has changed.
      const next = await window.cloudstream?.planProviderRecovery?.(provider);
      if (next?.ok && next.plan) setPlan(next.plan as RecoveryPlan);
    } finally {
      setRunning(false);
      setProgress(null);
    }
  }, [plan, provider, onRecovered]);

  const searchInstead = onSearch ? (
    <button
      className="recovery-panel__link"
      onClick={() => onSearch(title)}
      disabled={running}
      type="button"
    >
      <Search size={14} /> Search other providers for “{title}”
    </button>
  ) : null;

  if (planning) {
    return (
      <div className="recovery-panel">
        <Loader2 size={26} className="spin" />
        <p className="recovery-panel__lede">Working out why {provider} cannot answer…</p>
      </div>
    );
  }

  const actionable = plan && !plan.blocked && plan.steps.length > 0;
  const costly = plan?.steps.some((step) => step.costly) ?? false;

  return (
    <div className="recovery-panel">
      <div className={`recovery-panel__badge${actionable ? '' : ' recovery-panel__badge--dead'}`}>
        {actionable ? <PowerOff size={28} /> : <AlertTriangle size={28} />}
      </div>

      <div className="recovery-panel__head">
        <h3>
          {actionable ? `${provider} is not ready` : `${provider} cannot be reached`}
        </h3>
        <p>
          {plan?.blocked ??
            failure ??
            (actionable
              ? `This title was found by ${provider}${
                  plan?.extension && plan.extension.name !== provider
                    ? `, from the ${plan.extension.name} extension`
                    : ''
                }. Putting it back takes ${plan!.steps.length} step${
                  plan!.steps.length === 1 ? '' : 's'
                }:`
              : (reason ??
                `${provider} looks enabled, so the problem is elsewhere — the site, or this title.`))}
        </p>
      </div>

      {actionable && (
        <ol className="recovery-panel__steps">
          {plan!.steps.map((step) => (
            <li key={`${step.kind}:${step.target}`}>
              {step.costly ? <Download size={14} /> : <Check size={14} />}
              <span>{step.label}</span>
              {/* Named rather than implied: this one goes to the network. */}
              {step.costly && <em>downloads</em>}
            </li>
          ))}
        </ol>
      )}

      {actionable && costly && (
        <p className="recovery-panel__note">
          Downloading an extension takes a moment and uses your connection.
        </p>
      )}

      {failure && actionable && (
        <p className="recovery-panel__failure" role="status">
          <AlertTriangle size={14} /> {failure}
        </p>
      )}

      <div className="recovery-panel__actions">
        {actionable && (
          <button
            className="btn btn-primary"
            onClick={() => void run()}
            disabled={running}
            type="button"
          >
            {running ? <Loader2 size={16} className="spin" /> : <Power size={16} />}
            {running ? (progress ?? 'Working…') : `Fix and open ${title}`}
          </button>
        )}
        <button className="btn btn-ghost" onClick={onBack} disabled={running} type="button">
          <ArrowLeft size={16} /> Back
        </button>
      </div>

      {searchInstead}
    </div>
  );
};
