/**
 * Extension work that runs behind the screen rather than in front of it.
 *
 * The extensions screen used to hold one `busy` key for the whole page, and
 * every Install, Add and Install-all button was disabled while it was set. So
 * installing five extensions was five rounds of click, wait for the download,
 * the translation and the JVM load, then find the next row — and leaving the
 * screen in the meantime lost the progress bar with nothing to say the work was
 * still going.
 *
 * This is a queue in the main process instead. A press enqueues and returns at
 * once; the renderer draws from snapshots of the whole queue, so any number of
 * presses can be pending and the state survives navigating away. Four things
 * about it are load-bearing:
 *
 * - **One job per target.** Pressing Install twice, or Install on a row an
 *   Install-all has already queued, joins the job that exists. Two installs of
 *   one archive racing each other would be two renames onto one file.
 * - **Concurrency is for the network, not the JVM.** Several downloads run at
 *   once; `PluginManager.installPlugin` serialises the part that places the
 *   archive and loads it, because provider loading cannot be parallelised
 *   (providers self-register into a global, and overlapping loads steal each
 *   other's registrations).
 * - **A failed job stays visible with its reason and a retry.** A failure that
 *   vanishes when the next job starts is indistinguishable from success.
 * - **Snapshots are whole state, never deltas** — the repository rule, for the
 *   reason it exists: a renderer rebuilding a queue from events is how two
 *   views of one queue come to disagree.
 *
 * Pure apart from the injected runner, so the scheduling is tested without a
 * JVM, a network or Electron.
 */
import type { SitePlugin } from '../../src/types/plugin';

export type ExtensionJobRequest =
  | { kind: 'install'; plugin: SitePlugin; repositoryUrl: string }
  | { kind: 'update'; internalName: string; name?: string }
  | { kind: 'uninstall'; internalName: string; name?: string }
  | { kind: 'addRepository'; url: string; name?: string }
  | { kind: 'installRepository'; url: string; name?: string; limit?: number };

export type ExtensionJobKind = ExtensionJobRequest['kind'];

export type ExtensionJobState = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

export interface ExtensionJob {
  id: string;
  kind: ExtensionJobKind;
  /**
   * What the job acts on: `ext:<internalName>`, `repo:<url>` or `repo-add:<url>`.
   *
   * Install and update share a target on purpose — both replace one archive,
   * and letting them run side by side is the race the target exists to stop.
   */
  target: string;
  /** A name a person recognises, for the tray. */
  label: string;
  state: ExtensionJobState;
  /** 0–100 while running, when the runner reports it. */
  percent?: number;
  /** What it is doing now, in a few words. */
  step?: string;
  /** The outcome, once finished: success detail or the failure reason. */
  message?: string;
  enqueuedAt: number;
  startedAt?: number;
  finishedAt?: number;
  /** Repository URL this job belongs to, if known. */
  repositoryUrl?: string;
}

export interface ExtensionJobsSnapshot {
  jobs: ExtensionJob[];
  queued: number;
  running: number;
  failed: number;
}

export interface JobOutcome {
  ok: boolean;
  message: string;
}

export type JobProgress = { percent?: number; step?: string };

export type JobRunner = (
  request: ExtensionJobRequest,
  report: (progress: JobProgress) => void
) => Promise<JobOutcome>;

export interface ExtensionJobQueueOptions {
  run: JobRunner;
  /** Jobs running at once. Downloads overlap; the JVM step is serialised below. */
  concurrency?: number;
  /** Receives the whole queue after every change. */
  notify?: (snapshot: ExtensionJobsSnapshot) => void;
  now?: () => number;
}

/** Finished jobs kept so the tray can say what happened, oldest dropped first. */
const MAX_FINISHED = 60;

export const DEFAULT_JOB_CONCURRENCY = 3;

export function targetOf(request: ExtensionJobRequest): string {
  switch (request.kind) {
    case 'install':
      return `ext:${request.plugin.internalName}`;
    case 'update':
    case 'uninstall':
      return `ext:${request.internalName}`;
    // Separate targets: adding is one cheap fetch, and pressing Install all
    // while an Add is still running must install, not quietly join the Add.
    case 'addRepository':
      return `repo-add:${request.url}`;
    case 'installRepository':
      return `repo:${request.url}`;
  }
}

