/**
 * Extended metadata: which catalogues to ask, in what order, and what to do
 * when one of them does not answer.
 *
 * ## The shape of this is decided by one measurement nobody needs to repeat
 *
 * Four third-party APIs, each on someone else's infrastructure, are being asked
 * about a title the viewer is already looking at. The slowest of them decides
 * how long a blocking version would take, and Wikidata's SPARQL endpoint under
 * load is measured in *seconds*. A detail page that waited for all four before
 * drawing would be strictly worse than today's page, which draws immediately
 * and shows a flat list of names.
 *
 * So this is **push-shaped**, like `playback:*` and `search:*` and for exactly
 * the same reason those are: `enrich()` returns whatever is already known
 * immediately and emits a fuller snapshot as each source lands. The page renders
 * from the provider's own answer, gains a cast rail a second later, and gains
 * production notes after that. Nothing on screen ever waits on the slowest host.
 *
 * ## Every source fails alone
 *
 * `Promise.allSettled` throughout, and a per-source `MetadataSourceOutcome`
 * recorded either way. Two rules behind that:
 *
 * **A source with nothing is not a source that failed.** Wikidata genuinely has
 * no entry for many 2024 streaming releases. Reporting that as an error puts a
 * red state on a page that is simply about an obscure title — the same
 * distinction `providerAnalytics` draws between `empty` and `failure`, and it
 * matters here for the same reason: these outcomes are what a reader would use
 * to decide something is broken.
 *
 * **The reason is kept even though the page does not show it.** "Wikidata
 * timed out" and "this film has no Wikidata entry" produce identical screens
 * and completely different diagnoses, and the second question always comes
 * after a report of the first.
 *
 * ## Caching
 *
 * Its own file, not the datastore, for `detailCache`'s reason: this is derived
 * data that can be rebuilt at any time and has no business inflating a user's
 * backup. Stale-while-revalidate, with a long freshness window — a 1994 film's
 * cast does not change, and the cost of a stale entry is a missing recent
 * credit rather than anything wrong.
 *
 * ## Nothing about the viewer leaves the machine
 *
 * Same guarantee `discovery.ts` makes. Every request here is keyed on a public
 * identifier for a public work — an IMDb id, an AniList id, a Wikipedia article
 * title. No query text, no library contents, no viewing history, and no API key
 * to tie requests together into a profile.
 */

import { app } from 'electron';
import path from 'path';

import { JsonFileStore } from '../util/jsonFileStore.ts';
import { TvType } from '../../src/types/api.ts';
import {
  MetadataSource,
  type ExtendedMetadata,
  type ExternalIds,
  type MetadataSourceOutcome,
} from '../../src/types/metadata.ts';
import {
  mergeCredits,
  mergeNotes,
  mergeOrganisations,
  mergeRatings,
  mergeStrings,
  mergeVideos,
  orderCredits,
  preferPreciseDate,
} from './merge.ts';
import { fetchWikidata, type WikidataResult } from './wikidata.ts';
import {
  fetchCredits as fetchTvMazeCredits,
  fetchShowFacts,
  lookupByImdb,
  type TvMazeShowFacts,
} from './tvmaze.ts';
import {
  fetchAniListCredits,
  searchAniListId,
  type AniListCredits,
} from './anilist.ts';
import type { TitleEnricher } from '../cs3/titleEnricher.ts';
import { fetchWikipediaNotes, type WikipediaNotes } from './wikipedia.ts';
import { parseCinemetaExtras, type CinemetaExtras } from './cinemetaExtras.ts';
import { fetchJson } from '../torrent/http.ts';

const FILE_NAME = 'cs3-metadata-cache.json';

/** Past this a hit is still served and a refresh runs behind it. */
const FRESH_MS = 7 * 24 * 60 * 60 * 1000;

/** Past this an entry is dropped. Long, because most of this never changes. */
const MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

/** Records retained. Cast lists with image URLs are not small. */
const MAX_ENTRIES = 250;

const WRITE_DEBOUNCE_MS = 2_000;

const CINEMETA_BASE = 'https://v3-cinemeta.strem.io';

interface CacheEntry {
  metadata: ExtendedMetadata;
  at: number;
}

type CacheRow = { url: string; entry: CacheEntry };

/** What the caller knows about the title before anything is fetched. */
export interface EnrichmentRequest {
  /** The detail address. The cache key, and echoed back on every snapshot. */
  url: string;
  ids: ExternalIds;
  type?: TvType;
  title?: string;
  year?: number;
}

