import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BackupService, BACKUP_FORMAT_VERSION, type BackupSection } from './backupService.ts';
import type { BackupPart, PartChange } from './backup/collection.ts';
import { decideRow } from './backup/collection.ts';
import type { RestorePlan } from '../../src/types/backup.ts';

/**
 * The backup framework, tested because every way it fails is quiet.
 *
 * A backup is written once and read months later, on another machine, usually
 * because something has already gone wrong. A section that silently restores
 * nothing, or a mode that removes what it promised to keep, is discovered at
 * the moment the data was needed. The sections here are in-memory stand-ins;
 * what is pinned is the contract between a section and the service.
 */

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cs3-backup-'));
let counter = 0;
const fileIn = (name: string) => path.join(tmp, `${counter++}-${name}`);

interface Row {
  id: string;
  value: string;
  at?: number;
}

/** A section over a mutable array, recording every commit. */
function rows(
  id: string,
  initial: Row[],
  options: Partial<BackupPart<Row>> & { schemaVersion?: number; migrations?: BackupSection['migrations'] } = {}
) {
  const state = { rows: [...initial], commits: [] as PartChange<Row>[] };
  const { schemaVersion, migrations, ...partOptions } = options;
  const part: BackupPart<Row> = {
    id: 'rows',
    label: 'rows',
    local: () => state.rows,
    identify: (row) => (typeof row?.id === 'string' ? row.id : null),
    describe: (row) => row.id,
    updatedAt: (row) => row.at,
    commit: (change) => {
      state.commits.push(change);
      state.rows = [...change.next];
    },
    ...partOptions,
  };
  const section: BackupSection = {
    id,
    label: id,
    description: '',
    group: 'content',
    schemaVersion: schemaVersion ?? 1,
    migrations,
    parts: [part],
  };
  return { section, state };
}

function service(sections: BackupSection[], recoveryDir = fs.mkdtempSync(path.join(tmp, 'rec-'))) {
  return new BackupService(sections, '1.2.3', 'win32 10.0', { recoveryDir });
}

const plan = (mode: RestorePlan['mode'], sections: string[], extra: Partial<RestorePlan> = {}): RestorePlan => ({
  mode,
  sections,
  ...extra,
});

function section(summary: { sections: Array<{ id: string }> }, id: string) {
  const found = summary.sections.find((row) => row.id === id);
  assert.ok(found, `no row for ${id}`);
  return found as never as {
    added: number;
    updated: number;
    removed: number;
    unchanged: number;
    kept: number;
    skipped: number;
    status: string;
    reason?: string;
    failed: Array<{ label: string; reason: string }>;
    notes: string[];
  };
}

test('a backup round-trips every section it carries', async () => {
  const library = rows('library', [{ id: 'a', value: '1' }, { id: 'b', value: '2' }]);
  const history = rows('history', [{ id: 'h', value: 'x' }]);
  const file = fileIn('round-trip.json');
  assert.equal(service([library.section, history.section]).write(file).ok, true);

  library.state.rows = [];
  history.state.rows = [];
  const summary = await service([library.section, history.section]).restore(
    file,
    plan('smart', ['library', 'history'])
  );
  assert.equal(summary.ok, true);
  assert.equal(section(summary, 'library').added, 2);
  assert.equal(section(summary, 'history').added, 1);
  assert.deepEqual(library.state.rows.map((row) => row.id), ['a', 'b']);
});

test('smart restore adds new rows, takes the newer copy and leaves identical ones alone', async () => {
  const s = rows('s', [
    { id: 'same', value: 'x', at: 1 },
    { id: 'localNewer', value: 'mine', at: 9 },
    { id: 'backupNewer', value: 'old', at: 1 },
    { id: 'onlyHere', value: 'kept', at: 1 },
  ]);
  const file = fileIn('smart.json');
  const writer = rows('s', [
    { id: 'same', value: 'x', at: 1 },
    { id: 'localNewer', value: 'theirs', at: 2 },
    { id: 'backupNewer', value: 'new', at: 5 },
    { id: 'fresh', value: 'added', at: 1 },
  ]);
  service([writer.section]).write(file);

  const summary = await service([s.section]).restore(file, plan('smart', ['s']));
  const row = section(summary, 's');
  assert.deepEqual([row.added, row.updated, row.unchanged, row.kept, row.removed], [1, 1, 1, 1, 0]);
  const byId = Object.fromEntries(s.state.rows.map((r) => [r.id, r.value]));
  assert.deepEqual(byId, { same: 'x', localNewer: 'mine', backupNewer: 'new', onlyHere: 'kept', fresh: 'added' });
});

