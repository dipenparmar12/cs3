import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconcileRestoredTask } from './restoredTask.ts';
import { DownloadState, type DownloadTask } from '../../src/types/download.ts';

/**
 * A restored download record never claims a file it cannot see. The failure
 * this guards is silent: "Completed" beside a film that is not on this disk,
 * found out at the moment someone sits down to watch it.
 */

function task(state: DownloadTask['state'], totalBytes = 1000): DownloadTask {
  return {
    id: 't',
    parentId: 'p',
    title: 'Film',
    targetFilePath: 'D:/Movies/Film.mkv',
    link: { url: 'https://host/file', name: 'x' } as DownloadTask['link'],
    headers: {},
    bytesDownloaded: totalBytes,
    totalBytes,
    downloadSpeed: 4000,
    etaSeconds: 12,
    state,
    providerName: 'P',
    createdTime: 1,
    retryCount: 3,
  };
}

const disk = (files: Record<string, number>) => ({ size: (p: string) => files[p] ?? null });

test('a finished download whose file is here at the expected size stays finished', () => {
  const { task: out, verdict } = reconcileRestoredTask(task('Completed'), disk({ 'D:/Movies/Film.mkv': 995 }));
  assert.equal(verdict, 'verified');
  assert.equal(out.state, DownloadState.Completed);
  assert.equal(out.downloadSpeed, 0);
  assert.equal(out.retryCount, 0);
});

test('a finished download whose file is missing is listed, never claimed', () => {
  const { task: out, verdict } = reconcileRestoredTask(task('Completed'), disk({}));
  assert.equal(verdict, 'missing');
  assert.equal(out.state, DownloadState.Failed);
  assert.equal(out.bytesDownloaded, 0);
  assert.match(out.errorMessage ?? '', /not on this computer/);
});

test('a finished download whose file is short is not promoted', () => {
  const { task: out } = reconcileRestoredTask(task('Completed'), disk({ 'D:/Movies/Film.mkv': 400 }));
  assert.equal(out.state, DownloadState.Failed);
  assert.match(out.errorMessage ?? '', /smaller/);
});

test('a partial file is paused, so resuming proves it matches before using it', () => {
  const { task: out, verdict } = reconcileRestoredTask(
    task('Downloading'),
    disk({ 'D:/Movies/Film.mkv.part': 300 })
  );
  assert.equal(verdict, 'partial');
  assert.equal(out.state, DownloadState.Paused);
  assert.equal(out.bytesDownloaded, 300);
});

test('a file at the target of an unfinished download is never taken as finished', () => {
  const { task: out } = reconcileRestoredTask(task('Paused'), disk({ 'D:/Movies/Film.mkv': 1000 }));
  assert.notEqual(out.state, DownloadState.Completed);
});

test('an unfinished download with nothing on disk says it needs downloading again', () => {
  const { task: out } = reconcileRestoredTask(task('Queued'), disk({}));
  assert.equal(out.state, DownloadState.Failed);
  assert.match(out.errorMessage ?? '', /before it had finished/);
});

test('a size the source never sent is not held against a finished file', () => {
  const { verdict } = reconcileRestoredTask(task('Completed', 0), disk({ 'D:/Movies/Film.mkv': 12345 }));
  assert.equal(verdict, 'verified');
});
