/**
 * What a viewer is told, and what only a developer is shown.
 *
 *   bun run test experience-mode
 *   node --experimental-strip-types src/utils/experienceMode.test.mts
 *
 * Two rules pull in opposite directions and both have to hold:
 *
 *  - **Standard mode hides how the app is built.** Engines, codecs, providers,
 *    stages, status codes — none of it belongs in front of someone who wanted
 *    to watch a film.
 *  - **Nothing is ever deleted.** Every one of those is one toggle away, and
 *    the original text of a failure always survives into `detail`, because the
 *    whole point of a plain summary is that the real message is still there
 *    when somebody needs to paste it.
 *
 * The defaults are where this goes wrong silently, so they are pinned first.
 */
import assert from 'node:assert/strict';
import {
  plainMessage,
  readMode,
  settingsLevelFor,
  shouldReveal,
  type ExperienceMode,
} from './experienceMode.ts';

const tests: Array<[string, () => void]> = [];
const test = (name: string, fn: () => void) => tests.push([name, fn]);

// --- the defaults ----------------------------------------------------------

test('an unclassified piece of UI is shown to everyone', () => {
  /**
   * The same safe default as the settings screen's `shouldShow`. Hiding the
   * unclassified would make standard mode quietly lose features as the app
   * grows, and nobody would notice which ones.
   */
  assert.equal(shouldReveal('standard'), true);
  assert.equal(shouldReveal('developer'), true);
});

test('technical detail is hidden in standard and shown in developer', () => {
  assert.equal(shouldReveal('standard', 'technical'), false);
  assert.equal(shouldReveal('developer', 'technical'), true);
});

test('a corrupt stored value is standard, never developer', () => {
  // The failure direction matters: an unreadable preference must not be the
  // one that turns the player into a debugger.
  for (const raw of ['', 'DEVELOPER', 'true', '1', 'everything?', '{}', null]) {
    assert.equal(readMode(raw as string | null), 'standard', `for ${JSON.stringify(raw)}`);
  }
});

test('nothing stored at all is standard', () => {
  assert.equal(readMode(null, null), 'standard');
});

// --- the migration ---------------------------------------------------------

test('a viewer who already chose to see everything keeps seeing it', () => {
  /**
   * The settings screen shipped this switch first, under its own key. Someone
   * who set it to Everything has already answered this question, and asking
   * again by resetting them to standard would read as the app forgetting.
   */
  assert.equal(readMode(null, 'everything'), 'developer');
  assert.equal(readMode(null, 'simple'), 'standard');
});

test('the new key wins over the old one', () => {
  // Once the app-wide toggle is used, the legacy value is history.
  assert.equal(readMode('standard', 'everything'), 'standard');
  assert.equal(readMode('developer', 'simple'), 'developer');
});

// --- one stored value, two vocabularies ------------------------------------

test('the settings level is derived, so the two can never disagree', () => {
  assert.equal(settingsLevelFor('standard'), 'simple');
  assert.equal(settingsLevelFor('developer'), 'everything');
});

// --- plain messages --------------------------------------------------------

test('the original message always survives into detail', () => {
  /**
   * The point of a summary is not to lose the real text. `CopyErrorButton` and
   * the diagnostics panel exist to be pasted into a bug report, and a summary
   * that replaced the original would make them useless.
   */
  for (const raw of [
    'HTTP 403 Forbidden',
    'ffprobe timed out after 20000ms',
    'Something entirely unmatched',
  ]) {
    assert.equal(plainMessage(raw).detail, raw);
  }
});

test('our machinery is never named in the summary', () => {
  const technical = [
    'ffprobe timed out after 20000ms',
    'The conversion pipeline could not be started for this stream.',
    'NoClassDefFoundError: android/widget/Toast',
    'ECONNRESET reading from the sidecar',
  ];
  for (const raw of technical) {
    const { summary } = plainMessage(raw);
    assert.doesNotMatch(
      summary,
      /ffprobe|ffmpeg|sidecar|NoClassDefFound|ECONNRESET|pipeline/i,
      `summary still names the internals: ${summary}`
    );
  }
});

test('the cases a viewer can act on differently are told apart', () => {
  // Gone and refused both mean "try another", but a network drop means "try
  // again" and a format problem means "this file, not this app". Collapsing
  // them into one sentence is what made every failure look the same.
  const gone = plainMessage('This link no longer exists (HTTP 404).').summary;
  const refused = plainMessage('The source refused this request (HTTP 403).').summary;
  const dropped = plainMessage('ECONNRESET').summary;
  const format = plainMessage('could not decode this file').summary;
  const swarm = plainMessage('No peers answered for this torrent — the swarm looks dead.').summary;

  const all = [gone, refused, dropped, format, swarm];
  assert.equal(new Set(all).size, all.length, `these should read differently: ${all.join(' | ')}`);
  assert.doesNotMatch(swarm, /swarm|peer|torrent/i, `still jargon: ${swarm}`);
});

test('a message that is already plain passes through unchanged', () => {
  const friendly = 'That source is no longer in the list; refresh sources and try again.';
  assert.equal(plainMessage(friendly).summary, friendly);
});

test('an empty failure still says something', () => {
  // `describeError` never returns empty, but a snapshot field can be null and
  // "" on screen reads as the app having no idea what happened.
  for (const raw of ['', '   ', null, undefined]) {
    const { summary } = plainMessage(raw);
    assert.ok(summary.length > 0, `empty summary for ${JSON.stringify(raw)}`);
  }
});

test('every mode is handled, so adding one cannot be forgotten', () => {
  const modes: ExperienceMode[] = ['standard', 'developer'];
  for (const mode of modes) {
    assert.equal(typeof shouldReveal(mode, 'technical'), 'boolean');
    assert.ok(['simple', 'everything'].includes(settingsLevelFor(mode)));
  }
});

// --- runner ----------------------------------------------------------------

let failed = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (error) {
    failed++;
    console.error(`  FAIL ${name}`);
    console.error(`       ${error instanceof Error ? error.message : String(error)}`);
  }
}
console.log(`\n${tests.length - failed} passed${failed ? `, ${failed} failed` : ''}`);
if (failed) process.exit(1);