test('a genuine conflict is kept by default, and the reader can choose per category or per row', async () => {
  const make = () =>
    rows('s', [
      { id: 'a', value: 'here' },
      { id: 'b', value: 'here' },
    ]);
  const file = fileIn('conflict.json');
  service([
    rows('s', [
      { id: 'a', value: 'there' },
      { id: 'b', value: 'there' },
    ]).section,
  ]).write(file);

  const analysis = service([make().section]).analyze(file);
  assert.ok(analysis.ok);
  const analysed = analysis.analysis.sections[0];
  assert.equal(analysed.conflictTotal, 2);
  assert.deepEqual(analysed.conflicts.map((item) => item.key), ['rows:a', 'rows:b']);

  const untouched = make();
  await service([untouched.section]).restore(file, plan('smart', ['s']));
  assert.deepEqual(untouched.state.rows.map((r) => r.value), ['here', 'here']);

  const chosen = make();
  const summary = await service([chosen.section]).restore(
    file,
    plan('smart', ['s'], { resolutions: { s: { default: 'backup', items: { 'rows:b': 'skip' } } } })
  );
  assert.deepEqual(chosen.state.rows.map((r) => r.value), ['there', 'here']);
  assert.equal(section(summary, 's').updated, 1);
  assert.equal(section(summary, 's').skipped, 1);
});

test('keep both adds a copy under a fresh identity where the part supports it', async () => {
  const duplicate = (row: Row, taken: Set<string>) => {
    let n = 2;
    while (taken.has(`${row.id}-${n}`)) n++;
    return { ...row, id: `${row.id}-${n}` };
  };
  const s = rows('s', [{ id: 'a', value: 'here' }], { duplicate });
  const file = fileIn('both.json');
  service([rows('s', [{ id: 'a', value: 'there' }]).section]).write(file);

  const analysis = service([s.section]).analyze(file);
  assert.ok(analysis.ok && analysis.analysis.sections[0].canKeepBoth);
  await service([s.section]).restore(file, plan('smart', ['s'], { resolutions: { s: { default: 'both' } } }));
  assert.deepEqual(
    s.state.rows.map((r) => [r.id, r.value]),
    [
      ['a', 'here'],
      ['a-2', 'there'],
    ]
  );
});

test('merge takes the backup on a conflict and never removes anything', async () => {
  const s = rows('s', [
    { id: 'a', value: 'here' },
    { id: 'mine', value: 'only here' },
  ]);
  const file = fileIn('merge.json');
  service([rows('s', [{ id: 'a', value: 'there' }]).section]).write(file);
  await service([s.section]).restore(file, plan('merge', ['s']));
  assert.deepEqual(s.state.rows, [
    { id: 'a', value: 'there' },
    { id: 'mine', value: 'only here' },
  ]);
});

test('a part can keep its own copy under merge, for credentials that are this machine’s', async () => {
  const s = rows('s', [{ id: 'jackett', value: 'my-key' }], { mergePrefers: 'local' });
  const file = fileIn('merge-local.json');
  service([rows('s', [{ id: 'jackett', value: 'stale-key' }]).section]).write(file);
  await service([s.section]).restore(file, plan('merge', ['s']));
  assert.equal(s.state.rows[0].value, 'my-key');
});

test('replace makes a section match the file, which merge can never do', async () => {
  const s = rows('s', [
    { id: 'a', value: 'here', at: 9 },
    { id: 'mine', value: 'only here' },
  ]);
  const file = fileIn('replace.json');
  service([rows('s', [{ id: 'a', value: 'there', at: 1 }]).section]).write(file);
  const summary = await service([s.section]).restore(file, plan('replace', ['s']));
  assert.deepEqual(s.state.rows, [{ id: 'a', value: 'there', at: 1 }]);
  assert.equal(section(summary, 's').removed, 1);
});

