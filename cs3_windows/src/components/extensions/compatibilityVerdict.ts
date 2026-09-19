import type { PluginCompatibilityReport } from '../../types/plugin';

/**
 * "Will this extension work here?", answered without naming how we know.
 *
 * `CompatibilityReport` already had the answer and published it as its
 * workings: a recommended tier (`T1_DROPIN`), a count of Android API
 * references, the network stack and HTML parser the archive links against, and
 * an archive format code. Every one of those is a real measurement and not one
 * of them is readable without knowing that this app translates Android
 * bytecode to run on a JVM — which is the exact test `settingsLevel.ts` sets
 * for `advanced`, applied to a panel that predates it.
 *
 * So this is the translation, the same shape and for the same reason as
 * {@link ../search/providerHealth}: the panel keeps its grid for anyone who
 * asked to see it, and standard mode gets the one sentence the grid was
 * evidence for.
 *
 * ## It reads the score rather than re-deriving one
 *
 * `PluginCompatibilityAnalyzer` already weighs the tier, the format and the
 * android references into `compatibilityScore`, and a second opinion computed
 * here is how a panel and its own summary come to disagree in front of one
 * person. The one input read besides the score is `confidence: 'Unsupported'`,
 * which is the analyser saying it could not classify the archive at all — a
 * different claim from a low score, and the only one where the honest answer
 * is that we do not know.
 *
 * ## Why a prediction is labelled as one, in both modes
 *
 * The score comes from reading the archive, never from running it, and the two
 * disagree often: an archive can classify perfectly and still return nothing
 * because the site it scrapes has changed. Standard mode says "should" rather
 * than "will" for that reason. Dropping the hedge would make the first
 * high-scoring extension that finds nothing read as the app lying, which costs
 * more trust than the hedge costs clarity.
 */

export type VerdictLevel = 'ready' | 'likely' | 'limited' | 'unlikely' | 'unknown';

export interface CompatibilityVerdict {
  level: VerdictLevel;
  /** Two or three words, for a badge beside the extension's name. */
  label: string;
  /** The sentence under it. Never names a tier, a format or a bytecode fact. */
  detail: string;
}

/**
 * The bands.
 *
 * The boundaries are the ones `CompatibilityReport` already coloured its score
 * badge by (80 and 50), kept rather than re-chosen so the badge and the
 * sentence cannot contradict each other on the same row. The band between them
 * is split at 65 because "might work" covers too much ground to be useful
 * advice: an archive at 78 is worth installing and one at 52 is a gamble, and
 * collapsing both into one phrase is how a list of twenty extensions becomes
 * undifferentiated.
 */
export function verdictFor(report: PluginCompatibilityReport): CompatibilityVerdict {
  /**
   * Not a floor on the scale — an absence of one.
   *
   * `Unsupported` is what the analyser reports when it could not read the
   * archive as anything it knows, and its score is then 0 by default rather
   * than by measurement. Printing "Unlikely to work" over that is a verdict on
   * evidence nobody collected, and it is the wrong direction to be wrong in:
   * the cross-platform jar lane spent a release being reported as `Unsupported`
   * with a score of 0, which is the exact opposite of the truth for the one
   * lane that needs no translation at all.
   */
  if (report.confidence === 'Unsupported') {
    return {
      level: 'unknown',
      label: 'Not recognised',
      detail: 'This add-on is in a format this app could not read. It may not install.',
    };
  }

  const score = report.compatibilityScore;

  if (score >= 80) {
    return {
      level: 'ready',
      label: 'Should work',
      detail: 'Nothing in this add-on looks like it will stop it running here.',
    };
  }
  if (score >= 65) {
    return {
      level: 'likely',
      label: 'Should mostly work',
      detail: 'This should run, though a few of its features may not be available here.',
    };
  }
  if (score >= 50) {
    return {
      level: 'limited',
      label: 'May be limited',
      detail: 'This can run, but parts of it are built for phones and will be switched off.',
    };
  }
  return {
    level: 'unlikely',
    label: 'May not work',
    detail: 'Much of this add-on needs a phone. It may install and then find nothing.',
  };
}

/**
 * The tone the badge is drawn in.
 *
 * Kept beside the bands rather than derived at the call site, so adding a band
 * cannot leave one rendering in the default colour — which reads as neutral and
 * is the one thing a warning must never read as.
 */
export function toneFor(level: VerdictLevel): 'success' | 'warning' | 'danger' | undefined {
  if (level === 'ready' || level === 'likely') return 'success';
  if (level === 'limited') return 'warning';
  if (level === 'unlikely') return 'danger';
  return undefined;
}