function labelOf(request: ExtensionJobRequest): string {
  switch (request.kind) {
    case 'install':
      return request.plugin.name || request.plugin.internalName;
    case 'update':
    case 'uninstall':
      return request.name || request.internalName;
    case 'addRepository':
    case 'installRepository':
      return request.name || request.url;
  }
}

const isActive = (job: ExtensionJob) => job.state === 'queued' || job.state === 'running';

/**
 * Whether a second request may join an active job on the same target.
 *
 * Install and update both put an archive in place, so a press of either joins
 * the other. Uninstall is the opposite act: joining it to an install would
 * report one as the other, and queuing it behind would race the same file —
 * so it is refused while the other runs, and says why.
 */
function joins(active: ExtensionJobKind, incoming: ExtensionJobKind): boolean {
  if (active === incoming) return true;
  const replaces = (kind: ExtensionJobKind) => kind === 'install' || kind === 'update';
  return replaces(active) && replaces(incoming);
}

const DOING: Record<ExtensionJobKind, string> = {
  install: 'being installed',
  update: 'being updated',
  uninstall: 'being uninstalled',
  addRepository: 'being added',
  installRepository: 'being installed',
};

/** A request the queue would not take, and why. */
export interface RefusedRequest {
  target: string;
  label: string;
  reason: string;
}

export class ExtensionJobQueue {
  private readonly run: JobRunner;
  private readonly concurrency: number;
  private readonly notify?: (snapshot: ExtensionJobsSnapshot) => void;
  private readonly now: () => number;

  private jobs: ExtensionJob[] = [];
  private requests = new Map<string, ExtensionJobRequest>();
  /** Requests for finished jobs, kept so Retry does not need the renderer to resend them. */
  private retained = new Map<string, ExtensionJobRequest>();
  private sequence = 0;
  private idleWaiters: Array<() => void> = [];

  constructor(options: ExtensionJobQueueOptions) {
    this.run = options.run;
    this.concurrency = Math.max(1, options.concurrency ?? DEFAULT_JOB_CONCURRENCY);
    this.notify = options.notify;
    this.now = options.now ?? Date.now;
  }

  /**
   * Adds work and returns at once.
   *
   * A request for a target that already has a queued or running job joins it
   * rather than adding a second; the returned ids name whichever job will do
   * the work, in request order. A request that conflicts with the active job
   * (an uninstall during an install) is refused and listed in `refused`.
   */
  public enqueue(requests: ExtensionJobRequest[]): {
    ids: string[];
    refused: RefusedRequest[];
    snapshot: ExtensionJobsSnapshot;
  } {
    const ids: string[] = [];
    const refused: RefusedRequest[] = [];
    for (const request of requests) {
      const target = targetOf(request);
      const existing = this.jobs.find((job) => job.target === target && isActive(job));
      if (existing && !joins(existing.kind, request.kind)) {
        refused.push({
          target,
          label: labelOf(request),
          reason: `${existing.label} is ${DOING[existing.kind]}. Try again when that finishes.`,
        });
        continue;
      }
      if (existing) {
        ids.push(existing.id);
        continue;
      }
      const id = `job-${++this.sequence}`;
      const repoUrl =
        request.kind === 'install'
          ? request.repositoryUrl
          : request.kind === 'addRepository' || request.kind === 'installRepository'
            ? request.url
            : undefined;
      this.jobs.push({
        id,
        kind: request.kind,
        target,
        label: labelOf(request),
        state: 'queued',
        enqueuedAt: this.now(),
        repositoryUrl: repoUrl,
      });
      this.requests.set(id, request);
      ids.push(id);
    }
    this.pump();
    this.changed();
    return { ids, refused, snapshot: this.snapshot() };
  }

  /** Cancels a job that has not started. A running job is left to finish. */
  public cancel(id: string): ExtensionJobsSnapshot {
    const job = this.jobs.find((entry) => entry.id === id);
    if (job && job.state === 'queued') {
      job.state = 'cancelled';
      job.finishedAt = this.now();
      this.requests.delete(id);
      this.trim();
      this.changed();
      this.settleIfIdle();
    }
    return this.snapshot();
  }

