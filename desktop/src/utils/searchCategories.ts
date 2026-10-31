/**
 * What the search box looks for: the category chips. Pure, and imported by
 * the main process too (`searchSuggestions.ts`, `metadata/entitySearch.ts`),
 * so the chips and what they filter cannot disagree.
 *
 * Nothing selected is All. Several selected are any of them (Director +
 * Writer finds either). They say what kind of thing is searched for, never
 * which providers may answer: that is the source list's job.
 */
import type { SearchCategory } from '../types/api';
import type { FilmographyRole } from '../types/filmography';

export const SEARCH_CATEGORIES: ReadonlyArray<{ id: SearchCategory; label: string; plural: string }> = [
  { id: 'title', label: 'Titles', plural: 'titles' },
  { id: 'cast', label: 'Cast', plural: 'cast members' },
  { id: 'director', label: 'Director', plural: 'directors' },
  { id: 'writer', label: 'Writer', plural: 'writers' },
  { id: 'producer', label: 'Producer', plural: 'producers' },
  { id: 'composer', label: 'Composer', plural: 'composers' },
  { id: 'studio', label: 'Studio', plural: 'studios' },
];

/** All clears the rest; a chip toggles; taking the last one off is All again. */
export function toggleCategory(current: readonly SearchCategory[], id: SearchCategory | 'all'): SearchCategory[] {
  if (id === 'all') return [];
  const next = current.includes(id) ? current.filter((category) => category !== id) : [...current, id];
  // Kept in chip order, so the same selection is always the same list.
  return SEARCH_CATEGORIES.map((category) => category.id).filter((category) => next.includes(category));
}

/** The selection as a cache and push key: sorted, joined; `''` is All. */
export function categoryScope(categories: readonly SearchCategory[] = []): string {
  return [...new Set(categories)].sort().join(',');
}

/** Whether a selection asks for catalogue titles. All does. */
export function wantsTitles(categories: readonly SearchCategory[]): boolean {
  return categories.length === 0 || categories.includes('title');
}

/** Whether a selection asks for people or companies. All does; Titles alone does not. */
export function wantsEntities(categories: readonly SearchCategory[]): boolean {
  return categories.length === 0 || categories.some((category) => category !== 'title');
}

const CREDITS: Partial<Record<SearchCategory, FilmographyRole[]>> = {
  cast: ['Acting', 'Voice'],
  director: ['Directing'],
  writer: ['Writing', 'Creator'],
  producer: ['Producing', 'Production'],
  composer: ['Music'],
};

/** The filmography roles a selection keeps, or null for every role (All, Titles, Studio). */
export function filmographyRoles(categories: readonly SearchCategory[]): FilmographyRole[] | null {
  const roles = categories.flatMap((category) => CREDITS[category] ?? []);
  return roles.length ? roles : null;
}

/** "Christopher" as directors or writers: the heading of a submitted category search. */
export function categoryHeading(categories: readonly SearchCategory[], query: string): string {
  const names = SEARCH_CATEGORIES.filter((category) => categories.includes(category.id) && category.id !== 'title').map(
    (category) => category.plural
  );
  const kind = names.length ? names.join(' or ') : 'people and studios';
  return `${kind[0].toUpperCase()}${kind.slice(1)} named “${query.trim()}”`;
}

/** The input's placeholder for a selection. */
export function categoryPlaceholder(categories: readonly SearchCategory[]): string | null {
  if (categories.length === 0) return null;
  const names = SEARCH_CATEGORIES.filter((category) => categories.includes(category.id)).map((category) => category.plural);
  return `Search ${names.join(' or ')}`;
}
