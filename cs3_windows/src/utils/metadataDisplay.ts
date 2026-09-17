/**
 * Rendering rules for extended metadata. Pure, and tested.
 *
 * Its own file rather than more entries in `utils/format.ts`, which deliberately
 * preserves six mutually incompatible byte formatters and is the wrong place to
 * add anything that wants one obvious answer.
 *
 * What is actually hard here is **partial precision**. A release date arrives as
 * `2008`, `2008-05` or `2008-05-02` depending on which catalogue answered, and
 * the naive thing — hand the string to `new Date()` and format it — is wrong in
 * a way nobody would predict: `new Date('2008')` parses as UTC midnight on the
 * 1st of January, so a viewer west of Greenwich is shown **2007**. A film's
 * debut year being off by one, on a page whose whole job is to say what the
 * film is, is exactly the kind of small wrongness that makes a user stop
 * believing the rest of the page.
 *
 * So the string is read as the parts it has, and each precision is formatted as
 * what it actually says.
 */

/*
 * Note the `.ts` on the import below, where the rest of `src/utils/` omits it.
 * It is load-bearing. Node's type stripping is an ESM loader and will not
 * resolve an extensionless specifier, so this module could not be imported by
 * its own test without it. The neighbouring files get away with an
 * extensionless import only because theirs are `import type`, which is erased
 * entirely and never resolved at runtime — this one pulls `CreditRole` in as a
 * value. `allowImportingTsExtensions` is set in both tsconfigs and Vite
 * resolves it unchanged.
 */
import {
  CreditRole,
  type CreditPerson,
  type ExtendedMetadata,
  type MetadataSourceOutcome,
  type TitleRating,
  type TitleStatus,
} from '../types/metadata.ts';

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/**
 * An ISO date of any precision, as the most it actually claims.
 *
 * Never constructs a `Date`. Beyond the timezone trap in the header, a `Date`
 * would also happily accept `2008-13-45` and roll it forward into a plausible
 * date in the following year — turning a source's bad data into our confident
 * wrong answer rather than into no answer.
 */
export function formatReleaseDate(iso: string | undefined): string | null {
  if (!iso) return null;

  const match = iso.match(/^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/);
  if (!match) return null;

  const [, year, month, day] = match;
  if (!month) return year;

  const monthIndex = Number.parseInt(month, 10) - 1;
  const monthName = MONTHS[monthIndex];
  // A month outside 1–12 is a source error; degrade to the year rather than
  // rendering "undefined 2008".
  if (!monthName) return year;
  if (!day) return `${monthName} ${year}`;

  const dayNumber = Number.parseInt(day, 10);
  if (!Number.isFinite(dayNumber) || dayNumber < 1 || dayNumber > 31) {
    return `${monthName} ${year}`;
  }
  return `${dayNumber} ${monthName} ${year}`;
}

/**
 * A rating as the source published it.
 *
 * A 0–100 scale renders as a percentage and a 0–10 scale as a fraction, because
 * that is what each source *means* — converting Rotten Tomatoes' 91% into
 * "9.1/10" is not a unit conversion, it is a misquote. `normalisedRating` in
 * `electron/metadata/merge.ts` owns the comparable view, which exists for
 * sorting rather than for display.
 */
export function formatRating(rating: TitleRating): string | null {
  if (!Number.isFinite(rating.value)) return null;
  if (rating.value <= rating.scaleMin) return null;

  if (rating.scaleMin === 0 && rating.scaleMax === 100) {
    return `${Math.round(rating.value)}%`;
  }
  const decimals = rating.value % 1 === 0 ? 0 : 1;
  return `${rating.value.toFixed(decimals)}/${rating.scaleMax}`;
}

/** "IMDb", "AniList" — the name a viewer recognises, not the internal id. */
const SOURCE_LABELS: Record<string, string> = {
  cinemeta: 'IMDb',
  anilist: 'AniList',
  tvmaze: 'TVmaze',
  wikidata: 'Wikidata',
  wikipedia: 'Wikipedia',
  provider: 'Provider',
  rottenTomatoes: 'Rotten Tomatoes',
  metacritic: 'Metacritic',
};

