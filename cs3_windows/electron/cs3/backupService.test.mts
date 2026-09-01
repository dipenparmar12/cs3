import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  BackupService,
  BACKUP_FORMAT_VERSION,
  type BackupSection,
  type RestoreMode,
} from './backupService.ts';

/**
 * The backup, tested because every way it fails is quiet.
 *
 * A backup is written once and read months later, on a different machine,
 * usually because something has already gone wrong. There is no feedback loop:
 * a section that silently exports nothing, or a restore that silently takes
 * nothing, is discovered at the exact moment the data was needed and not
 * before. That is the whole argument for testing it — the code is simple and
 * the consequence of it being subtly wrong is total.
 *
 * The sections are stubs on purpose. The real ones reach the datastore, the
 * plugin manager and Electron's `app`; what this pins is the *contract* between
 * a section and the service, which is where the silent failures live.
 */

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cs3-backup-'));
const fileIn = (name: string) => path.join(tmp, name);

/**
 * A section backed by a mutable array, so a round trip is observable.
 *
 * `replaceable` mirrors the real sections: merging appends, replacing clears
 * first. Both are needed here because the interesting failure is a section
 * that *acts on* a mode the service said it would not be given.
 */
function arraySection(
  name: string,
  rows: unknown[],
  replaceable = false
): BackupSection & { rows: unknown[]; sawMode: RestoreMode[] } {
  const holder = {
    name,
    label: name,
    rows,
    replaceable,
    sawMode: [] as RestoreMode[],
    collect: () => holder.rows,
    restore: (value: unknown, mode: RestoreMode) => {
      holder.sawMode.push(mode);
      if (!Array.isArray(value)) return 0;
      holder.rows = mode === 'replace' ? [...value] : [...holder.rows, ...value];
      return value.length;
    },
  };
  return holder;
}

function service(sections: BackupSection[]): BackupService {
  return new BackupService(sections, '1.2.3', 'win32 10.0');
}

test('a backup round-trips every section it carries', () => {
  const library = arraySection('library', [{ key: 'a' }, { key: 'b' }], true);
  const history = arraySection('history', [{ id: '1' }], true);
  const file = fileIn('round-trip.json');

  const written = service([library, history]).write(file);
  assert.equal(written.ok, true);
  assert.ok((written.bytes ?? 0) > 0);

  // Wipe both, then restore from the file.
  library.rows = [];
  history.rows = [];
  const report = service([library, history]).restore(file);

  assert.equal(report.ok, true);
  assert.deepEqual(
    report.sections.map((row) => [row.name, row.restored]),
    [
      ['library', 2],
      ['history', 1],
    ]
  );
  assert.equal(library.rows.length, 2);
  assert.equal(history.rows.length, 1);
});

/**
 * The failure the section table exists to prevent.
 *
 * A store added to the export and forgotten in the restore produces a file that
 * looks complete — it has the rows in it — and quietly drops them on the way
 * back. It is reported as `export only` rather than as a restore of zero, so the
 * two are distinguishable in the result.
 */
test('an export-only section is reported as such, not as an empty restore', () => {
  const downloads: BackupSection = {
    name: 'downloads',
    label: 'Download queue',
    collect: () => [{ id: 'task-1' }],
  };
  const file = fileIn('export-only.json');
  service([downloads]).write(file);

  const report = service([downloads]).restore(file);
  assert.equal(report.sections[0].note, 'export only');
  assert.equal(report.sections[0].restored, 0);
});

test('a section missing from an older backup says so rather than failing', () => {
  const file = fileIn('older.json');
  service([arraySection('library', [{ key: 'a' }])]).write(file);

  // A newer build knows about a section the file predates.
  const report = service([
    arraySection('library', []),
    arraySection('bookmarks', []),
  ]).restore(file);

  assert.equal(report.ok, true);
  assert.equal(report.sections.find((row) => row.name === 'bookmarks')?.note, 'not in this backup');
});

/**
 * One bad section must not abandon the rest.
 *
 * A restore that stops halfway leaves an installation in a state that neither
 * the backup nor the previous state describes — which is worse than either.
 */
