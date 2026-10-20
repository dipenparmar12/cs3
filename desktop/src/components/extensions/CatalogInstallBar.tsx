import React, { useMemo, useState } from 'react';
import { AlertTriangle, Check, Download, Loader2, RotateCcw } from 'lucide-react';
import { Button, Dialog, DialogActions } from '../ui';
import { describeExclusions, type CatalogInstallPlan } from './catalogInstall';
import type { ExtensionJob } from './useExtensionJobs';

/**
 * "Install all" for a Browse search: one line saying what matched and what it
 * leaves out, one button, and — once pressed — how that batch is getting on,
 * with a retry for whatever failed. A large batch is confirmed first, because
 * a search for a language can match a hundred extensions.
 */

const CONFIRM_ABOVE = 10;

const active = (job: ExtensionJob | null) => job !== null && (job.state === 'queued' || job.state === 'running');

export const CatalogInstallBar: React.FC<{
  plan: CatalogInstallPlan;
  jobFor(target: string): ExtensionJob | null;
  onInstall(plan: CatalogInstallPlan): void;
  onRetry(ids: string[]): void;
}> = ({ plan, jobFor, onInstall, onRetry }) => {
  const [confirming, setConfirming] = useState(false);
  /** The targets the last press queued, so its progress can be told apart from other work. */
  const [batch, setBatch] = useState<string[]>([]);

  const progress = useMemo(() => {
    const jobs = batch.map((target) => jobFor(target)).filter((job): job is ExtensionJob => job !== null);
    return {
      total: batch.length,
      running: jobs.filter(active).length,
      done: jobs.filter((job) => job.state === 'done').length,
      failed: jobs.filter((job) => job.state === 'failed'),
    };
  }, [batch, jobFor]);

  const count = plan.items.length;
  const unread = plan.unread.length;
  const exclusions = describeExclusions(plan.excluded);
  const working = progress.running > 0;
  // A whole unread repository is an unknown number of extensions, so it is confirmed too.
  const needsConfirm = count > CONFIRM_ABOVE || unread > 0;

  const start = () => {
    setConfirming(false);
    setBatch([
      ...plan.items.map((item) => `ext:${item.plugin.internalName}`),
      ...plan.unread.map((repository) => `repo:${repository.url}`),
    ]);
    onInstall(plan);
  };

  if (count === 0 && unread === 0 && progress.total === 0) return null;

  const what =
    count > 0
      ? `${count} extension${count === 1 ? '' : 's'}`
      : `${unread} repositor${unread === 1 ? 'y' : 'ies'}`;

  return (
    <div className="ext-install-bar" role="status">
      {working ? (
        <span className="ext-install-bar__text">
          <Loader2 size={14} className="spin" aria-hidden />
          Installing {progress.done + progress.failed.length + 1} of {progress.total}
          {progress.failed.length > 0 ? ` · ${progress.failed.length} failed` : ''}
        </span>
      ) : progress.total > 0 && count === 0 && unread === 0 ? (
        <span className="ext-install-bar__text">
          {progress.failed.length > 0 ? (
            <AlertTriangle size={14} className="ext-install-bar__warn" aria-hidden />
          ) : (
            <Check size={14} className="ext-install-bar__ok" aria-hidden />
          )}
          Installed {progress.done} of {progress.total}
          {progress.failed.length > 0 ? ` · ${progress.failed.length} failed` : ''}
        </span>
      ) : (
        <span className="ext-install-bar__text">
          <strong>{what} to install</strong>
          <span className="ext-install-bar__meta">
            {[
              count > 0 && plan.repositories > 1 ? `from ${plan.repositories} repositories` : null,
              count > 0 && unread > 0 ? `plus ${unread} repositor${unread === 1 ? 'y' : 'ies'} read when installed` : null,
              exclusions ? `left out: ${exclusions}` : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </span>
      )}

      <span className="ext-install-bar__actions">
        {!working && progress.failed.length > 0 && (
          <Button size="compact" variant="ambient" icon={RotateCcw} onClick={() => onRetry(progress.failed.map((job) => job.id))}>
            Retry failed
          </Button>
        )}
        {(count > 0 || unread > 0) && (
          <Button
            size="compact"
            variant="prominent"
            icon={Download}
            disabled={working}
            onClick={() => (needsConfirm ? setConfirming(true) : start())}
          >
            Install all{count > 0 ? ` ${count}` : ''}
          </Button>
        )}
      </span>

      {confirming && (
        <Dialog
          size="sm"
          icon={<Download size={18} />}
          title={`Install ${what}?`}
          description="They download in the background — you can keep browsing."
          onClose={() => setConfirming(false)}
          footer={
            <DialogActions>
              <Button onClick={() => setConfirming(false)}>Cancel</Button>
              <Button variant="prominent" onClick={start}>
                Install
              </Button>
            </DialogActions>
          }
        >
          <ul className="ext-install-bar__summary">
            {summarise(plan).map(([name, n]) => (
              <li key={name}>
                <span>{name}</span>
                <span>{n === null ? 'all' : n}</span>
              </li>
            ))}
          </ul>
          {exclusions ? <p className="ext-install-bar__meta">Left out: {exclusions}.</p> : null}
        </Dialog>
      )}
    </div>
  );
};

/** Per repository, how many it contributes (`null`: the whole repository, not yet read). */
function summarise(plan: CatalogInstallPlan): Array<[string, number | null]> {
  const counts = new Map<string, number | null>();
  for (const item of plan.items) counts.set(item.repositoryName, ((counts.get(item.repositoryName) as number) ?? 0) + 1);
  for (const repository of plan.unread) counts.set(repository.name, null);
  return [...counts.entries()];
}
