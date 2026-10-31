import { test } from 'node:test';
import assert from 'node:assert/strict';

import { serviceOf, servicesOff } from './sharedServices.ts';

test('every spelling of the Internet Archive is one service', () => {
  for (const name of ['Internet Archive', 'InternetArchive', 'internet-archive', 'Archive.org', 'archive_org']) {
    assert.equal(serviceOf(name), 'internet-archive', name);
  }
});

test('a provider that only shares a word is not the service', () => {
  assert.equal(serviceOf('Anime Archive'), null);
  assert.equal(serviceOf('ArchiveFlix'), null);
  assert.equal(serviceOf(undefined), null);
});

test('switching off one spelling switches off the service', () => {
  assert.deepEqual([...servicesOff(['Internet Archive', 'Cinevood'])], ['internet-archive']);
  assert.equal(servicesOff([]).size, 0);
});