test('replace keeps what a part refuses to remove, and says so', async () => {
  const s = rows('s', [{ id: 'repo', value: 'installed' }], { removable: false });
  const file = fileIn('replace-keep.json');
  service([rows('s', []).section]).write(file);
  const summary = await service([s.section]).restore(file, plan('replace', ['s']));
  assert.equal(s.state.rows.length, 1);
  const row = section(summary, 's');
  assert.equal(row.removed, 0);
  assert.equal(row.kept, 1);
  assert.match(row.notes.join(' '), /never removes/);
});

test('restoring one section leaves the others untouched', async () => {
  const a = rows('a', [{ id: '1', value: 'here' }]);
  const b = rows('b', [{ id: '1', value: 'here' }]);
  const file = fileIn('partial.json');
  service([rows('a', [{ id: '2', value: 'x' }]).section, rows('b', [{ id: '2', value: 'x' }]).section]).write(file);
  await service([a.section, b.section]).restore(file, plan('replace', ['a']));
  assert.equal(a.state.rows[0].id, '2');
  assert.deepEqual(b.state.rows, [{ id: '1', value: 'here' }]);
  assert.equal(b.state.commits.length, 0, 'an unselected section must not even be written');
});

test('running the same restore twice changes nothing the second time', async () => {
  const s = rows('s', [{ id: 'a', value: 'here', at: 1 }]);
  const file = fileIn('idempotent.json');
  service([
    rows('s', [
      { id: 'a', value: 'newer', at: 2 },
      { id: 'b', value: 'new' },
    ]).section,
  ]).write(file);
  const svc = service([s.section]);
  await svc.restore(file, plan('smart', ['s']));
  const commits = s.state.commits.length;
  const second = section(await svc.restore(file, plan('smart', ['s'])), 's');
  assert.deepEqual([second.added, second.updated, second.removed], [0, 0, 0]);
  assert.equal(s.state.commits.length, commits, 'nothing to change means nothing written');
});

test('undo puts back what was here before, and a second undo has nothing to do', async () => {
  const s = rows('s', [
    { id: 'a', value: 'mine' },
    { id: 'b', value: 'mine' },
  ]);
  const file = fileIn('undo.json');
  service([rows('s', [{ id: 'c', value: 'theirs' }]).section]).write(file);
  const svc = service([s.section]);
  const summary = await svc.restore(file, plan('replace', ['s']));
  assert.equal(summary.undoAvailable, true);
  assert.deepEqual(s.state.rows.map((r) => r.id), ['c']);

  const undone = await svc.undo();
  assert.equal(undone.ok, true);
  assert.deepEqual(s.state.rows, [
    { id: 'a', value: 'mine' },
    { id: 'b', value: 'mine' },
  ]);
  assert.equal(undone.undoAvailable, false);
  assert.equal((await svc.undo()).ok, false);
});

test('nothing is restored when the recovery copy cannot be written first', async () => {
  const s = rows('s', [{ id: 'a', value: 'mine' }]);
  const file = fileIn('no-recovery.json');
  service([rows('s', [{ id: 'b', value: 'theirs' }]).section]).write(file);
  // A file where the recovery directory should be makes the copy impossible.
  const blocked = fileIn('blocked');
  fs.writeFileSync(blocked, 'not a directory');
  const summary = await service([s.section], blocked).restore(file, plan('replace', ['s']));
  assert.equal(summary.ok, false);
  assert.match(summary.error ?? '', /copy of your current data/);
  assert.deepEqual(s.state.rows, [{ id: 'a', value: 'mine' }]);
});

test('a section that throws while committing is reported, and the rest still restore', async () => {
  const broken = rows('broken', [], {
    commit: () => {
      throw new Error('disk on fire');
    },
  });
  const fine = rows('fine', []);
  const file = fileIn('throws.json');
  service([rows('broken', [{ id: 'x', value: '1' }]).section, rows('fine', [{ id: 'y', value: '1' }]).section]).write(
    file
  );
  const summary = await service([broken.section, fine.section]).restore(file, plan('smart', ['broken', 'fine']));
  assert.equal(summary.ok, true);
  assert.equal(section(summary, 'broken').status, 'failed');
  assert.match(section(summary, 'broken').reason ?? '', /disk on fire/);
  assert.equal(section(summary, 'fine').added, 1);
});

