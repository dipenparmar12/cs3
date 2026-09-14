/**
 * Extended title metadata — the cast, crew, ratings and production facts a
 * media application shows, which the scraping corpus cannot supply.
 *
 * ## Why this is a separate record from `LoadResponse`
 *
 * `LoadResponse.actors` is `string[]`. That is upstream's shape and it is what
 * a `.cs3` provider can fill in, because a provider is a *site scraper*: it
 * knows the page it parsed and nothing else. A scraper for a file host has no
 * opinion about who directed the film, what Robert Downey Jr. looks like, which
 * character he played, or what IMDb's 900,000 voters thought. Widening
 * `LoadResponse` would therefore have added a dozen fields that ~every provider
 * in the corpus leaves undefined, and the page would look exactly as it does now.
 *
 * So this is a **second record, fetched separately and merged at the edge**:
 * the provider answers "what can I play", the catalogues answer "what is this".
 * Both keyed on the same title. That split is also what makes this enrichable
 * in the background — a detail page renders from the provider's answer
 * immediately and gains cast photos a second later, rather than waiting on four
 * third-party APIs before it draws anything.
 *
 * ## The constraint that shaped every source choice
 *
 * **The user must not have to obtain an API key.** `cs3/discovery.ts` settled
 * this for the home screen and the same reasoning applies here, more sharply:
 * a key embedded in a distributed GPL client is both a licence violation and a
 * key that gets revoked, at which point the feature dies for everyone at once.
 * That eliminates TMDB, Trakt, OMDb, Fanart and TheTVDB as *direct* sources —
 * which is most of what a search for "movie metadata API" returns.
 *
 * What survives is narrower and, for this specific brief, very nearly as good:
 * Wikidata carries the cast-with-characters that TMDB is usually reached for,
 * TVmaze carries it for television with real photographs, and AniList carries
 * characters *and* their voice actors for anime. See `electron/metadata/` for
 * what each was chosen to answer and what it cannot.
 *
 * ## This is a superset of PRD-41 §11, not a replacement for it
 *
 * PRD-41 specifies `MediaDetail` for the extension platform that does not exist
 * yet, where a provider *declares* this data. These types deliberately mirror
 * its names (`Person.role`/`department`/`job`, `Rating.scaleMin`/`scaleMax`) so
 * that when a provider can finally supply them there is one shape, not two.
 * Fields PRD-41 has that nothing keyless can fill are omitted rather than
 * carried empty.
 */

/**
 * Stable identities for one work, across the databases that know about it.
 *
 * The whole enrichment chain hangs off these: Wikidata is reached by matching
 * `imdb` against P345, TVmaze by `/lookup/shows?imdb=`, AniList by its own id.
 * A title with none of them cannot be enriched, which is the honest answer for
 * a scraped release name nothing recognises.
 */
export interface ExternalIds {
  /** `tt1375666`. The most broadly useful id there is; every source maps it. */
  imdb?: string;
  tmdb?: number;
  tvdb?: number;
  tvmaze?: number;
  anilist?: number;
  mal?: number;
  /** Wikidata entity id, `Q25188`. */
  wikidata?: string;
}

/** Which catalogue an individual fact came from. Shown, never inferred. */
export const MetadataSource = {
  Cinemeta: 'cinemeta',
  TvMaze: 'tvmaze',
  AniList: 'anilist',
  Wikidata: 'wikidata',
  Wikipedia: 'wikipedia',
  /** The extension or native provider that served the detail page itself. */
  Provider: 'provider',
} as const;
export type MetadataSource = (typeof MetadataSource)[keyof typeof MetadataSource];

/**
 * How someone is connected to the work.
 *
 * `voice` is separate from `cast` rather than a flag on it because the two
 * render differently and mean different things: a voice actor is billed against
 * a character they are not seen as, and for anime — where the same character
 * has a Japanese and an English voice — one character carries several.
 */
export const CreditRole = {
  Cast: 'cast',
  Voice: 'voice',
  Guest: 'guest',
  Crew: 'crew',
} as const;
export type CreditRole = (typeof CreditRole)[keyof typeof CreditRole];