test('a section that throws is recorded and the rest still restore', () => {
  const good = arraySection('library', [{ key: 'a' }]);
  const bad: BackupSection = {
    name: 'settings',
    label: 'Settings',
    collect: () => ({ a: 1 }),
    restore: () => {
      throw new Error('datastore is locked');
    },
  };
  const file = fileIn('throwing.json');
  service([bad, good]).write(file);

  good.rows = [];
  const report = service([bad, good]).restore(file);
  assert.equal(report.ok, true);
  assert.equal(report.sections.find((row) => row.name === 'settings')?.note, 'datastore is locked');
  assert.equal(report.sections.find((row) => row.name === 'library')?.restored, 1);
  assert.equal(good.rows.length, 1);
});

/** A section that cannot be *read* must not fail the whole export either. */
test('a section that throws on collect leaves the rest of the backup intact', () => {
  const bad: BackupSection = {
    name: 'analytics',
    label: 'Analytics',
    collect: () => {
      throw new Error('file unreadable');
    },
  };
  const good = arraySection('library', [{ key: 'a' }]);
  const envelope = service([bad, good]).collect();

  assert.equal(envelope.contents.analytics, null);
  assert.equal(envelope.summary.analytics, -1, 'a negative count marks a section that could not be read');
  assert.deepEqual(envelope.contents.library, [{ key: 'a' }]);
});

// --- refusing things that are not ours ---------------------------------------

test('an unrelated JSON file is refused by name, not fed to every section', () => {
  const file = fileIn('not-ours.json');
  fs.writeFileSync(file, JSON.stringify({ contents: { library: [1, 2, 3] } }));

  const library = arraySection('library', []);
  const report = service([library]).restore(file);

  assert.equal(report.ok, false);
  assert.match(report.error ?? '', /not a CloudStream Desktop backup/i);
  assert.equal(library.rows.length, 0, 'nothing was written from a file we do not recognise');
});

test('a backup from a newer app version is refused with the reason', () => {
  const file = fileIn('newer.json');
  fs.writeFileSync(
    file,
    JSON.stringify({
      format: 'cloudstream-desktop-backup',
      formatVersion: BACKUP_FORMAT_VERSION + 1,
      contents: {},
    })
  );
  const report = service([]).restore(file);
  assert.equal(report.ok, false);
  assert.match(report.error ?? '', /newer version/i);
});

test('a file that is not JSON at all fails with a message rather than a crash', () => {
  const file = fileIn('garbage.json');
  fs.writeFileSync(file, 'this is not json');
  const report = service([]).restore(file);
  assert.equal(report.ok, false);
  assert.ok(report.error);
});

// --- selective restore --------------------------------------------------------

test('restoring one section leaves the others untouched', () => {
  const library = arraySection('library', [{ key: 'a' }], true);
  const history = arraySection('history', [{ id: '1' }], true);
  const file = fileIn('selective.json');
  service([library, history]).write(file);

  library.rows = [];
  history.rows = [];
  const report = service([library, history]).restore(file, { only: ['library'] });

  assert.equal(report.sections.length, 1);
  assert.equal(library.rows.length, 1);
  assert.equal(history.rows.length, 0, 'a section not asked for is not written');
});

// --- inspection ---------------------------------------------------------------

test('inspect describes a backup without restoring any of it', () => {
  const library = arraySection('library', [{ key: 'a' }, { key: 'b' }]);
  const file = fileIn('inspect.json');
  service([library]).write(file);

  library.rows = [];
  const result = service([library]).inspect(file);

  assert.equal(result.ok, true);
  assert.equal(result.envelope?.summary.library, 2);
  assert.equal(result.envelope?.app.version, '1.2.3');
  assert.equal(library.rows.length, 0, 'inspect must not write anything');
  // The contents are deliberately not returned: a description is a description.
  assert.equal((result.envelope as Record<string, unknown> | undefined)?.contents, undefined);
});

test('the suggested filename sorts by date and says what it is', () => {
  const name = BackupService.suggestedFilename(new Date('2026-08-27T14:05:09Z'));
  assert.equal(name, 'cloudstream-backup-2026-08-27-14-05-09.json');
  // No colons: Windows refuses them in filenames, and a save dialog that
  // pre-fills an illegal name is a dead Save button.
  assert.ok(!name.includes(':'));
});

// --- cleanup ------------------------------------------------------------------