test('rows a store refuses are reported by name and not counted as restored', async () => {
  const repos = rows('repos', [], {
    removable: false,
    commit: ({ put }) => ({
      failed: put.filter((row) => row.id === 'gone').map((row) => ({ label: row.id, reason: 'no longer available' })),
    }),
  });
  const file = fileIn('refused.json');
  service([
    rows('repos', [
      { id: 'ok', value: '' },
      { id: 'gone', value: '' },
    ]).section,
  ]).write(file);
  const row = section(await service([repos.section]).restore(file, plan('smart', ['repos'])), 'repos');
  assert.equal(row.added, 1);
  assert.deepEqual(row.failed, [{ label: 'gone', reason: 'no longer available' }]);
});

test('unreadable rows are skipped and counted, never fatal', async () => {
  const s = rows('s', [], { valid: (row) => typeof (row as Row)?.value === 'string' });
  const file = fileIn('invalid-rows.json');
  const envelope = service([rows('s', [{ id: 'a', value: 'ok' }]).section]).collect();
  envelope.sections.s.data.rows.push({ id: 'b' }, null, 42);
  fs.writeFileSync(file, JSON.stringify(envelope));
  const analysis = service([s.section]).analyze(file);
  assert.ok(analysis.ok);
  assert.equal(analysis.analysis.sections[0].counts.invalid, 3);
  const row = section(await service([s.section]).restore(file, plan('smart', ['s'])), 's');
  assert.equal(row.added, 1);
  assert.equal(row.failed[0].label, '3 rows');
});

test('a section this version does not know is listed as skipped, and the rest restore', async () => {
  const s = rows('s', []);
  const file = fileIn('unknown-section.json');
  const envelope = service([rows('s', [{ id: 'a', value: '1' }]).section]).collect();
  (envelope.sections as Record<string, unknown>).fromTheFuture = { schemaVersion: 1, count: 4, data: { x: [1, 2, 3, 4] } };
  fs.writeFileSync(file, JSON.stringify(envelope));
  const analysis = service([s.section]).analyze(file);
  assert.ok(analysis.ok);
  const future = analysis.analysis.sections.find((row) => row.id === 'fromTheFuture');
  assert.equal(future?.status, 'unsupported');
  assert.equal(future?.backupCount, 4);
  const summary = await service([s.section]).restore(file, plan('smart', ['s', 'fromTheFuture']));
  assert.equal(section(summary, 's').added, 1);
});

test('a newer file format is read as long as it keeps the section map', () => {
  const file = fileIn('newer-format.json');
  const envelope = service([rows('s', [{ id: 'a', value: '1' }]).section]).collect();
  fs.writeFileSync(file, JSON.stringify({ ...envelope, formatVersion: BACKUP_FORMAT_VERSION + 3 }));
  const analysis = service([rows('s', []).section]).analyze(file);
  assert.ok(analysis.ok);
  assert.equal(analysis.analysis.newerFormat, true);
  assert.equal(analysis.analysis.sections[0].status, 'ok');

  const unreadable = fileIn('newer-shape.json');
  fs.writeFileSync(unreadable, JSON.stringify({ format: 'cloudstream-desktop-backup', formatVersion: 99, blobs: [] }));
  const refused = service([]).analyze(unreadable);
  assert.equal(refused.ok, false);
  assert.match(refused.ok ? '' : refused.error, /newer version/);
});

test('a section saved by a newer schema is skipped with a reason', async () => {
  const file = fileIn('newer-schema.json');
  service([rows('s', [{ id: 'a', value: '1' }], { schemaVersion: 3 }).section]).write(file);
  const current = rows('s', []);
  const analysis = service([current.section]).analyze(file);
  assert.ok(analysis.ok);
  assert.equal(analysis.analysis.sections[0].status, 'unsupported');
  const summary = await service([current.section]).restore(file, plan('smart', ['s']));
  assert.equal(section(summary, 's').status, 'skipped');
  assert.equal(current.state.commits.length, 0);
});

