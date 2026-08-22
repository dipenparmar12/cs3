/**
 * Small display formatters shared across screens.
 *
 * Kept apart from any one component because the same number has to read the
 * same way wherever it appears — a `.cs3` archive listed as "1.4 MB" in the
 * catalogue and "1,468,006 bytes" on its provenance panel looks like two
 * different files.
 */

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

/**
 * Bytes at a glance: three significant figures, never more.
 *
 * Compact rather than exact on purpose. These numbers appear in rows people
 * scan rather than read, and the digits past the first three carry no decision
 * — nobody chooses between two extensions on the strength of 1.42 MB versus
 * 1.418 MB.
 */
export function formatCompactBytes(bytes: number | undefined | null): string {
  if (bytes === undefined || bytes === null || !Number.isFinite(bytes) || bytes <= 0) {
    return '—';
  }

  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }

  // Whole bytes never gain a decimal point; "512.0 B" reads as a rounding.
  const decimals = unit === 0 ? 0 : value < 10 ? 1 : 0;
  return `${value.toFixed(decimals)} ${UNITS[unit]}`;
}