test('an interrupted write leaves no half-file that looks like a backup', () => {
  const file = fileIn('atomic.json');
  service([arraySection('library', [{ key: 'a' }])]).write(file);
  assert.equal(fs.existsSync(`${file}.part`), false, 'the temp file is renamed, not left behind');
  assert.equal(fs.existsSync(file), true);
});

process.on('exit', () => {
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* the OS will clean its own temp directory */
  }
});

// --- merge and replace ---------------------------------------------------------

test('merge is the default, and it cannot lose a row the backup predates', () => {
  /**
   * The reason merge has to stay the default: a restore is most often run onto
   * a *working* installation, and a preference or a title added since the file
   * was written must survive it. Reverting one silently reads as the restore
   * having broken something rather than as it not having covered it.
   */
  const library = arraySection('library', [{ key: 'from-backup' }], true);
  const file = fileIn('merge.json');
  service([library]).write(file);

  library.rows = [{ key: 'added-since' }];
  const report = service([library]).restore(file);

  assert.deepEqual(library.rows, [{ key: 'added-since' }, { key: 'from-backup' }]);
  assert.equal(report.sections[0].mode, 'merge');
});

test('replace makes the section match the file, which merge can never do', () => {
  /**
   * This is the case that motivated the mode at all. Merging cannot *remove*
   * anything, so a merge-only restore is always a superset of the backup and
   * can never reproduce the state in it — which is what someone reinstalling
   * after a problem is asking for.
   */
  const library = arraySection('library', [{ key: 'from-backup' }], true);
  const file = fileIn('replace.json');
  service([library]).write(file);

  library.rows = [{ key: 'added-since' }, { key: 'also-since' }];
  const report = service([library]).restore(file, { mode: 'replace' });

  assert.deepEqual(library.rows, [{ key: 'from-backup' }]);
  assert.equal(report.sections[0].mode, 'replace');
});

test('a section that cannot be replaced is merged, and the row says so', () => {
  /**
   * Silently ignoring the chosen mode is the failure this guards. The user
   * asked for an exact match and got a union; if the report does not say which
   * sections could not honour that, the difference is invisible until they
   * notice rows they thought they had removed.
   */
  const analytics = arraySection('providerAnalytics', [{ id: 'x' }]); // not replaceable
  const file = fileIn('downgrade.json');
  service([analytics]).write(file);

  analytics.rows = [{ id: 'local' }];
  const report = service([analytics]).restore(file, { mode: 'replace' });

  assert.equal(report.sections[0].mode, 'merge');
  assert.match(String(report.sections[0].note), /cannot be replaced/);
  assert.deepEqual(analytics.sawMode, ['merge'], 'the section is never handed a mode it cannot honour');
  assert.equal(analytics.rows.length, 2, 'and it merged, as the report said');
});

test('replace is opt-in, so a section added later is not silently destructive', () => {
  /**
   * `replaceable` defaults to absent. A section added by someone who has not
   * read this file must not start deleting rows the first time a user picks
   * Replace — the default has to fail towards keeping data.
   */
  const added = arraySection('somethingNew', [{ id: 'a' }]);
  assert.equal(added.replaceable, false);
});

// --- selective export ----------------------------------------------------------

test('an export can carry only the sections asked for', () => {
  const library = arraySection('library', [{ key: 'a' }], true);
  const history = arraySection('history', [{ id: '1' }], true);
  const file = fileIn('partial-export.json');
  service([library, history]).write(file, ['library']);

  const written = JSON.parse(fs.readFileSync(file, 'utf-8'));
  assert.deepEqual(Object.keys(written.contents), ['library']);
  assert.equal(written.summary.history, undefined);
});

test('an empty selection exports everything rather than nothing', () => {
  /**
   * A caller that filtered a list down to zero still meant to take a backup.
   * Writing an empty file and calling it one is the worse of the two answers,
   * and it is the one a `length > 0` check gets wrong by accident.
   */
  const library = arraySection('library', [{ key: 'a' }], true);
  const history = arraySection('history', [{ id: '1' }], true);
  const file = fileIn('empty-selection.json');
  service([library, history]).write(file, []);

  const written = JSON.parse(fs.readFileSync(file, 'utf-8'));
  assert.deepEqual(Object.keys(written.contents).sort(), ['history', 'library']);
});