/**
 * The crew department, normalised. TMDB's vocabulary, because it is the one the
 * rest of the world has standardised on and it maps cleanly from every source
 * here; `job` keeps whatever the source actually said.
 */
export const Department = {
  Directing: 'directing',
  Writing: 'writing',
  Production: 'production',
  Camera: 'camera',
  Editing: 'editing',
  Sound: 'sound',
  Art: 'art',
  Costume: 'costume',
  VisualEffects: 'visual_effects',
  Crew: 'crew',
} as const;
export type Department = (typeof Department)[keyof typeof Department];

/**
 * One person's credit on one title.
 *
 * The brief asked for "all the names with the original name", and that is two
 * distinct pairs, not one: the **performer** has a name and may have a native
 * spelling (雨宮天 beside Sora Amamiya), and so does the **character**. Both
 * pairs are carried, because collapsing either loses exactly the information
 * that makes a cast list useful for non-English content — which is most of what
 * this app's corpus actually serves.
 */
export interface CreditPerson {
  /** Display name, in the script the viewer's catalogue uses. */
  name: string;
  /** The name in the original language, where it differs from `name`. */
  originalName?: string;
  role: CreditRole;
  /** Cast and voice: who they play. */
  character?: string;
  /** The character's name in the original language. */
  characterOriginalName?: string;
  /** Crew: the normalised department, for grouping. */
  department?: Department;
  /** Crew: the job as the source stated it ("Director", "Screenplay"). */
  job?: string;
  /**
   * Billing order, ascending, where the source publishes one.
   *
   * Kept optional rather than defaulted, because a source with no ordering
   * (Wikidata returns a set, not a list) must not be silently interleaved into
   * the middle of one that has it — see `orderCredits` in `metadata/merge.ts`.
   */
  order?: number;
  /** Headshot. Absent far more often than not; the UI falls back to initials. */
  imageUrl?: string;
  /** Artwork of the character rather than the performer. Anime, mostly. */
  characterImageUrl?: string;
  /** A page about this person, for the viewer to read more. */
  profileUrl?: string;
  /** Series: separates a regular from a one-episode guest. */
  episodeCount?: number;
  /** Voice credits: the language this performance is in, BCP-47 where known. */
  voiceLanguage?: string;
  /** Which catalogues contributed to this credit. */
  sources: MetadataSource[];
}

/** What a rating measures. One source can publish several. */
export const RatingKind = {
  User: 'user',
  Critic: 'critic',
  Audience: 'audience',
} as const;
export type RatingKind = (typeof RatingKind)[keyof typeof RatingKind];

/**
 * One published score, on its own scale.
 *
 * **Never normalised on the way in** (PRD-41 §11.5). IMDb is 0–10 to one
 * decimal, Rotten Tomatoes is a 0–100 percentage, AniList is 0–100, MyAnimeList
 * is 0–10 to two. Collapsing them at ingest renders "91%" as "9.1", which is
 * wrong in the particular way that makes a viewer distrust every other number
 * on the page. Store what was published; scale at read time, for sorting only.
 */
export interface TitleRating {
  source: MetadataSource | string;
  kind?: RatingKind;
  value: number;
  scaleMin: number;
  scaleMax: number;
  votes?: number;
  /** Where it came from, so the figure is checkable rather than asserted. */
  url?: string;
}

/**
 * A block of prose about the making of the title.
 *
 * This is the brief's "behind the scenes" and "trivia", and it is the one part
 * of this record that is *someone else's writing* rather than a fact. So it
 * carries its attribution structurally rather than by convention: Wikipedia is
 * CC BY-SA, which requires crediting the source and naming the licence, and an
 * attribution the UI can forget to render is one it will eventually forget to
 * render. Nothing constructs a `ProductionNote` without one.
 */
export interface ProductionNote {
  /** The section it came from — "Production", "Filming", "Reception". */
  heading: string;
  text: string;
  attribution: {
    source: MetadataSource | string;
    /** The exact page, deep-linked to the section where possible. */
    url: string;
    /** e.g. `CC BY-SA 4.0`. Named, not implied. */
    licence: string;
  };
}