test('an older section schema is upgraded through the migration ladder', async () => {
  const file = fileIn('old-schema.json');
  // Version 1 stored plain strings; version 2 stores rows.
  fs.writeFileSync(
    file,
    JSON.stringify({
      format: 'cloudstream-desktop-backup',
      formatVersion: 2,
      createdAt: 1,
      app: { version: '0.9', platform: 'x' },
      sections: { s: { schemaVersion: 1, count: 2, data: { rows: ['a', 'b'] } } },
    })
  );
  const upgraded = rows('s', [], {
    schemaVersion: 2,
    migrations: { 1: (data) => ({ rows: (data.rows as string[]).map((id) => ({ id, value: 'migrated' })) }) },
  });
  const analysis = service([upgraded.section]).analyze(file);
  assert.ok(analysis.ok);
  assert.equal(analysis.analysis.sections[0].migratedFrom, 1);
  await service([upgraded.section]).restore(file, plan('smart', ['s']));
  assert.deepEqual(upgraded.state.rows.map((r) => r.id), ['a', 'b']);

  const gap = rows('s', [], { schemaVersion: 3, migrations: { 1: (data) => data } });
  const skipped = service([gap.section]).analyze(file);
  assert.ok(skipped.ok);
  assert.equal(skipped.analysis.sections[0].status, 'unsupported');
});

test('a quiet part is restored but left out of every count shown', async () => {
  const state = { visible: [] as Row[], quiet: [] as Row[] };
  const make = (id: 'visible' | 'quiet', quiet: boolean): BackupPart<Row> => ({
    id,
    label: id,
    quiet,
    local: () => state[id],
    identify: (row) => row.id,
    describe: (row) => row.id,
    commit: ({ next }) => {
      state[id] = next;
    },
  });
  const s: BackupSection = {
    id: 'ext',
    label: 'ext',
    description: '',
    group: 'sources',
    schemaVersion: 1,
    parts: [make('visible', false), make('quiet', true)],
  };
  const file = fileIn('quiet.json');
  state.visible = [{ id: 'v', value: '' }];
  state.quiet = [{ id: 'q1', value: '' }, { id: 'q2', value: '' }];
  service([s]).write(file);
  state.visible = [];
  state.quiet = [];
  const analysis = service([s]).analyze(file);
  assert.ok(analysis.ok);
  assert.equal(analysis.analysis.sections[0].backupCount, 1);
  const row = section(await service([s]).restore(file, plan('smart', ['ext'])), 'ext');
  assert.equal(row.added, 1);
  assert.equal(state.quiet.length, 2);
});

test('an unrelated JSON file is refused by name, not fed to every section', () => {
  const file = fileIn('unrelated.json');
  fs.writeFileSync(file, JSON.stringify({ sections: { s: { data: { rows: [] } } } }));
  const result = service([rows('s', []).section]).analyze(file);
  assert.equal(result.ok, false);
  assert.match(result.ok ? '' : result.error, /not a CloudStream Desktop backup/);
});

test('a file that is not JSON fails with a message rather than a crash', async () => {
  const file = fileIn('garbage.json');
  fs.writeFileSync(file, '{ this is not json');
  const summary = await service([rows('s', []).section]).restore(file, plan('smart', ['s']));
  assert.equal(summary.ok, false);
  assert.ok(summary.error);
});

test('choosing nothing restores nothing, rather than everything', async () => {
  const s = rows('s', []);
  const file = fileIn('nothing.json');
  service([rows('s', [{ id: 'a', value: '1' }]).section]).write(file);
  const summary = await service([s.section]).restore(file, plan('smart', []));
  assert.equal(summary.ok, false);
  assert.equal(s.state.rows.length, 0);
});

