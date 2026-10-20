/**
 * A poster placeholder must not escape its row.
 *
 * `.poster-image--empty` is `position: absolute; inset: 0`. On the Library's
 * Saved pages tab the parent (`.saved-row__art`) was not positioned, so a saved
 * page without a poster drew a translucent layer over the whole window and
 * swallowed every click (inspector: 1920x1009). Lexical, because a stylesheet
 * cannot be loaded here; the rule it looks for is what contains the layer.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';

const css = fs.readFileSync(new URL('../sources.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

test('the placeholder is absolute, so its parent has to be a containing block', () => {
  const rule = /\.poster-image--empty\s*\{([^}]*)\}/.exec(css);
  assert.ok(rule, 'the placeholder rule exists');
  assert.match(rule[1], /position:\s*absolute/);
});

test('every parent of a placeholder is positioned, at zero specificity', () => {
  assert.match(
    css,
    /:where\(\s*:has\(\s*>\s*\.poster-image--empty\s*\)\s*\)\s*\{[^}]*position:\s*relative/,
    'a parent without its own position must become relative'
  );
});
