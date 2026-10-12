import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  PUBLIC_INFO,
  contactEmail,
  isPublishableUrl,
  isUpiId,
  usableDeveloperLinks,
  usableDonationMethods,
  type PublicInfo,
} from './publicInfo.ts';

function withInfo(patch: Partial<PublicInfo['developer']>, methods: PublicInfo['donations']['methods']): PublicInfo {
  return {
    developer: { ...PUBLIC_INFO.developer, ...patch },
    donations: { methods },
  };
}

test('an unconfigured donation method is not offered', () => {
  const info = withInfo({}, [
    { kind: 'link', id: 'bmc', label: 'Buy Me a Coffee', url: '' },
    { kind: 'link', id: 'kofi', label: 'Ko-fi', url: 'https://ko-fi.com/<handle>' },
    { kind: 'upi', id: 'upi', label: 'UPI', upiId: '' },
    { kind: 'link', id: 'real', label: 'Real', url: 'https://example.org/support' },
  ]);
  // An empty field or a placeholder copied from the example never becomes a button.
  assert.deepEqual(
    usableDonationMethods(info).map((m) => m.id),
    ['real'],
  );
});

test('only http(s) pages are publishable destinations', () => {
  assert.equal(isPublishableUrl('https://buymeacoffee.com/someone'), true);
  assert.equal(isPublishableUrl('javascript:alert(1)'), false);
  assert.equal(isPublishableUrl('file:///C:/Windows'), false);
  assert.equal(isPublishableUrl('buymeacoffee.com/someone'), false);
  assert.equal(isPublishableUrl(undefined), false);
});

test('a UPI ID must look like one', () => {
  assert.equal(isUpiId('someone@okhdfcbank'), true);
  assert.equal(isUpiId('some.one-1@ybl'), true);
  assert.equal(isUpiId('9876543210'), false);
  assert.equal(isUpiId('someone@'), false);
  assert.equal(isUpiId('<name>@<bank>'), false);
});

test('a duplicated id keeps its first usable entry', () => {
  const info = withInfo({}, [
    { kind: 'link', id: 'pay', label: 'First', url: 'https://example.org/a' },
    { kind: 'link', id: 'pay', label: 'Second', url: 'https://example.org/b' },
  ]);
  assert.deepEqual(usableDonationMethods(info).map((m) => m.label), ['First']);
});

test('no published email means no email link', () => {
  assert.equal(contactEmail(withInfo({ contactEmail: '' }, [])), null);
  assert.equal(contactEmail(withInfo({ contactEmail: 'not an address' }, [])), null);
  assert.equal(contactEmail(withInfo({ contactEmail: ' dev@example.org ' }, [])), 'dev@example.org');
});

test('developer links with a broken URL are dropped, order kept', () => {
  const info = withInfo(
    {
      links: [
        { id: 'a', label: 'A', url: 'https://example.org/a' },
        { id: 'b', label: 'B', url: '' },
        { id: 'c', label: 'C', url: 'https://example.org/c' },
      ],
    },
    [],
  );
  assert.deepEqual(usableDeveloperLinks(info).map((l) => l.id), ['a', 'c']);
});

test('the shipped configuration publishes nothing that is not a usable link', () => {
  // Every configured developer link must open; a donation method that is in
  // the list but unusable would be silently hidden, which hides a mistake.
  assert.equal(usableDeveloperLinks().length, PUBLIC_INFO.developer.links.length);
  assert.equal(usableDonationMethods().length, PUBLIC_INFO.donations.methods.length);
  const email = PUBLIC_INFO.developer.contactEmail ?? '';
  assert.ok(email === '' || contactEmail() === email.trim(), 'contactEmail is set but malformed');
});
