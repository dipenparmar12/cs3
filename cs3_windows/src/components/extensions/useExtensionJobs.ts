/**
 * The extension job queue, as the renderer sees it.
 *
 * One subscription for the whole app, held at module level rather than per
 * component: the queue outlives the extensions screen — that is the point of it
 * — and the sidebar needs to say "installing 3" while the viewer is somewhere
 * else. Each reader gets the same snapshot through `useSyncExternalStore`, so
 * the tray, a row's button and the sidebar badge cannot disagree.
 */
import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import {
  targetOf,
  type ExtensionJob,
  type ExtensionJobRequest,
  type ExtensionJobsSnapshot,
} from '../../../electron/cs3/extensionJobs';

export type { ExtensionJob, ExtensionJobRequest, ExtensionJobsSnapshot };
export { targetOf };

const EMPTY: ExtensionJobsSnapshot = { jobs: [], queued: 0, running: 0, failed: 0 };

let current: ExtensionJobsSnapshot = EMPTY;
let started = false;
const listeners = new Set<() => void>();

function publish(next: ExtensionJobsSnapshot | null | undefined): void {
  if (!next || !Array.isArray(next.jobs)) return;
  current = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  if (!started && window.cloudstream?.onExtensionJobs) {
    started = true;
    window.cloudstream.onExtensionJobs(publish);
    void window.cloudstream.getExtensionJobs?.().then(publish).catch(() => undefined);
  }
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const read = () => current;

/**
 * The job that currently speaks for a target.
 *
 * An active job wins over a finished one, and the newest wins among either —
 * a row pressed again after a failure shows the retry, not the old failure.
 */
export function jobForTarget(snapshot: ExtensionJobsSnapshot, target: string): ExtensionJob | null {
  let best: ExtensionJob | null = null;
  for (const job of snapshot.jobs) {
    if (job.target !== target) continue;
    const active = job.state === 'queued' || job.state === 'running';
    const bestActive = best && (best.state === 'queued' || best.state === 'running');
    if (!best || (active && !bestActive) || (active === bestActive && job.enqueuedAt >= best.enqueuedAt)) {
      best = job;
    }
  }
  return best;
}

export function useExtensionJobs() {
  const snapshot = useSyncExternalStore(subscribe, read);

  const enqueue = useCallback(async (requests: ExtensionJobRequest[]) => {
    if (requests.length === 0) return;
    const response = await window.cloudstream?.enqueueExtensionJobs?.(requests);
    publish(response?.snapshot);
  }, []);

  const cancel = useCallback(async (id: string) => {
    publish(await window.cloudstream?.cancelExtensionJob?.(id));
  }, []);

  const cancelQueued = useCallback(async () => {
    publish(await window.cloudstream?.cancelQueuedExtensionJobs?.());
  }, []);

  const retry = useCallback(async (id: string) => {
    publish(await window.cloudstream?.retryExtensionJob?.(id));
  }, []);

  const clearFinished = useCallback(async () => {
    publish(await window.cloudstream?.clearFinishedExtensionJobs?.());
  }, []);

  const jobFor = useCallback((target: string) => jobForTarget(snapshot, target), [snapshot]);

  return { snapshot, jobFor, enqueue, cancel, cancelQueued, retry, clearFinished };
}

/**
 * Calls `onSettled` when jobs finish, coalesced.
 *
 * The screen re-reads the provider tree after a mutation rather than predicting
 * it (see `useExtensionCatalog`); an Install-all finishing forty jobs in a
 * minute should cost a handful of re-reads, not forty.
 */
export function useOnJobsSettled(snapshot: ExtensionJobsSnapshot, onSettled: () => void): void {
  const seen = useRef<Set<string> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callback = useRef(onSettled);
  callback.current = onSettled;

  useEffect(() => {
    const finished = new Set(
      snapshot.jobs.filter((job) => job.state === 'done' || job.state === 'failed').map((job) => job.id)
    );
    // The first snapshot is history, not news.
    if (seen.current === null) {
      seen.current = finished;
      return;
    }
    const fresh = [...finished].some((id) => !seen.current!.has(id));
    seen.current = finished;
    if (!fresh || timer.current) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      callback.current();
    }, 400);
  }, [snapshot]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );
}
