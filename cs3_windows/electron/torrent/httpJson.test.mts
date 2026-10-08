import { test } from 'node:test';
import assert from 'node:assert/strict';

import { NotJsonError, fetchJson, setHttpFetch } from './http.ts';

const reply = (body: string, type: string) => async () =>
  new Response(body, { status: 200, headers: { 'content-type': type } });

test('a web page where JSON was expected names the host, not a parser position', async () => {
  setHttpFetch(reply('<!doctype html><html><body>Sign in</body></html>', 'text/html; charset=utf-8'));
  await assert.rejects(
    fetchJson('https://git.example.org/owner/repo/raw/branch/main/repo.json', { retries: 0 }),
    (error: unknown) =>
      error instanceof NotJsonError &&
      error.message.startsWith('git.example.org answered with a web page') &&
      !error.message.includes('Unexpected token')
  );
});

test('malformed JSON that is not a page is reported as such', async () => {
  setHttpFetch(reply('{"pluginLists": [', 'application/json'));
  await assert.rejects(
    fetchJson('https://raw.example.org/repo.json', { retries: 0 }),
    (error: unknown) => error instanceof NotJsonError && /not valid JSON/.test(error.message)
  );
});

test('valid JSON still parses', async () => {
  setHttpFetch(reply('{"name":"Repo","pluginLists":[]}', 'text/plain'));
  assert.deepEqual(await fetchJson('https://raw.example.org/repo.json', { retries: 0 }), {
    name: 'Repo',
    pluginLists: [],
  });
});