/** Called with a fuller record each time a source lands. */
export type EnrichmentListener = (metadata: ExtendedMetadata) => void;

const ANIME_TYPES = new Set<TvType>([TvType.Anime, TvType.AnimeMovie, TvType.OVA]);
const SERIES_TYPES = new Set<TvType>([
  TvType.TvSeries,
  TvType.Anime,
  TvType.AsianDrama,
  TvType.Documentary,
]);

/**
 * Which Cinemeta catalogue an item belongs to.
 *
 * Asking the wrong one answers 404 rather than an error, so a mistake here
 * reads as "Cinemeta has no entry" — an `empty` outcome for a title it holds
 * perfectly well.
 */
function cinemetaType(type: TvType | undefined): 'movie' | 'series' {
  return type && SERIES_TYPES.has(type) ? 'series' : 'movie';
}

/**
 * The ids carried by a `cs3meta://` address.
 *
 * The address is the one identity that survives everything — it is what the
 * library, the bookmarks and the cache all key on — so reading the ids back out
 * of it costs nothing and works for a title whose detail record has since been
 * evicted.
 */
export function idsFromUrl(url: string): ExternalIds {
  const cinemeta = url.match(/^cs3meta:\/\/cinemeta\/(?:movie|series)\/(tt\d+)/);
  if (cinemeta) return { imdb: cinemeta[1] };

  const anilist = url.match(/^cs3meta:\/\/anilist\/(\d+)/);
  if (anilist) return { anilist: Number.parseInt(anilist[1], 10) };

  const tvmaze = url.match(/^cs3meta:\/\/tvmaze\/(\d+)/);
  if (tvmaze) return { tvmaze: Number.parseInt(tvmaze[1], 10) };

  return {};
}

/** An outcome, timed, so a slow source is identifiable rather than suspected. */
function outcome(
  source: MetadataSource,
  status: MetadataSourceOutcome['status'],
  startedAt: number,
  reason?: string
): MetadataSourceOutcome {
  return { source, status, reason, ms: Date.now() - startedAt };
}

