import { test } from 'node:test';
import assert from 'node:assert/strict';

import { cleanPlot, collectPlots } from './plots.ts';

const BREAKING_BAD =
  'A high school chemistry teacher diagnosed with inoperable lung cancer turns to manufacturing and selling methamphetamine in order to secure his family\'s future.';

test('cleanPlot strips TVmaze markup and decodes entities', () => {
  assert.equal(
    cleanPlot('<p><b>Breaking Bad</b> follows Walter&nbsp;White &amp; Jesse.</p><p>Season two&#39;s arc.</p>'),
    "Breaking Bad follows Walter White & Jesse.\n\nSeason two's arc."
  );
  assert.equal(cleanPlot('Line one<br>line two'), 'Line one\nline two');
  assert.equal(cleanPlot('  <p> </p> '), undefined);
  assert.equal(cleanPlot(null), undefined);
});

test('collectPlots keeps distinct descriptions in precedence order', () => {
  const plots = collectPlots([
    { source: 'cinemeta', text: BREAKING_BAD },
    { source: 'tvmaze', text: '<p>When Walter White, a New Mexico chemistry teacher, is diagnosed with Stage III cancer, he becomes a manufacturer of crystal meth.</p>' },
  ]);
  assert.deepEqual(
    plots.map((plot) => plot.source),
    ['cinemeta', 'tvmaze']
  );
  assert.ok(!plots[1].text.includes('<p>'));
});

test('collectPlots treats a punctuation variant as the same plot', () => {
  const plots = collectPlots([
    { source: 'cinemeta', text: BREAKING_BAD },
    { source: 'tvmaze', text: `<p>${BREAKING_BAD.replace("family's", 'familys').toUpperCase()}</p>` },
  ]);
  assert.equal(plots.length, 1);
  assert.equal(plots[0].source, 'cinemeta');
});

test('collectPlots keeps the longer copy of a truncated plot, with its own source', () => {
  const plots = collectPlots([
    { source: 'cinemeta', text: `${BREAKING_BAD.slice(0, 80)}...` },
    { source: 'tvmaze', text: BREAKING_BAD },
  ]);
  assert.equal(plots.length, 1);
  assert.equal(plots[0].text, BREAKING_BAD);
  assert.equal(plots[0].source, 'tvmaze');
});

test('collectPlots drops placeholders and taglines', () => {
  assert.deepEqual(
    collectPlots([
      { source: 'cinemeta', text: 'N/A' },
      { source: 'tvmaze', text: '<p>Coming soon.</p>' },
      { source: 'anilist', text: undefined },
    ]),
    []
  );
});