test('a format 1 backup is converted: settings split by owner, caches and store keys dropped', async () => {
  const file = fileIn('format1.json');
  fs.writeFileSync(
    file,
    JSON.stringify({
      format: 'cloudstream-desktop-backup',
      formatVersion: 1,
      createdAt: 5,
      app: { version: '0.8', platform: 'win32' },
      summary: {},
      contents: {
        settings: {
          _String: {
            ott_pinned_platforms: '["netflix"]',
            library_entries: '[{"key":"stale"}]',
            source_cache_v1: '{"huge":true}',
            played_sources: JSON.stringify([{ key: 'k', source: { title: 's' }, playedAt: 1, playCount: 1, origin: {} }]),
            some_future_setting: 'x',
          },
          settings: { _String: { home_provider_key: 'tmdb' } },
        },
        library: { entries: [{ key: 'k', title: 'K' }], progress: [{ key: 'k', updatedAt: 1 }], sources: [] },
        history: [{ id: 'h', title: 'T' }],
        extensions: {
          repositories: ['https://repo'],
          disabledProviders: ['P'],
          disabledExtensions: [],
          disabledRepositories: [],
          plugins: [],
          adultMode: 'ask',
        },
      },
    })
  );
  const read = service([]).read(file);
  assert.ok(read.ok);
  const sections = read.envelope.sections;
  assert.equal(read.envelope.migratedFrom, 1);
  assert.deepEqual(
    sections['settings.streaming'].data.entries.map((row) => (row as { key: string }).key),
    ['ott_pinned_platforms']
  );
  assert.deepEqual(
    sections['settings.other'].data.entries.map((row) => (row as { key: string }).key),
    ['some_future_setting']
  );
  assert.equal((sections['settings.home'].data.entries[0] as { bucket: string }).bucket, 'settings');
  const everyKey = Object.values(sections).flatMap((s) =>
    (s.data.entries ?? []).map((row) => (row as { key: string }).key)
  );
  assert.ok(!everyKey.includes('library_entries'), 'a store-owned key must not travel as a setting');
  assert.ok(!everyKey.includes('source_cache_v1'), 'a cache must not be restored');
  assert.equal(sections.library.data.played.length, 1, 'played sources move to the library');
  assert.equal(sections.continueWatching.data.progress.length, 1);
  assert.deepEqual(sections.repositories.data.repositories, [{ url: 'https://repo' }]);
  assert.deepEqual(sections.extensionSwitches.data.switches, [{ kind: 'provider', name: 'P' }]);
  assert.equal(
    (sections['settings.contentFilters'].data.entries[0] as { value: string }).value,
    'ask',
    'the adult mode carried only by the extensions section is kept'
  );
});

test('the three modes differ only where they are meant to', () => {
  const part = {};
  for (const mode of ['smart', 'merge', 'replace'] as const) {
    assert.equal(decideRow('new', mode, part), 'add');
    assert.equal(decideRow('same', mode, part), 'same');
    assert.equal(decideRow('backupNewer', mode, part), 'update');
  }
  assert.equal(decideRow('localNewer', 'smart', part), 'keep');
  assert.equal(decideRow('localNewer', 'merge', part), 'keep');
  assert.equal(decideRow('localNewer', 'replace', part), 'update');
  assert.equal(decideRow('localOnly', 'smart', part), 'untouched');
  assert.equal(decideRow('localOnly', 'merge', part), 'untouched');
  assert.equal(decideRow('localOnly', 'replace', part), 'remove');
  assert.equal(decideRow('localOnly', 'replace', { removable: false }), 'untouched');
  assert.equal(decideRow('conflict', 'smart', part), 'keep', 'an unanswered conflict keeps what is here');
  assert.equal(decideRow('conflict', 'merge', part), 'update');
  assert.equal(decideRow('conflict', 'smart', part, 'both'), 'keep', 'keep both needs a part that can copy');
});

test('an interrupted write leaves no half-file that looks like a backup', () => {
  const file = fileIn('interrupted.json');
  const exploding: BackupSection = {
    ...rows('s', []).section,
    parts: [
      {
        ...rows('s', []).section.parts[0],
        local: () => {
          const cycle: Record<string, unknown> = {};
          cycle.self = cycle;
          return [cycle];
        },
      },
    ],
  };
  // Serialising fails before a byte is written, so no file appears at all.
  assert.equal(service([exploding]).write(file).ok, false);
  assert.equal(fs.existsSync(file), false);
});

test('an export can carry only the sections asked for, and an empty list means all', () => {
  const svc = service([rows('a', [{ id: '1', value: '' }]).section, rows('b', []).section]);
  assert.deepEqual(Object.keys(svc.collect(['a']).sections), ['a']);
  assert.deepEqual(Object.keys(svc.collect([]).sections), ['a', 'b']);
});

test('the suggested filename sorts by date and says what it is', () => {
  assert.equal(
    BackupService.suggestedFilename(new Date('2026-10-03T09:08:07Z')),
    'cloudstream-backup-2026-10-03-09-08-07.json'
  );
});
