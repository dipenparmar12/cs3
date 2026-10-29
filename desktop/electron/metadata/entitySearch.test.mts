import { test } from 'node:test';
import assert from 'node:assert/strict';

import { entityStillMatches, parseGate, pickEntities, type GateRow, type NameHit } from './entitySearch.ts';

// The live answers for "John Cena" and "Christopher Nolan" (2026-10-29), cut down.
const CENA: NameHit[] = [
  { id: 'Q44437', label: 'John Cena', description: 'American actor and professional wrestler (born 1977)' },
  { id: 'Q24699898', label: 'John Cenatiempo', description: 'American actor' },
  { id: 'Q85771436', label: 'John Cena', description: 'song by Sho Madjozi' },
  { id: 'Q6101149', label: 'John Cena Ibarra', description: 'Mexican politician' },
];
const CENA_GATE: GateRow[] = [
  { id: 'Q44437', human: true, credited: true, produced: false, image: 'http://commons.wikimedia.org/wiki/Special:FilePath/John%20Cena.jpg' },
  { id: 'Q24699898', human: true, credited: true, produced: false },
  { id: 'Q85771436', human: false, credited: false, produced: false },
  { id: 'Q6101149', human: true, credited: false, produced: false },
];

test('a person is a human credited on screen; a song or a politician of the name is not', () => {
  const people = pickEntities('John Cena', CENA, CENA_GATE);
  assert.deepEqual(people.map((p) => [p.id, p.kind]), [['Q44437', 'person']]);
  assert.equal(people[0].profileUrl, 'https://www.wikidata.org/wiki/Q44437');
  assert.match(people[0].imageUrl ?? '', /John/);
});

test('without an exact name, near names are offered in Wikidata’s order', () => {
  const near = pickEntities('John Cen', CENA, CENA_GATE);
  assert.deepEqual(near.map((p) => p.id), ['Q44437', 'Q24699898']);
});

test('a company is what produced a work, never a human', () => {
  const hits: NameHit[] = [
    { id: 'Q1696916', label: 'Yash Raj Films', description: 'Indian film studio founded 1970' },
    { id: 'Q8049699', label: 'Yash Raj Films International' },
  ];
  const gate: GateRow[] = [
    { id: 'Q1696916', human: false, credited: false, produced: true },
    { id: 'Q8049699', human: false, credited: false, produced: false },
  ];
  assert.deepEqual(pickEntities('yash raj films', hits, gate).map((e) => [e.id, e.kind]), [['Q1696916', 'company']]);
  // A human who is somehow a production company stays a person, or nothing.
  assert.equal(pickEntities('x', [{ id: 'Q1', label: 'X' }], [{ id: 'Q1', human: true, credited: false, produced: true }]).length, 0);
});

test('a title query offers nobody', () => {
  const hits: NameHit[] = [
    { id: 'Q25188', label: 'Inception', description: '2010 film directed by Christopher Nolan' },
    { id: 'Q3797611', label: 'Inception', description: 'soundtrack album' },
  ];
  const gate: GateRow[] = hits.map((h) => ({ id: h.id, human: false, credited: false, produced: false }));
  assert.deepEqual(pickEntities('Inception', hits, gate), []);
});

test('an exact person does not push out an exact company, and at most three are offered', () => {
  const hits: NameHit[] = [
    { id: 'Q1', label: 'Marvel' },
    { id: 'Q2', label: 'Marvel' },
    { id: 'Q3', label: 'Marvel Studios' },
    { id: 'Q4', label: 'Marvel' },
    { id: 'Q5', label: 'Marvel' },
  ];
  const gate: GateRow[] = [
    { id: 'Q1', human: true, credited: true, produced: false },
    { id: 'Q2', human: false, credited: false, produced: true },
    { id: 'Q3', human: false, credited: false, produced: true },
    { id: 'Q4', human: false, credited: false, produced: true },
    { id: 'Q5', human: false, credited: false, produced: true },
  ];
  const picked = pickEntities('marvel', hits, gate);
  assert.deepEqual(picked.map((e) => e.id), ['Q1', 'Q2', 'Q4']);
});

test('a label that is only an id, or a hit the gate never answered, is left out', () => {
  assert.deepEqual(pickEntities('q', [{ id: 'Q9', label: 'Q9' }], [{ id: 'Q9', human: true, credited: true, produced: false }]), []);
  assert.deepEqual(pickEntities('ann', [{ id: 'Q9', label: 'Ann' }], []), []);
});

test('a shorter query’s people still match while their name is being typed', () => {
  const [cena] = pickEntities('John Cena', CENA, CENA_GATE);
  assert.equal(entityStillMatches(cena, 'john ce'), true);
  assert.equal(entityStillMatches(cena, 'cena'), true);
  assert.equal(entityStillMatches(cena, 'john cenat'), false);
  assert.equal(entityStillMatches(cena, 'jane'), false);
});

test('the credit check reads one row per item, whatever the number of photos', () => {
  const rows = parseGate({
    results: {
      bindings: [
        { item: { value: 'http://www.wikidata.org/entity/Q44437' }, human: { value: 'true' }, credited: { value: 'true' }, produced: { value: 'false' }, image: { value: 'a.jpg' } },
        { item: { value: 'http://www.wikidata.org/entity/Q44437' }, human: { value: 'true' }, credited: { value: 'true' }, produced: { value: 'false' }, image: { value: 'b.jpg' } },
        { item: { value: 'nonsense' } },
      ],
    },
  });
  assert.deepEqual(rows, [{ id: 'Q44437', human: true, credited: true, produced: false, image: 'a.jpg' }]);
});
