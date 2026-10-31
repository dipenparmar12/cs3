/**
 * Naming a search profile, and when a selection is worth saving. Pure.
 *
 * `sourceProfiles.create` accepts any name and mints a fresh id for a
 * repeat, so two profiles called "Hindi" could sit side by side with nothing
 * to tell them apart. The dialog asks here first: a name already used is
 * offered as a replacement (never taken silently), and a preset's or All
 * sources' name is refused, since picking that pill would then mean two
 * different things.
 */
export const PROFILE_NAME_MAX = 60;

export interface NamedProfile {
  id: string;
  name: string;
}

export type NameCheck =
  | { ok: true; name: string }
  | { ok: false; reason: 'empty' }
  | { ok: false; reason: 'too-long' }
  | { ok: false; reason: 'reserved'; name: string }
  | { ok: false; reason: 'taken'; id: string; name: string };

/** Case, accents and spacing do not make a different name. */
function fold(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase();
}

/**
 * `reserved`: names the dialog already shows as built-in choices.
 * `ignoreId`: the profile being renamed, which may keep its own name.
 */
export function checkProfileName(
  raw: string,
  profiles: readonly NamedProfile[],
  reserved: readonly string[],
  ignoreId?: string
): NameCheck {
  const name = raw.trim().replace(/\s+/g, ' ');
  if (!name) return { ok: false, reason: 'empty' };
  if (name.length > PROFILE_NAME_MAX) return { ok: false, reason: 'too-long' };
  const folded = fold(name);
  const builtIn = reserved.find((candidate) => fold(candidate) === folded);
  if (builtIn) return { ok: false, reason: 'reserved', name: builtIn };
  const taken = profiles.find((profile) => profile.id !== ignoreId && fold(profile.name) === folded);
  if (taken) return { ok: false, reason: 'taken', id: taken.id, name: taken.name };
  return { ok: true, name };
}

/** One short line for a name that cannot be used as typed; `null` when there is nothing to say. */
export function nameProblem(check: NameCheck): string | null {
  if (check.ok || check.reason === 'empty') return null;
  if (check.reason === 'too-long') return `Use ${PROFILE_NAME_MAX} characters or fewer.`;
  if (check.reason === 'reserved') return `“${check.name}” is a built-in choice. Pick another name.`;
  return `“${check.name}” already exists.`;
}

export interface Selection {
  providers: readonly string[];
  indexers: readonly string[];
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((value) => set.has(value));
}

export function sameSelection(a: Selection, b: Selection): boolean {
  return sameSet(a.providers, b.providers) && sameSet(a.indexers, b.indexers);
}

/**
 * Save as profile is offered for the unnamed selection only (a preset is
 * applied to it, so `builtin:*` counts), and only when it holds something and
 * is not already a saved profile. A named profile needs
 * no save: an edit made while it is active is written into it
 * (`sourceProfiles.edit`). All sources has nothing to save.
 */
export function canSaveSelection(activeId: string, draft: Selection, profiles: readonly Selection[]): boolean {
  if (activeId !== '' && !activeId.startsWith('builtin:')) return false;
  if (draft.providers.length + draft.indexers.length === 0) return false;
  return !profiles.some((profile) => sameSelection(profile, draft));
}
