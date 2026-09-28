/**
 * "Find a setting" — which rows a query leaves on the settings screen.
 *
 * The screen is grouped by subject, which is right for browsing and wrong for
 * the other thing people do here: looking for a setting they half remember by a
 * word that is not its label. "DNS" is not the label of anything; it is in the
 * explanation behind the ⓘ on the Connection section. So a row matches on its
 * label, its short note, its explanation and any extra keywords it declares,
 * and every word of the query has to appear somewhere in that text.
 *
 * Pure, and in a `.ts` for `settingsLevel.ts`'s reason: Node's type stripping
 * cannot load JSX, and this is the half worth testing. Explanations are React
 * nodes, so `textOf` walks them structurally — strings, numbers, arrays and an
 * element's `props.children` — without importing React.
 */

/** The readable text inside a React node, as one string. */
export function textOf(node: unknown): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join(' ');
  if (typeof node === 'object' && 'props' in (node as Record<string, unknown>)) {
    const props = (node as { props?: { children?: unknown } }).props;
    return textOf(props?.children);
  }
  return '';
}

const fold = (text: string) =>
  text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

/**
 * Whether every word of `query` appears in any of `texts`.
 *
 * An empty query matches everything, so the screen with nothing typed is the
 * ordinary screen.
 */
export function matchesSettingQuery(query: string, ...texts: unknown[]): boolean {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = fold(texts.map(textOf).join(' '));
  return words.every((word) => haystack.includes(word));
}