/** A thrown value to one line a person can read. */
function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export class MetadataEnrichmentService {
  private entries = new Map<string, CacheEntry>();
  private readonly store: JsonFileStore<CacheRow[]>;

  /**
   * Runs in flight, so two callers for one title join rather than doubling the
   * request count against four third-party hosts. Same rule as
   * `sharedDiscovery.ts`, and the cost of getting it wrong is the same: opening
   * a detail page twice in quick succession is completely ordinary.
   */
  private inFlight = new Map<string, Promise<ExtendedMetadata>>();

  private listener: EnrichmentListener | null = null;

  /**
   * How a title with no IMDb id gets one.
   *
   * This is the difference between "some detail pages are complete and some
   * show a row of names" and every page being the same. Every source here
   * except AniList is reached *through* an IMDb id, and a `cs3ext://` page
   * from a scraper routinely has none — the provider parsed a streaming site,
   * and the site never printed one. Those pages recorded four `skipped`
   * outcomes and rendered nothing, for no reason other than a missing key.
   *
   * `TitleEnricher` already resolves a release name to a catalogue record with
   * exactly the conservatism this needs (a disagreeing year disqualifies; the
   * similarity bar is high enough that `Avengers` does not match
   * `Avengers: Endgame`), and `main.ts` already constructs one. Optional so the
   * service still stands up in a test without a network.
   */
  private readonly resolver: TitleEnricher | null;

  constructor(baseDir?: string, resolver?: TitleEnricher) {
    this.resolver = resolver ?? null;
    const dir = baseDir ?? app.getPath('userData');
    this.store = new JsonFileStore<CacheRow[]>(
      path.join(dir, FILE_NAME),
      WRITE_DEBOUNCE_MS,
      () => this.serialise()
    );
    this.load();
  }

  /** Wired by `main.ts` so a fuller record reaches whoever is looking at it. */
  public setListener(listener: EnrichmentListener | null): void {
    this.listener = listener;
  }

  private load(): void {
    const rows = this.store.load();
    if (!Array.isArray(rows)) return;
    const now = Date.now();
    for (const row of rows) {
      if (!row?.url || !row.entry?.metadata) continue;
      if (now - row.entry.at > MAX_AGE_MS) continue;
      this.entries.set(row.url, row.entry);
    }
  }

  private serialise(): CacheRow[] {
    return [...this.entries.entries()].map(([url, entry]) => ({ url, entry }));
  }

  private write(url: string, metadata: ExtendedMetadata): void {
    this.entries.set(url, { metadata, at: Date.now() });
    // Oldest first, so the eviction drops what is least likely to be reopened.
    while (this.entries.size > MAX_ENTRIES) {
      const oldest = [...this.entries.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (!oldest) break;
      this.entries.delete(oldest[0]);
    }
    this.store.schedule();
  }

  /**
   * What is already known, without fetching anything.
   *
   * A `peek`, deliberately: the caller uses this to decide whether to render
   * immediately, and a read that promoted the entry or started a fetch would
   * make that decision have side effects. `SourcePrefetcher` needs the same
   * thing from `SourceCache` for the same reason.
   */
  public peek(url: string): { metadata: ExtendedMetadata; stale: boolean } | null {
    const entry = this.entries.get(url);
    if (!entry) return null;
    const age = Date.now() - entry.at;
    if (age > MAX_AGE_MS) {
      this.entries.delete(url);
      return null;
    }
    return { metadata: entry.metadata, stale: age > FRESH_MS };
  }

  public clear(): number {
    const count = this.entries.size;
    this.entries.clear();
    this.store.schedule();
    return count;
  }

  public flush(): void {
    this.store.flush();
  }

  /**
   * The cached record if there is one, and a fetch behind it when it is stale.
   *
   * The returned promise resolves with whatever is available *now* — a hit, or
   * the result of the fetch when there is no hit. Progressive updates arrive
   * through the listener either way, which is what lets a stale hit render at
   * once and be replaced a moment later rather than blocking on a refresh.
   */
  public async enrich(
    request: EnrichmentRequest,
    signal?: AbortSignal
  ): Promise<ExtendedMetadata> {
    const cached = this.peek(request.url);
    if (cached && !cached.stale) return cached.metadata;

    const running = this.inFlight.get(request.url);
    if (running) {
      // A stale hit beats waiting for a refresh that is already someone else's.
      return cached ? cached.metadata : running;
    }

    const task = this.run(request, signal)
      .catch((error) => {
        // Never reject the caller over an enrichment: the page has a complete,
        // useful detail on screen already, and replacing it with an error
        // because a *background* extra failed is strictly worse than saying
        // nothing. Same argument `revalidateDetail` makes.
        return this.emptyRecord(request, [
          {
            source: MetadataSource.Provider,
            status: 'failed',
            reason: describe(error),
          },
        ]);
      })
      .finally(() => {
        this.inFlight.delete(request.url);
      });

    this.inFlight.set(request.url, task);
    return cached ? cached.metadata : task;
  }

  private emptyRecord(
    request: EnrichmentRequest,
    outcomes: MetadataSourceOutcome[]
  ): ExtendedMetadata {
    return {
      url: request.url,
      ids: { ...request.ids, ...idsFromUrl(request.url) },
      outcomes,
      fetchedAt: Date.now(),
    };
  }

  /**
   * The fetch, in two phases.
   *
   * Phase one asks the four independent sources at once. Phase two asks
   * Wikipedia, which cannot run earlier because the *only* safe way to reach
   * the right article is the sitelink Wikidata returns — see `wikipedia.ts` for
   * why searching for it is not an option.
   */
  private async run(
    request: EnrichmentRequest,
    signal?: AbortSignal
  ): Promise<ExtendedMetadata> {
    const ids: ExternalIds = { ...idsFromUrl(request.url), ...request.ids };
    const outcomes: MetadataSourceOutcome[] = [];

    let cinemeta: CinemetaExtras | null = null;
    let wikidata: WikidataResult | null = null;
    let anilist: AniListCredits | null = null;
    let tvmaze: Awaited<ReturnType<typeof fetchTvMazeCredits>> | null = null;
    let tvmazeFacts: TvMazeShowFacts | null = null;
    let wikipedia: WikipediaNotes | null = null;

    /**
     * What the catalogues believe this is, when the provider had no id.
     *
     * Awaited rather than raced with the rest, because every source below is
     * addressed *by* the id it produces — starting the fan-out first would mean
     * starting it with nothing to ask about. The cost is one Cinemeta search on
     * a page that is currently blank, and `TitleEnricher` caches its answer for
     * a week, so reopening the title pays nothing.
     */
    let resolvedType: 'movie' | 'series' | undefined;
    if (!ids.imdb && request.title && this.resolver) {
      const startedAt = Date.now();
      try {
        const match = await this.resolver.resolve(request.title, {
          type: request.type,
          year: request.year,
        });
        if (match) {
          ids.imdb = match.imdbId;
          resolvedType = match.type;
        } else {
          outcomes.push(
            outcome(
              MetadataSource.Provider,
              'empty',
              startedAt,
              'no catalogue entry confidently matches this title'
            )
          );
        }
      } catch (error) {
        // Never fatal. The page still gets whatever AniList can answer, and the
        // skipped outcomes below name the missing id as the cause.
        outcomes.push(outcome(MetadataSource.Provider, 'failed', startedAt, describe(error)));
      }
    }

    /** Emits a snapshot of everything known so far, if anyone is listening. */
    const publish = (partial: boolean) => {
      const snapshot = this.assemble(
        request,
        ids,
        { cinemeta, wikidata, anilist, tvmaze, tvmazeFacts, wikipedia },
        outcomes,
        partial
      );
      if (partial) this.listener?.(snapshot);
      return snapshot;
    };

    const tasks: Promise<void>[] = [];

    if (ids.imdb) {
      const startedAt = Date.now();
      tasks.push(
        fetchJson<Parameters<typeof parseCinemetaExtras>[0]>(
          // The resolved kind wins where there is one: it came from the
          // catalogue that holds the record, while `request.type` is a
          // provider's label and plenty of the corpus calls everything "Movie".
          `${CINEMETA_BASE}/meta/${resolvedType ?? cinemetaType(request.type)}/${ids.imdb}.json`,
          { signal, timeoutMs: 12_000, retries: 0 }
        )
          .then((body) => {
            // The endpoint wraps the record; a 200 with no `meta` is Cinemeta
            // saying it has no entry, which is `empty` rather than a failure.
            const meta = (body as unknown as { meta?: Parameters<typeof parseCinemetaExtras>[0] })
              ?.meta;
            cinemeta = parseCinemetaExtras(meta);
            outcomes.push(
              outcome(
                MetadataSource.Cinemeta,
                cinemeta.people.length || cinemeta.ratings.length ? 'ok' : 'empty',
                startedAt
              )
            );
          })
          .catch((error) => {
            outcomes.push(
              outcome(MetadataSource.Cinemeta, 'failed', startedAt, describe(error))
            );
          })
          .then(() => void publish(true))
      );

      const wikidataStartedAt = Date.now();
      tasks.push(
        fetchWikidata(ids.imdb, signal)
          .then((result) => {
            wikidata = result;
            if (result.facts?.entity) ids.wikidata = result.facts.entity;
            outcomes.push(
              outcome(
                MetadataSource.Wikidata,
                result.credits.length || result.facts ? 'ok' : 'empty',
                wikidataStartedAt
              )
            );
          })
          .catch((error) => {
            outcomes.push(
              outcome(MetadataSource.Wikidata, 'failed', wikidataStartedAt, describe(error))
            );
          })
          .then(() => void publish(true))
      );
    } else {
      // Named precisely, because the two causes need different fixes: a title
      // nobody could resolve is a limit of the catalogues, and a title nobody
      // *tried* to resolve is a wiring fault in this service.
      const reason = request.title
        ? 'no IMDb id, and this title matched no catalogue entry'
        : 'no IMDb id for this title';
      outcomes.push({ source: MetadataSource.Cinemeta, status: 'skipped', reason });
      outcomes.push({ source: MetadataSource.Wikidata, status: 'skipped', reason });
    }

    // Television only. Asking TVmaze about a film is a guaranteed 404 and a
    // wasted round trip — it is a TV database, which is why `cinemeta.ts`
    // displaced it as the primary catalogue in the first place.
    const wantsTvMaze =
      Boolean(ids.tvmaze) || (Boolean(ids.imdb) && SERIES_TYPES.has(request.type ?? TvType.Movie));
    if (wantsTvMaze) {
      const startedAt = Date.now();
      tasks.push(
        (async () => {
          const showId = ids.tvmaze ?? (await lookupByImdb(ids.imdb as string, signal));
          if (!showId) {
            outcomes.push(
              outcome(MetadataSource.TvMaze, 'empty', startedAt, 'not in the TVmaze catalogue')
            );
            return;
          }
          ids.tvmaze = showId;
          // Settled independently: the show record carries the status, the
          // network and the season counts, and the cast carries the people. A
          // failure in either half must not discard the other — the same rule
          // `fetchCredits` already applies to its own two endpoints.
          const [credits, facts] = await Promise.allSettled([
            fetchTvMazeCredits(showId, signal),
            fetchShowFacts(showId, signal),
          ]);
          if (credits.status === 'fulfilled') tvmaze = credits.value;
          if (facts.status === 'fulfilled') tvmazeFacts = facts.value;
          if (credits.status === 'rejected' && facts.status === 'rejected') {
            throw credits.reason;
          }
          outcomes.push(
            outcome(
              MetadataSource.TvMaze,
              tvmaze?.length || tvmazeFacts ? 'ok' : 'empty',
              startedAt
            )
          );
        })()
          .catch((error) => {
            outcomes.push(outcome(MetadataSource.TvMaze, 'failed', startedAt, describe(error)));
          })
          .then(() => void publish(true))
      );
    }

    /**
     * Anime with no AniList id is the other half of the consistency problem.
     *
     * An IMDb id reaches Cinemeta and Wikidata, and neither has characters,
     * voice actors or native names — which is the entire reason this source is
     * in the set. Almost every anime page in this app arrives from a scraper
     * with no id at all, so without this the richest source for anime is
     * consulted only for titles opened from the app's own AniList rows.
     */
    if (!ids.anilist && request.title && ANIME_TYPES.has(request.type ?? TvType.Movie)) {
      try {
        const found = await searchAniListId(request.title, request.year, signal);
        if (found) ids.anilist = found;
      } catch {
        // The outcome below reports the miss; a failed search is not worth a
        // second entry saying the same thing.
      }
    }

    if (ids.anilist) {
      const startedAt = Date.now();
      tasks.push(
        fetchAniListCredits(ids.anilist, signal)
          .then((result) => {
            anilist = result;
            outcomes.push(
              outcome(MetadataSource.AniList, result.people.length ? 'ok' : 'empty', startedAt)
            );
          })
          .catch((error) => {
            outcomes.push(outcome(MetadataSource.AniList, 'failed', startedAt, describe(error)));
          })
          .then(() => void publish(true))
      );
    } else if (ANIME_TYPES.has(request.type ?? TvType.Movie)) {
      outcomes.push({
        source: MetadataSource.AniList,
        status: 'skipped',
        reason: request.title
          ? 'no AniList id, and this title matched no AniList entry'
          : 'no AniList id for this title',
      });
    }

    await Promise.all(tasks);

    // Phase two. The article URL is a sitelink from Wikidata, never a search.
    const articleUrl = (wikidata as WikidataResult | null)?.facts?.wikipediaUrl;
    if (articleUrl) {
      const startedAt = Date.now();
      try {
        wikipedia = await fetchWikipediaNotes(articleUrl, signal);
        outcomes.push(
          outcome(
            MetadataSource.Wikipedia,
            wikipedia && (wikipedia.production.length || wikipedia.trivia.length)
              ? 'ok'
              : 'empty',
            startedAt
          )
        );
      } catch (error) {
        outcomes.push(outcome(MetadataSource.Wikipedia, 'failed', startedAt, describe(error)));
      }
    } else {
      outcomes.push({
        source: MetadataSource.Wikipedia,
        status: 'skipped',
        reason: 'no Wikidata sitelink, and the article is never guessed at',
      });
    }

    const final = publish(false);
    this.write(request.url, final);
    this.listener?.(final);
    return final;
  }

  /**
   * Everything gathered, merged into one record.
   *
   * Source order in each `merge*` call is precedence order, and it is not
   * arbitrary: the source that carries **characters and photographs** goes
   * first so its rows decide the shape of the list, and the name-only sources
   * fold onto them. Put Cinemeta first and a merged cast list is ordered by the
   * one source that has no images, which is the version that looks broken.
   */
  private assemble(
    request: EnrichmentRequest,
    ids: ExternalIds,
    parts: {
      cinemeta: CinemetaExtras | null;
      wikidata: WikidataResult | null;
      anilist: AniListCredits | null;
      tvmaze: Awaited<ReturnType<typeof fetchTvMazeCredits>> | null;
      tvmazeFacts: TvMazeShowFacts | null;
      wikipedia: WikipediaNotes | null;
    },
    outcomes: MetadataSourceOutcome[],
    partial: boolean
  ): ExtendedMetadata {
    const { cinemeta, wikidata, anilist, tvmaze, tvmazeFacts, wikipedia } = parts;

    const people = orderCredits(
      mergeCredits([
        tvmaze ?? [],
        anilist?.people ?? [],
        wikidata?.credits ?? [],
        cinemeta?.people ?? [],
      ])
    );

    const ratings = mergeRatings([
      cinemeta?.ratings ?? [],
      tvmazeFacts?.ratings ?? [],
      anilist?.ratings ?? [],
    ]);

    const facts = wikidata?.facts ?? null;

    return {
      url: request.url,
      ids,
      originalTitle: anilist?.originalTitle ?? facts?.originalTitle,
      alternateTitles: mergeStrings([anilist?.alternateTitles]),
      // The provider's own synopsis stays on the page; this is the floor under
      // a scraped page whose only description was a one-line site blurb.
      plot: anilist?.plot,
      posterUrl: cinemeta?.posterUrl ?? tvmazeFacts?.posterUrl ?? anilist?.posterUrl,
      releaseDate: preferPreciseDate(
        preferPreciseDate(
          preferPreciseDate(cinemeta?.releaseDate, facts?.releaseDate),
          tvmazeFacts?.premiered
        ),
        anilist?.releaseDate
      ),
      endDate: anilist?.endDate ?? tvmazeFacts?.ended,
      /**
       * Order is precedence, and it is cheapest-first by coincidence rather
       * than by design: Cinemeta is a reply the app already pays for, TVmaze's
       * is the measured average episode length, AniList's is per-episode too,
       * and Wikidata's `P2047` is last because it is the only one of the four
       * that is a *statement* about the work rather than a catalogue field —
       * on a series it answers the length of whichever cut somebody recorded.
       */
      runtimeMinutes:
        cinemeta?.runtimeMinutes ?? tvmazeFacts?.runtimeMinutes ?? facts?.runtimeMinutes,
      /**
       * Cinemeta's and TVmaze's vocabulary only. Wikidata's `P136` stays in
       * `keywords` — measured, it answers "action film" and "drama television
       * series", which would put the word "film" on every chip of every film.
       */
      genres: mergeStrings([cinemeta?.genres, tvmazeFacts?.genres, anilist?.genres]),
      status: cinemeta?.status ?? tvmazeFacts?.status ?? anilist?.status,
      seasonCount: cinemeta?.seasonCount ?? tvmazeFacts?.seasonCount,
      episodeCount: cinemeta?.episodeCount ?? tvmazeFacts?.episodeCount ?? anilist?.episodeCount,
      countries: mergeStrings([
        cinemeta?.countries,
        facts?.countries,
        tvmazeFacts?.countries,
        anilist?.countries,
      ]),
      spokenLanguages: mergeStrings([facts?.spokenLanguages, tvmazeFacts?.language ? [tvmazeFacts.language] : undefined]),
      certifications: mergeStrings([facts?.certifications])
        // `P1657` is the MPA rating specifically, so the country is known
        // rather than guessed. A rating with no country attached is unreadable:
        // "15" means one thing in the UK and nothing anywhere else.
        .map((rating) => ({ country: 'US', rating }))
        .slice(0, 4),
      ratings: ratings.length ? ratings : undefined,
      people: people.length ? people : undefined,
      studios: mergeOrganisations([anilist?.studios, facts?.studios]).slice(0, 8),
      // TVmaze first: measured, both it and Wikidata answer "AMC" for Breaking
      // Bad, and TVmaze is the one that also publishes the official site.
      networks: mergeOrganisations([tvmazeFacts?.networks, facts?.networks]).slice(0, 4),
      revenue: facts?.revenue,
      budget: facts?.budget,
      // Wikidata publishes these without a currency on the plain `wdt:` value;
      // USD is what the overwhelming majority of its film box-office figures
      // are recorded in, and stating the assumption beats an unlabelled number.
      currency: facts?.revenue || facts?.budget ? 'USD' : undefined,
      awards: mergeStrings([cinemeta?.awards, facts?.awards]),
      keywords: mergeStrings([anilist?.keywords, facts?.keywords]),
      production: mergeNotes([wikipedia?.production ?? []]),
      trivia: mergeNotes([wikipedia?.trivia ?? [], anilist?.trivia ?? []]),
      videos: mergeVideos([cinemeta?.videos ?? [], anilist?.videos ?? []]),
      backdropUrl: cinemeta?.backdropUrl ?? anilist?.backdropUrl,
      logoUrl: cinemeta?.logoUrl,
      outcomes: [...outcomes],
      fetchedAt: Date.now(),
      partial: partial || undefined,
    };
  }
}
