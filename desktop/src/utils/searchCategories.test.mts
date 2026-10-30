import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  categoryHeading,
  categoryPlaceholder,
  categoryScope,
  filmographyRoles,
  toggleCategory,
  wantsEntities,
  wantsTitles,
} from './searchCategories.ts';

test('All clears the chips; a chip toggles; the last one off is All again', () => {
  assert.deepEqual(toggleCategory([], 'director'), ['director']);
  // Chip order, whatever the order of the clicks.
  assert.deepEqual(toggleCategory(['writer'], 'director'), ['director', 'writer']);
  assert.deepEqual(toggleCategory(['director', 'writer'], 'director'), ['writer']);
  assert.deepEqual(toggleCategory(['writer'], 'writer'), []);
  assert.deepEqual(toggleCategory(['director', 'writer'], 'all'), []);
});

test('the scope key ignores order and repeats; All is empty', () => {
  assert.equal(categoryScope(['writer', 'director', 'writer']), 'director,writer');
  assert.equal(categoryScope([]), '');
  assert.equal(categoryScope(), '');
});

test('Titles alone asks for no people, a person category asks for no titles, All asks for both', () => {
  assert.deepEqual([wantsTitles([]), wantsEntities([])], [true, true]);
  assert.deepEqual([wantsTitles(['title']), wantsEntities(['title'])], [true, false]);
  assert.deepEqual([wantsTitles(['director']), wantsEntities(['director'])], [false, true]);
  assert.deepEqual([wantsTitles(['title', 'cast']), wantsEntities(['title', 'cast'])], [true, true]);
});

test('a category keeps its credits in a filmography; All and Studio keep every role', () => {
  assert.deepEqual(filmographyRoles(['director', 'composer']), ['Directing', 'Music']);
  assert.deepEqual(filmographyRoles(['cast']), ['Acting', 'Voice']);
  assert.equal(filmographyRoles([]), null);
  assert.equal(filmographyRoles(['studio']), null);
  assert.equal(filmographyRoles(['title']), null);
});

test('headings and placeholders name what is searched for', () => {
  assert.equal(categoryHeading(['director', 'writer'], ' Christopher '), 'Directors or writers named “Christopher”');
  assert.equal(categoryHeading(['studio'], 'Yash'), 'Studios named “Yash”');
  assert.equal(categoryPlaceholder(['cast']), 'Search cast members');
  assert.equal(categoryPlaceholder([]), null);
});