export function sourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source;
}

/**
 * A vote count, short.
 *
 * Present because it is the thing that makes two ratings comparable at a glance
 * — 900,000 voters against 12 is the whole reason one of those numbers is worth
 * reading — and a raw `903418` in a chip is not legible at 0.75rem.
 */
export function formatVotes(votes: number | undefined): string | null {
  if (!votes || !Number.isFinite(votes) || votes <= 0) return null;
  if (votes >= 1_000_000) return `${(votes / 1_000_000).toFixed(1)}M`;
  if (votes >= 1_000) return `${Math.round(votes / 1_000)}K`;
  return String(votes);
}

/**
 * A box-office or budget figure.
 *
 * Rounded hard, and that is honest rather than lazy: these numbers are
 * aggregates that disagree between sources by millions, so rendering
 * `$402,453,882` claims a precision the underlying data does not have.
 */
export function formatMoney(amount: number | undefined, currency = 'USD'): string | null {
  if (!amount || !Number.isFinite(amount) || amount <= 0) return null;

  const symbol = currency === 'USD' ? '$' : currency === 'EUR' ? '€' : currency === 'GBP' ? '£' : '';
  const suffix = symbol ? '' : ` ${currency}`;

  if (amount >= 1_000_000_000) return `${symbol}${(amount / 1_000_000_000).toFixed(2)}B${suffix}`;
  if (amount >= 1_000_000) return `${symbol}${Math.round(amount / 1_000_000)}M${suffix}`;
  if (amount >= 1_000) return `${symbol}${Math.round(amount / 1_000)}K${suffix}`;
  return `${symbol}${Math.round(amount)}${suffix}`;
}

