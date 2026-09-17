/**
 * Merging what several catalogues say about one title. Pure, and tested.
 *
 * This is its own module for the reason `ottPlatforms.ts` and `playedSource.ts`
 * are: **every wrong answer here is silent and plausible.** A cast list that
 * quietly shows one actor twice reads as a scraping bug; one that merges the
 * composer John Williams into the bit-part actor John Williams reads as correct
 * and is not. Neither produces an error, and neither would ever be traced back
 * to a merge rule from a bug report.
 *
 * ## The merge key, and why it is not just the name
 *
 * The two failure directions are not symmetric, so the rule cannot simply pick
 * a side:
 *
 * | Too coarse | Too fine |
 * |---|---|
 * | Two different people sharing a name become one row with the wrong character | One person from two sources becomes two rows |
 * | Rare, wrong, and invisible | Common, harmless, and looks broken |
 *
 * So the key is **name plus role class** — a director never merges into a cast
 * member however their names match — with one additional guard on top:
 * two cast credits that *both* state a character and state different ones are
 * treated as different people. That is the only evidence available that two
 * identically-named performers are distinct, and it is exactly the evidence the
 * John Williams case produces. Where only one source states a character there
 * is no disagreement to act on, and merging is right — that case is the whole
 * reason this function exists, since Wikidata has the character and TVmaze has
 * the photograph.
 *
 * Characters are compared with containment in either direction, because sources
 * decorate them inconsistently: "Tony Stark" and "Tony Stark / Iron Man" are one
 * role, and a strict comparison would split every Marvel cast list in two. Same
 * concession `cs3/playedSource.ts` makes about release names, for the same
 * reason.
 */

import {
  Department,
  CreditRole,
  type CreditPerson,
  type CrewSummary,
  type MetadataSource,
  type Organisation,
  type ProductionNote,
  type TitleRating,
  type TitleVideo,
} from '../../src/types/metadata.ts';

/**
 * A name reduced to what two catalogues would agree on.
 *
 * Diacritics are folded because one source writes "Léa Seydoux" and another
 * "Lea Seydoux"; punctuation because of "Robert Downey, Jr." against
 * "Robert Downey Jr.". Deliberately *not* reordered or initialised — "Smith,
 * John" is left alone rather than guessed at, since a wrong guess here silently
 * merges two people and the sources in use do not publish that form.
 */
