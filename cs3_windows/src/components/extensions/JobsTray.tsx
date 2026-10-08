/**
 * What the extension queue is doing, above everything else on the screen.
 *
 * Collapsed to one line by default — "Installing 2 · 5 waiting" — because the
 * rows themselves already show their own state; the tray exists for the work
 * that is *not* on screen (an Install-all's forty extensions, an update started
 * from another tab) and for the failures, which stay here with a Retry until
 * cleared.
 */
import React, { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, ChevronDown, ChevronUp, Clock, Loader2, RotateCcw, X } from 'lucide-react';
import { ProgressBar } from './primitives';
import { useExtensionJobs, type ExtensionJob } from './useExtensionJobs';
import { useReveal } from '../../utils/ExperienceModeContext';
import { plainMessage } from '../../utils/experienceMode';

const KIND_LABEL: Record<ExtensionJob['kind'], string> = {
  install: 'Install',
  update: 'Update',
  uninstall: 'Uninstall',
  addRepository: 'Add repository',
  installRepository: 'Install repository',
};

function summary(queued: number, running: number, failed: number, done: number): string {
  const parts: string[] = [];
  if (running > 0) parts.push(`Working on ${running}`);
  if (queued > 0) parts.push(`${queued} waiting`);
  if (failed > 0) parts.push(`${failed} failed`);
  if (parts.length === 0 && done > 0) parts.push(`All done — ${done} finished`);
  return parts.join(' · ');
}

/**
 * The outcome in words a viewer can use.
 *
 * An install's own message is the runtime's verdict — "every referenced type
 * resolves against the runtime classpath" — which is the right thing for a
 * developer and noise for everyone else. Standard mode says what happened and
 * keeps the original one hover away; developer mode shows it as written.
 */
function outcomeText(job: ExtensionJob, technical: boolean): string | undefined {
  if (!job.message || technical) return job.message;
  if (job.state === 'done') {
    if (job.kind === 'install') return 'Installed';
    if (job.kind === 'update') return 'Updated';
    return job.message;
  }
  return plainMessage(job.message).summary;
}

const JobRow: React.FC<{
  job: ExtensionJob;
  onCancel: (id: string) => void;
  onRetry: (id: string) => void;
}> = ({ job, onCancel, onRetry }) => {
  const technical = useReveal('technical');
  const outcome = outcomeText(job, technical);
  return (
    <li className={`ext-job ext-job--${job.state}`}>
      <span className="ext-job__icon" aria-hidden>
        {job.state === 'queued' ? <Clock size={13} /> : null}
        {job.state === 'running' ? <Loader2 size={13} className="spin" /> : null}
        {job.state === 'done' ? <CheckCircle2 size={13} /> : null}
        {job.state === 'failed' ? <AlertCircle size={13} /> : null}
        {job.state === 'cancelled' ? <X size={13} /> : null}
      </span>
      <span className="ext-job__main">
        <span className="ext-job__label">
          {job.label}
          <span className="ext-job__kind">{KIND_LABEL[job.kind]}</span>
        </span>
        {job.state === 'running' ? (
          <ProgressBar step={job.step ?? 'Starting…'} percent={job.percent ?? 0} />
        ) : null}
        {job.state === 'queued' ? <span className="ext-job__note">Waiting for a free slot</span> : null}
        {job.state === 'cancelled' ? <span className="ext-job__note">Cancelled</span> : null}
        {(job.state === 'done' || job.state === 'failed') && outcome ? (
          <span className="ext-job__note" title={job.message}>
            {outcome}
          </span>
        ) : null}
      </span>
      {job.state === 'queued' ? (
        <button
          type="button"
          className="btn btn-secondary btn-sm btn-icon"
          aria-label={`Cancel ${job.label}`}
          title="Cancel"
          onClick={() => onCancel(job.id)}
        >
          <X size={12} />
        </button>
      ) : null}
      {job.state === 'failed' || job.state === 'cancelled' ? (
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => onRetry(job.id)}>
          <RotateCcw size={12} /> Retry
        </button>
      ) : null}
    </li>
  );
};

export const JobsTray: React.FC = () => {
  const { snapshot, cancel, cancelQueued, retry, clearFinished } = useExtensionJobs();
  const [open, setOpen] = useState(false);

  const done = snapshot.jobs.filter((job) => job.state === 'done').length;
  const finished = snapshot.jobs.length - snapshot.queued - snapshot.running;
  const busy = snapshot.queued + snapshot.running > 0;

  // A failure opens the list: it is the one outcome that needs a decision.
  useEffect(() => {
    if (snapshot.failed > 0) setOpen(true);
  }, [snapshot.failed]);

  if (snapshot.jobs.length === 0) return null;

  // Newest first, with anything still working ahead of what has finished.
  const ordered = [...snapshot.jobs].sort((a, b) => {
    const rank = (job: ExtensionJob) =>
      job.state === 'running' ? 0 : job.state === 'failed' ? 1 : job.state === 'queued' ? 2 : 3;
    return rank(a) - rank(b) || b.enqueuedAt - a.enqueuedAt;
  });

  return (
    <section className={`ext-jobs${busy ? ' ext-jobs--busy' : ''}`} aria-live="polite">
      <div className="ext-jobs__head">
        {busy ? <Loader2 size={14} className="spin" /> : <CheckCircle2 size={14} />}
        <span className="ext-jobs__summary">
          {summary(snapshot.queued, snapshot.running, snapshot.failed, done)}
        </span>
        <span className="ext-jobs__hint">Keeps going if you leave this screen</span>
        <span className="ext-bulk__spacer" />
        {snapshot.queued > 0 ? (
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void cancelQueued()}>
            Cancel waiting
          </button>
        ) : null}
        {finished > 0 ? (
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void clearFinished()}>
            Clear finished
          </button>
        ) : null}
        <button
          type="button"
          className="btn btn-secondary btn-sm btn-icon"
          aria-expanded={open}
          aria-label={open ? 'Hide activity' : 'Show activity'}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </button>
      </div>
      {open ? (
        <ul className="ext-jobs__list">
          {ordered.map((job) => (
            <JobRow
              key={job.id}
              job={job}
              onCancel={(id) => void cancel(id)}
              onRetry={(id) => void retry(id)}
            />
          ))}
        </ul>
      ) : null}
    </section>
  );
};