  /** Cancels everything still waiting — "stop after the current ones". */
  public cancelQueued(): ExtensionJobsSnapshot {
    let touched = false;
    for (const job of this.jobs) {
      if (job.state !== 'queued') continue;
      job.state = 'cancelled';
      job.finishedAt = this.now();
      this.requests.delete(job.id);
      touched = true;
    }
    if (touched) {
      this.trim();
      this.changed();
      this.settleIfIdle();
    }
    return this.snapshot();
  }

  /** Runs a failed or cancelled job again, as a new job for the same target. */
  public retry(id: string): ExtensionJobsSnapshot {
    const job = this.jobs.find((entry) => entry.id === id);
    const request = job ? this.retained.get(id) : undefined;
    if (!job || !request || isActive(job)) return this.snapshot();
    this.jobs = this.jobs.filter((entry) => entry.id !== id);
    this.retained.delete(id);
    return this.enqueue([request]).snapshot;
  }

  /** Forgets finished jobs. Queued and running ones are untouched. */
  public clearFinished(): ExtensionJobsSnapshot {
    const before = this.jobs.length;
    this.jobs = this.jobs.filter((job) => {
      if (isActive(job)) return true;
      this.retained.delete(job.id);
      return false;
    });
    if (this.jobs.length !== before) this.changed();
    return this.snapshot();
  }

  /**
   * Progress for whatever job currently holds a target.
   *
   * Keyed on the target rather than the job id because the reporter is the
   * plugin manager's install-progress event, which knows the extension and
   * nothing about queues. Updates go through that path too, so one listener
   * covers both.
   */
  public progress(target: string, progress: JobProgress): void {
    const job = this.jobs.find((entry) => entry.target === target && entry.state === 'running');
    if (!job) return;
    if (progress.percent !== undefined) job.percent = Math.max(0, Math.min(100, progress.percent));
    if (progress.step) job.step = progress.step;
    this.changed();
  }

  public snapshot(): ExtensionJobsSnapshot {
    const jobs = this.jobs.map((job) => ({ ...job }));
    return {
      jobs,
      queued: jobs.filter((job) => job.state === 'queued').length,
      running: jobs.filter((job) => job.state === 'running').length,
      failed: jobs.filter((job) => job.state === 'failed').length,
    };
  }

  /** Resolves once nothing is queued or running. For tests and shutdown. */
  public whenIdle(): Promise<void> {
    if (!this.jobs.some(isActive)) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  private pump(): void {
    let running = this.jobs.filter((job) => job.state === 'running').length;
    for (const job of this.jobs) {
      if (running >= this.concurrency) break;
      if (job.state !== 'queued') continue;
      const request = this.requests.get(job.id);
      if (!request) continue;
      running++;
      void this.start(job, request);
    }
  }

  private async start(job: ExtensionJob, request: ExtensionJobRequest): Promise<void> {
    job.state = 'running';
    job.startedAt = this.now();
    job.percent = 0;
    this.changed();

    let outcome: JobOutcome;
    try {
      outcome = await this.run(request, (progress) => this.progress(job.target, progress));
    } catch (error) {
      outcome = {
        ok: false,
        message: error instanceof Error && error.message ? error.message : String(error),
      };
    }

    job.state = outcome.ok ? 'done' : 'failed';
    job.message = outcome.message;
    job.percent = outcome.ok ? 100 : job.percent;
    job.step = undefined;
    job.finishedAt = this.now();
    this.requests.delete(job.id);
    this.retained.set(job.id, request);
    this.trim();
    this.changed();
    this.pump();
    this.settleIfIdle();
  }

  private trim(): void {
    const finished = this.jobs.filter((job) => !isActive(job));
    const excess = finished.length - MAX_FINISHED;
    if (excess <= 0) return;
    const drop = new Set(
      finished
        .sort((a, b) => (a.finishedAt ?? 0) - (b.finishedAt ?? 0))
        .slice(0, excess)
        .map((job) => job.id)
    );
    this.jobs = this.jobs.filter((job) => !drop.has(job.id));
    for (const id of drop) this.retained.delete(id);
  }

  private settleIfIdle(): void {
    if (this.jobs.some(isActive)) return;
    const waiters = this.idleWaiters;
    this.idleWaiters = [];
    for (const resolve of waiters) resolve();
  }

  private changed(): void {
    this.notify?.(this.snapshot());
  }
}
