/**
 * How much of the settings screen is showing.
 *
 * ## The problem
 *
 * This screen accumulated the way settings screens do: every time a decision
 * turned out to be worth exposing, a row appeared. The result is accurate and
 * unusable — "Providers searched at once", "Torrent metadata mirrors", "Native
 * engine policy", "Probe budget" are all real controls with real effects, and
 * none of them means anything to somebody who installed this to watch a film.
 * A person who does not know what a scraper is cannot tell which of forty rows
 * they are supposed to have an opinion about, so they either change nothing or
 * change something they should not have.
 *
 * ## Why a level rather than a separate screen
 *
 * The obvious fix — move the technical rows to an "Advanced" tab — is what the
 * screen already tried, and it does not work, because "advanced" is not a
 * category. The technical controls are *about* the same subjects as the simple
 * ones: how many providers a search asks is a search setting, and the probe
 * budget is a playback setting. Grouping by audience rather than by subject
 * puts two halves of one topic in two places, and the reader has to know which
 * half they need before they can look.
 *
 * So the grouping stays by subject and the *level* filters within it. A row
 * marked `advanced` disappears in Simple, and a group whose rows have all
 * disappeared hides itself — which is what stops Simple mode from being a page
 * of empty headings.
 *
 * ## What `advanced` means
 *
 * Not "rarely used" and not "dangerous". It means: **understanding the label
 * requires knowing how this app is built.** A control whose effect a viewer can
 * describe without that — "keep playing when I minimise", "where downloads go",
 * "subtitle size" — is basic however obscure it is. A control whose label names
 * a component, a protocol or an internal policy is advanced however useful.
 *
 * That test is the reason the default is Simple. Everything is still one click
 * away and nothing is hidden permanently; the toggle says how many rows are
 * being held back, so nobody has to wonder whether the screen is missing
 * something.
 */

export type SettingsLevel = 'simple' | 'everything';

/**
 * Whether a row or group at `rowLevel` should render.
 *
 * Defaults to `basic` — an unmarked row is one nobody has classified, and
 * hiding those would make Simple mode silently lose settings as the screen
 * grows. The cost of the wrong default is a Simple screen longer than it should
 * be, which is recoverable; the cost of the other default is a setting that
 * vanishes and nobody notices.
 *
 * Lives in a `.ts` rather than beside the provider because Node's type
 * stripping cannot load JSX, and this is the half worth testing.
 */
export function shouldShow(
  level: SettingsLevel,
  rowLevel: 'basic' | 'advanced' = 'basic'
): boolean {
  return level === 'everything' || rowLevel === 'basic';
}