export function normalisePersonName(name: string): string {
  return name
    .normalize('NFD')
    // Combining marks: fold "é" to "e" rather than treating them as different.
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[.,'’`"]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The same folding, for characters. Kept separate so the rules can diverge. */
export function normaliseCharacterName(name: string): string {
  return normalisePersonName(name)
    // Sources append the actor's own billing or a qualifier in brackets.
    .replace(/\((?:voice|uncredited|as [^)]*)\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Whether two character strings describe the same role.
 *
 * Containment counts, in either direction. `null` is returned for "no opinion" —
 * when either side is missing — which is what lets the caller tell an actual
 * disagreement apart from an absence, and those need opposite treatment.
 */
export function charactersAgree(a?: string, b?: string): boolean | null {
  const left = a ? normaliseCharacterName(a) : '';
  const right = b ? normaliseCharacterName(b) : '';
  if (!left || !right) return null;
  if (left === right) return true;
  return left.includes(right) || right.includes(left);
}

/** Cast, voice and guest credits all describe performers; crew does not. */
function roleClass(role: CreditRole): 'performer' | 'crew' {
  return role === CreditRole.Crew ? 'crew' : 'performer';
}

/**
 * Free-text job titles onto the normalised department vocabulary.
 *
 * Order matters: the tests are matched against the *most specific* pattern
 * first, so "Director of Photography" reaches `camera` rather than `directing`,
 * which is the one misclassification in this list that a reader would notice —
 * it puts the cinematographer under the film's director.
 */
const JOB_DEPARTMENTS: Array<[RegExp, Department]> = [
  [/director of photography|cinematograph|camera operator|\bdop\b/i, Department.Camera],
  [/costume|wardrobe|make-?up|hair\b/i, Department.Costume],
  [/visual effects|\bvfx\b|special effects|\bsfx\b/i, Department.VisualEffects],
  [/production design|art direction|art director|set dec/i, Department.Art],
  [/editor|editing|cutter/i, Department.Editing],
  [/compos|music|sound|audio|mixer|foley|score/i, Department.Sound],
  [/writer|writing|screenplay|teleplay|story|script|author|novel|creator|created by/i, Department.Writing],
  [/direct/i, Department.Directing],
  [/produc|showrunner|executive/i, Department.Production],
];

export function classifyJob(job: string | undefined): Department {
  if (!job) return Department.Crew;
  for (const [pattern, department] of JOB_DEPARTMENTS) {
    if (pattern.test(job)) return department;
  }
  return Department.Crew;
}

/** The longer of two strings, treating blank and whitespace as absent. */
function longer(a?: string, b?: string): string | undefined {
  const left = a?.trim();
  const right = b?.trim();
  if (!left) return right || undefined;
  if (!right) return left;
  return right.length > left.length ? right : left;
}

/** Merge `incoming` into `existing`, keeping whichever field is present. */
function foldPerson(existing: CreditPerson, incoming: CreditPerson): CreditPerson {
  return {
    ...existing,
    // A native spelling and a character are strictly additive: whoever has one
    // wins, and the longer string wins a tie because sources truncate.
    originalName: longer(existing.originalName, incoming.originalName),
    character: longer(existing.character, incoming.character),
    characterOriginalName: longer(
      existing.characterOriginalName,
      incoming.characterOriginalName
    ),
    job: existing.job ?? incoming.job,
    department: existing.department ?? incoming.department,
    // A stated billing order beats none; the lower number beats a higher one,
    // because a source that bills someone third and another that bills them
    // tenth disagree about prominence and the top billing is the safer claim.
    order:
      existing.order === undefined
        ? incoming.order
        : incoming.order === undefined
          ? existing.order
          : Math.min(existing.order, incoming.order),
    imageUrl: existing.imageUrl ?? incoming.imageUrl,
    characterImageUrl: existing.characterImageUrl ?? incoming.characterImageUrl,
    profileUrl: existing.profileUrl ?? incoming.profileUrl,
    episodeCount: existing.episodeCount ?? incoming.episodeCount,
    voiceLanguage: existing.voiceLanguage ?? incoming.voiceLanguage,
    // `role` is not folded: the first source to claim someone decides whether
    // they are cast or voice, and a later source disagreeing is not grounds to
    // reclassify a credit the viewer may already be looking at.
    sources: [...new Set([...existing.sources, ...incoming.sources])],
  };
}

/**
 * One list of credits from many, with duplicates folded.
 *
 * Input order is meaningful and preserved: callers pass their sources in
 * precedence order, and the first list to mention someone decides where they
 * appear and which `role` they carry.
 */
export function mergeCredits(lists: CreditPerson[][]): CreditPerson[] {
  const merged: CreditPerson[] = [];
  // Several credits can share a key (two John Williamses), so each key holds
  // the list of candidates rather than one — the character guard then decides
  // which, if any, the incoming credit belongs to.
  const byKey = new Map<string, number[]>();

  for (const list of lists) {
    for (const person of list) {
      if (!person.name?.trim()) continue;

      const key = `${roleClass(person.role)}:${normalisePersonName(person.name)}`;
      const candidates = byKey.get(key) ?? [];

      let targetIndex = -1;
      for (const index of candidates) {
        const existing = merged[index];
        if (roleClass(person.role) === 'crew') {
          // Crew: one person genuinely holds several jobs on one film (wrote
          // and directed it), and those are two credits, not one. Only an
          // identical job folds.
          if ((existing.job ?? '') === (person.job ?? '')) {
            targetIndex = index;
            break;
          }
          continue;
        }
        // Performers: merge unless both sides name a character and disagree.
        if (charactersAgree(existing.character, person.character) === false) continue;
        targetIndex = index;
        break;
      }

      if (targetIndex >= 0) {
        merged[targetIndex] = foldPerson(merged[targetIndex], person);
      } else {
        merged.push({ ...person, sources: [...person.sources] });
        byKey.set(key, [...candidates, merged.length - 1]);
      }
    }
  }

  return merged;
}

/**
 * Billing order, without inventing one.
 *
 * Credits that carry an `order` sort by it. Credits that do not keep their
 * relative input order and follow behind — never interleaved. Wikidata's SPARQL
 * answers are a *set* and come back in whatever order the query planner chose,
 * so treating a missing order as `0` would scatter unbilled extras through the
 * top of a cast list that TVmaze had ordered correctly.
 *
 * Stable, so two credits sharing an order stay as the sources listed them.
 */
export function orderCredits(people: CreditPerson[]): CreditPerson[] {
  const ordered = people
    .map((person, index) => ({ person, index }))
    .filter((entry) => entry.person.order !== undefined);
  const unordered = people
    .map((person, index) => ({ person, index }))
    .filter((entry) => entry.person.order === undefined);

  ordered.sort((a, b) => (a.person.order! - b.person.order!) || (a.index - b.index));

  return [...ordered, ...unordered].map((entry) => entry.person);
}

/**
 * Ratings from several sources, deduplicated on what they measure.
 *
 * The key is `(source, kind)` rather than `source`, because one source
 * legitimately publishes two: Rotten Tomatoes' critic and audience scores
 * routinely disagree by forty points, and that disagreement is information a
 * viewer uses. Where the same pair arrives twice the one with more votes wins —
 * it is the later or fuller fetch.
 */
export function mergeRatings(lists: TitleRating[][]): TitleRating[] {
  const byKey = new Map<string, TitleRating>();

  for (const list of lists) {
    for (const rating of list) {
      if (!Number.isFinite(rating.value)) continue;
      if (rating.scaleMax <= rating.scaleMin) continue;

      const key = `${rating.source}:${rating.kind ?? 'user'}`;
      const existing = byKey.get(key);
      if (!existing || (rating.votes ?? 0) > (existing.votes ?? 0)) {
        byKey.set(key, rating);
      }
    }
  }

  // Most-voted first: IMDb with 900,000 votes and a provider's own with 12 are
  // not comparable, and ordering them by value alone would put the noise first.
  return [...byKey.values()].sort((a, b) => (b.votes ?? 0) - (a.votes ?? 0));
}

/**
 * A rating on the 0–10 scale, for sorting and for one comparable headline
 * figure — or `null` when there is nothing to show.
 *
 * Two rules, both taken from upstream's `Score` and both load-bearing:
 *
 * **Scale on read, never on write.** The published value and its scale are what
 * is stored; this is the only place the conversion happens, so "91%" can be
 * rendered as "91%" beside a 9.1 without either being a lie.
 *
 * **Null at the floor.** A source that has no rating publishes `0`, not
 * `undefined` — Cinemeta omits `imdbRating`, AniList sends `averageScore: 0`,
 * TVmaze sends `average: null`. Scaling those produces `0.0`, which renders as
 * a real and terrible score rather than as an absent one. So the floor answers
 * `null` and the caller renders nothing.
 */
export function normalisedRating(rating: TitleRating): number | null {
  const span = rating.scaleMax - rating.scaleMin;
  if (span <= 0) return null;
  if (rating.value <= rating.scaleMin) return null;
  const scaled = ((rating.value - rating.scaleMin) / span) * 10;
  if (!Number.isFinite(scaled)) return null;
  return Math.round(scaled * 10) / 10;
}

/**
 * The crew credits a media application actually puts on screen.
 *
 * Computed, never stored — a second representation of one fact is a second
 * thing to keep in sync (PRD-41 §11.6).
 */
export function summariseCrew(people: CreditPerson[]): CrewSummary {
  const crew = people.filter((person) => person.role === CreditRole.Crew);
  const withJob = (pattern: RegExp) =>
    crew.filter((person) => pattern.test(person.job ?? ''));

  return {
    directors: withJob(/^director$|^directed by$|^film director$/i),
    writers: withJob(/writer|screenplay|teleplay|story|created by|creator|author/i),
    producers: withJob(/^producer$|executive producer|showrunner/i),
    composers: withJob(/compos|^music$|original music/i),
    cinematographers: withJob(/cinematograph|director of photography|^dop$/i),
  };
}

/** Notes from several sources, dropping exact repeats of the same text. */
export function mergeNotes(lists: ProductionNote[][]): ProductionNote[] {
  const seen = new Set<string>();
  const out: ProductionNote[] = [];
  for (const list of lists) {
    for (const note of list) {
      const text = note.text?.trim();
      if (!text) continue;
      const key = `${note.heading.toLowerCase()}:${text.slice(0, 120).toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ ...note, text });
    }
  }
  return out;
}

/** Videos from several sources, deduplicated on URL. */
export function mergeVideos(lists: TitleVideo[][]): TitleVideo[] {
  const byUrl = new Map<string, TitleVideo>();
  for (const list of lists) {
    for (const video of list) {
      if (!video.url) continue;
      if (!byUrl.has(video.url)) byUrl.set(video.url, video);
    }
  }
  return [...byUrl.values()];
}

/**
 * Distinct strings, order preserved, compared case-insensitively.
 *
 * Used for genres, countries and alternate titles, where two sources routinely
 * publish the same value with different capitalisation and a naive `Set` keeps
 * both.
 */
export function mergeStrings(lists: (string[] | undefined)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const list of lists) {
    for (const value of list ?? []) {
      const trimmed = value?.trim();
      if (!trimmed) continue;
      const key = trimmed.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(trimmed);
    }
  }
  return out;
}

/**
 * Distinct organisations, order preserved, compared on the name.
 *
 * The same rule as {@link mergeStrings} and it is needed for the same reason —
 * measured on Breaking Bad, TVmaze answers `AMC` and Wikidata's `P449` answers
 * `AMC`, so a plain concatenation renders "AMC, AMC" on the page. The first
 * entry wins where both carry a name, because the earlier source in the list is
 * the one with the link: TVmaze publishes an official site and Wikidata
 * publishes a label.
 */
export function mergeOrganisations(lists: (Organisation[] | undefined)[]): Organisation[] {
  const seen = new Map<string, Organisation>();
  for (const list of lists) {
    for (const entry of list ?? []) {
      const name = entry?.name?.trim();
      if (!name) continue;
      const key = name.toLowerCase();
      const existing = seen.get(key);
      if (!existing) {
        seen.set(key, { ...entry, name });
        continue;
      }
      // A later source may still contribute the parts the first one lacked —
      // but only when it actually has them. `??=` with an absent value writes
      // the key anyway, and this record is serialised to the cache file and
      // across the IPC boundary, where `imageUrl: undefined` is a field that
      // exists and is empty rather than a field nobody published.
      if (!existing.url && entry.url) existing.url = entry.url;
      if (!existing.imageUrl && entry.imageUrl) existing.imageUrl = entry.imageUrl;
    }
  }
  return [...seen.values()];
}

/**
 * The more precise of two ISO dates.
 *
 * Sources disagree about precision rather than about the date: Wikidata
 * publishes `2008-05-02`, Cinemeta `2008`. Longer is more precise, and a date
 * that disagrees in its year is rejected rather than picked between — that is
 * two sources describing different releases (a festival premiere against a
 * general one), and guessing which the viewer meant is worse than showing the
 * one already on screen.
 */
export function preferPreciseDate(a?: string, b?: string): string | undefined {
  if (!a) return b;
  if (!b) return a;
  if (a.slice(0, 4) !== b.slice(0, 4)) return a;
  return b.length > a.length ? b : a;
}

/** The list of sources that contributed anything, for the page's footer. */
export function contributingSources(people: CreditPerson[]): MetadataSource[] {
  const seen = new Set<MetadataSource>();
  for (const person of people) for (const source of person.sources) seen.add(source);
  return [...seen];
}