/** "2 h 46 min", or null. Minutes, unlike `format.ts`'s seconds-based one. */
export function formatRuntimeMinutes(minutes: number | undefined): string | null {
  if (!minutes || !Number.isFinite(minutes) || minutes <= 0) return null;
  const whole = Math.round(minutes);
  const hours = Math.floor(whole / 60);
  const rest = whole % 60;
  if (!hours) return `${rest} min`;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

export interface CastGroups {
  /** On-screen performers and voice credits, in billing order. */
  cast: CreditPerson[];
  crew: CreditPerson[];
}

/**
 * Performers from crew.
 *
 * Voice credits sit with the cast rather than in their own third rail: for
 * anime they *are* the cast, and splitting them out would leave an anime page
 * with an empty "Cast" heading above a populated "Voice" one — which reads as
 * the lookup having failed.
 */
export function groupCredits(people: CreditPerson[] | undefined): CastGroups {
  const cast: CreditPerson[] = [];
  const crew: CreditPerson[] = [];

  for (const person of people ?? []) {
    if (person.role === CreditRole.Crew) crew.push(person);
    else cast.push(person);
  }

  return { cast, crew };
}

/**
 * How a person is billed, as one line.
 *
 * The brief's "all of names with original name": both are shown when they
 * differ, and the *character* carries its own pair independently. A native
 * spelling identical to the display name is suppressed — repeating "Tom Hardy
 * (Tom Hardy)" is noise that makes the rows that genuinely differ harder to
 * spot.
 */
export function describeCredit(person: CreditPerson): {
  name: string;
  secondaryName: string | null;
  character: string | null;
  characterSecondary: string | null;
  note: string | null;
} {
  const secondaryName =
    person.originalName && person.originalName.trim() !== person.name.trim()
      ? person.originalName
      : null;

  const characterSecondary =
    person.character &&
    person.characterOriginalName &&
    person.characterOriginalName.trim() !== person.character.trim()
      ? person.characterOriginalName
      : null;

  const parts: string[] = [];
  if (person.role === CreditRole.Voice) {
    parts.push(person.voiceLanguage ? `${person.voiceLanguage} voice` : 'Voice');
  }
  if (person.episodeCount && person.episodeCount > 0) {
    parts.push(`${person.episodeCount} ep${person.episodeCount === 1 ? '' : 's'}`);
  }

  return {
    name: person.name,
    secondaryName,
    character: person.character ?? null,
    characterSecondary,
    note: parts.length ? parts.join(' · ') : null,
  };
}

/**
 * Whether there is anything at all worth drawing.
 *
 * The page must render *nothing* rather than an empty set of headings while the
 * four catalogues are still being asked: a "Cast" heading above a blank space
 * reads as a lookup that failed, which is the one impression this feature must
 * not leave on a title that simply has no entry anywhere.
 */
export function hasAnything(metadata: ExtendedMetadata | null | undefined): boolean {
  if (!metadata) return false;
  return Boolean(
    metadata.people?.length ||
      metadata.ratings?.length ||
      metadata.production?.length ||
      metadata.trivia?.length ||
      metadata.awards?.length ||
      metadata.keywords?.length ||
      metadata.videos?.length ||
      metadata.releaseDate ||
      metadata.budget ||
      metadata.revenue ||
      metadata.studios?.length ||
      metadata.genres?.length ||
      metadata.networks?.length ||
      metadata.certifications?.length ||
      metadata.runtimeMinutes ||
      metadata.status ||
      metadata.seasonCount ||
      metadata.episodeCount ||
      metadata.countries?.length ||
      metadata.spokenLanguages?.length
  );
}

/**
 * A status to the word a viewer would use.
 *
 * `released` is deliberately **not** rendered for a film: every film on the
 * page is released, so the chip carries no information and costs a row. It is
 * kept in the record because a catalogue publishing it is a fact, and because
 * an upcoming title flips to it — the absence on screen is a display decision,
 * not a gap in the data.
 */
export function formatStatus(status: TitleStatus | undefined): string | null {
  switch (status) {
    case 'ongoing':
      return 'Ongoing';
    case 'ended':
      return 'Ended';
    case 'cancelled':
      return 'Cancelled';
    case 'hiatus':
      return 'On hiatus';
    case 'upcoming':
      return 'Not yet released';
    default:
      return null;
  }
}

/** `3 seasons · 62 episodes`, or whichever half is known. */
export function formatSeasonCount(
  seasons: number | undefined,
  episodes: number | undefined
): string | null {
  const parts: string[] = [];
  if (seasons && seasons > 0) parts.push(`${seasons} season${seasons === 1 ? '' : 's'}`);
  if (episodes && episodes > 0) parts.push(`${episodes} episode${episodes === 1 ? '' : 's'}`);
  return parts.length ? parts.join(' · ') : null;
}

/**
 * `US: PG-13`, and never a bare `PG-13`.
 *
 * A certification without its country is unreadable rather than merely terse:
 * `15` is a BBFC rating in the UK and means nothing in the US, and `R` differs
 * between the MPA and several national boards. The country is what makes the
 * symbol resolvable.
 */
export function formatCertifications(
  certifications: ExtendedMetadata['certifications']
): string | null {
  const rows = (certifications ?? []).filter((entry) => entry.rating?.trim());
  if (rows.length === 0) return null;
  return rows.map((entry) => `${entry.country}: ${entry.rating}`).join(', ');
}

/**
 * Whether a source is still expected to answer.
 *
 * Used only to decide between "still looking" and "there is nothing" — and the
 * distinction matters, because those two states look identical and one of them
 * is worth waiting for. A `skipped` source is not pending: it was never going
 * to answer and saying otherwise would leave a spinner up forever.
 */
export function stillLoading(metadata: ExtendedMetadata | null | undefined): boolean {
  return Boolean(metadata?.partial);
}

/** Sources that failed, for the diagnostics line. Never shown as an error. */
export function failedSources(outcomes: MetadataSourceOutcome[] | undefined): string[] {
  return (outcomes ?? [])
    .filter((entry) => entry.status === 'failed')
    .map((entry) => sourceLabel(entry.source));
}

/** Sources that actually contributed, for the attribution line. */
export function answeringSources(outcomes: MetadataSourceOutcome[] | undefined): string[] {
  return (outcomes ?? [])
    .filter((entry) => entry.status === 'ok')
    .map((entry) => sourceLabel(entry.source));
}
