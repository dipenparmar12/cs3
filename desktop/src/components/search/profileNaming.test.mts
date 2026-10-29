import { test } from 'node:test';
import assert from 'node:assert/strict';

import { canSaveSelection, checkProfileName, nameProblem, PROFILE_NAME_MAX, sameSelection } from './profileNaming.ts';

const PROFILES = [
  { id: 'hindi', name: 'Hindi films' },
  { id: 'anime', name: 'Anime' },
];
const RESERVED = ['All sources', 'K-Drama'];

test('a new name passes, tidied', () => {
  assert.deepEqual(checkProfileName('  Weekend   picks ', PROFILES, RESERVED), { ok: true, name: 'Weekend picks' });
});

test('an empty name is refused without a message', () => {
  const check = checkProfileName('   ', PROFILES, RESERVED);
  assert.deepEqual(check, { ok: false, reason: 'empty' });
  assert.equal(nameProblem(check), null);
});

test('a long name is refused', () => {
  assert.equal(checkProfileName('x'.repeat(PROFILE_NAME_MAX), PROFILES, RESERVED).ok, true);
  const check = checkProfileName('x'.repeat(PROFILE_NAME_MAX + 1), PROFILES, RESERVED);
  assert.equal(check.ok ? '' : check.reason, 'too-long');
  assert.match(nameProblem(check) ?? '', /60 characters/);
});

test('a name already used is reported with the profile it would replace', () => {
  const check = checkProfileName('hindi FILMS', PROFILES, RESERVED);
  assert.deepEqual(check, { ok: false, reason: 'taken', id: 'hindi', name: 'Hindi films' });
  assert.equal(nameProblem(check), '“Hindi films” already exists.');
  // Accents and spacing do not make it a different name.
  assert.equal(checkProfileName('Animé', PROFILES, RESERVED).ok, false);
});

test('a built-in choice’s name is never taken', () => {
  const check = checkProfileName('all  SOURCES', PROFILES, RESERVED);
  assert.deepEqual(check, { ok: false, reason: 'reserved', name: 'All sources' });
});

test('a profile being renamed may keep its own name', () => {
  assert.equal(checkProfileName('Anime', PROFILES, RESERVED, 'anime').ok, true);
  assert.equal(checkProfileName('Anime', PROFILES, RESERVED, 'hindi').ok, false);
});

test('only an unsaved selection with something in it, not already saved, offers a save', () => {
  const draft = { providers: ['A', 'B'], indexers: ['yts'] };
  const saved = [{ providers: ['B', 'A'], indexers: ['yts'] }];
  assert.equal(canSaveSelection('', draft, []), true);
  assert.equal(canSaveSelection('', draft, saved), false);
  assert.equal(canSaveSelection('', { providers: [], indexers: [] }, []), false);
  assert.equal(canSaveSelection('all', draft, []), false);
  assert.equal(canSaveSelection('hindi', draft, []), false);
  // A preset is applied to the unsaved selection, so it can be kept under a name of its own.
  assert.equal(canSaveSelection('builtin:anime', draft, []), true);
});

test('a selection is the same whatever its order, and differs by one member', () => {
  assert.equal(sameSelection({ providers: ['A', 'B'], indexers: [] }, { providers: ['B', 'A'], indexers: [] }), true);
  assert.equal(sameSelection({ providers: ['A', 'B'], indexers: [] }, { providers: ['A'], indexers: [] }), false);
  assert.equal(sameSelection({ providers: ['A'], indexers: ['x'] }, { providers: ['A'], indexers: ['y'] }), false);
});