/** A named organisation behind the title. */
export interface Organisation {
  name: string;
  /** Logo or wordmark, where the source has one. */
  imageUrl?: string;
  url?: string;
}

/** A trailer or featurette, addressed so the UI can decide how to open it. */
export interface TitleVideo {
  title: string;
  url: string;
  kind: 'trailer' | 'teaser' | 'clip' | 'featurette';
  /** `youtube` where the URL is a YouTube watch page, else `web`. */
  host: 'youtube' | 'web';
  thumbnailUrl?: string;
}

/**
 * Whether one source answered, and why it did not.
 *
 * Reported rather than swallowed, for the reason `explainMissingProvider`
 * exists: "we found no cast for this film" and "Wikidata was unreachable" are
 * different sentences and only one of them is worth the viewer's attention. A
 * source that legitimately has nothing (Wikidata has no entry for a 2024 direct-
 * to-web release) is `empty`, which is not a failure — the same distinction
 * `providerAnalytics` draws for exactly the same reason.
 */
export interface MetadataSourceOutcome {
  source: MetadataSource;
  status: 'ok' | 'empty' | 'failed' | 'skipped';
  /** Why, for `failed` and `skipped`. Rendered in diagnostics, not on the page. */
  reason?: string;
  /** How long it took, so a slow source is identifiable rather than suspected. */
  ms?: number;
}

/**
 * Everything the catalogues know about one title, merged.
 *
 * Every field is optional because every field has a source that may be down,
 * and a page that renders half of this is worth far more than one that waits
 * for all of it.
 */
export interface ExtendedMetadata {
  /** The address this was fetched for, echoed so a late reply can be placed. */
  url: string;
  ids: ExternalIds;

  /** The title in its original language, where it differs from the display one. */
  originalTitle?: string;
  /** BCP-47 of `originalTitle`. */
  originalLanguage?: string;
  /** Other names the work is known by — release names match these. */
  alternateTitles?: string[];

  tagline?: string;
  /** Long-form plot, where a source has one longer than the provider's. */
  plot?: string;

  /**
   * The debut the brief asked for: full ISO date, not just the year.
   *
   * Distinct from `LoadResponse.year` on purpose — "2008" and
   * "2008-05-02" answer different questions, and the second is the one a
   * viewer means by "when did this come out".
   */
  releaseDate?: string;
  endDate?: string;

  runtimeMinutes?: number;
  /** ISO 3166-1 alpha-2, where the source publishes codes. */
  countries?: string[];
  /** BCP-47 language codes of the original audio. */
  spokenLanguages?: string[];

  ratings?: TitleRating[];
  /** Per-country age rating, as published ("US: PG-13"). */
  certifications?: { country: string; rating: string }[];

  /** Cast, voice and crew in one list; `role` separates them. */
  people?: CreditPerson[];

  studios?: Organisation[];
  networks?: Organisation[];
  /** As published, in the currency `currency` names. */
  budget?: number;
  revenue?: number;
  currency?: string;

  /** Awards, as the source phrases them. Free text; nobody publishes this well. */
  awards?: string[];
  /** Keywords/themes — TMDB-style, distinct from genre. */
  keywords?: string[];

  /** "Behind the scenes": production prose, attributed. */
  production?: ProductionNote[];
  /** Free-standing facts, attributed the same way. */
  trivia?: ProductionNote[];

  videos?: TitleVideo[];
  /** Wide artwork for the page header, where a source has one. */
  backdropUrl?: string;
  logoUrl?: string;

  /** Per-source result, including the ones that answered nothing. */
  outcomes: MetadataSourceOutcome[];
  /** Epoch millis this record was assembled. */
  fetchedAt: number;
  /**
   * True while more sources are still being asked.
   *
   * The point of the whole design: a partial record is delivered as soon as the
   * first source answers, and the UI renders it rather than a spinner.
   */
  partial?: boolean;
}

/** Convenience shape for the UI's crew row; computed, never stored. */
export interface CrewSummary {
  directors: CreditPerson[];
  writers: CreditPerson[];
  producers: CreditPerson[];
  composers: CreditPerson[];
  cinematographers: CreditPerson[];
}
