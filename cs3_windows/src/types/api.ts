/**
 * Erasable const-object enums. `erasableSyntaxOnly` is enabled in tsconfig.app.json,
 * which forbids TS `enum` declarations. This pattern keeps identical call-site
 * ergonomics (`TvType.Movie` as a value, `TvType` as a type) while emitting nothing
 * that requires type-directed transformation.
 */
export const TvType = {
  Movie: 'Movie',
  TvSeries: 'TvSeries',
  Anime: 'Anime',
  AnimeMovie: 'AnimeMovie',
  OVA: 'OVA',
  Documentary: 'Documentary',
  Live: 'Live',
  NSFW: 'NSFW',
  AsianDrama: 'AsianDrama',
  Torrent: 'Torrent',
} as const;
export type TvType = (typeof TvType)[keyof typeof TvType];

export const DubStatus = {
  Subbed: 'Subbed',
  Dubbed: 'Dubbed',
  Raw: 'Raw',
} as const;
export type DubStatus = (typeof DubStatus)[keyof typeof DubStatus];

export const WatchStatus = {
  Watching: 'Watching',
  Completed: 'Completed',
  OnHold: 'OnHold',
  PlanToWatch: 'PlanToWatch',
  Dropped: 'Dropped',
} as const;
export type WatchStatus = (typeof WatchStatus)[keyof typeof WatchStatus];

export const BUCKET_LABELS: Record<WatchStatus, string> = {
  Watching: 'Watching',
  Completed: 'Completed',
  OnHold: 'On hold',
  PlanToWatch: 'Plan to watch',
  Dropped: 'Dropped',
};

/**
 * One provider's route to a title, kept alongside the merged row that won.
 *
 * Two providers naming the same work produce one row, but the losing row's URL
 * is not noise — it is a second way to reach the same content, and the source
 * layer asks all of them. Discarding it would mean a title found by both the
 * catalogue and an extension could only ever be played through one of them.
 */
export interface SearchAlternate {
  apiName: string;
  url: string;
}

export interface SearchResponse {
  name: string;
  originalTitle?: string;
  url: string;
  apiName: string;
  type?: TvType;
  posterUrl?: string;
  posterHeaders?: Record<string, string>;
  year?: number;
  quality?: string;
  id?: number;
  /** Present when the identity is known; the strongest merge key there is. */
  imdbId?: string;
  /** Present when the item is the exact selection chosen from search suggestions. */
  isExactMatch?: boolean;
  /** The other providers that returned this same title. */
  alternates?: SearchAlternate[];
}

/**
 * One autocomplete row under the search box.
 *
 * Distinct from {@link SearchResponse}: this describes a *title* the user might
 * mean, merged across every catalogue that knows about it, and carries the
 * extra context that makes a guess resolvable at a glance — the official
 * spelling, the year, and a line of plot. `sources` records which catalogues
 * agreed, which is the strongest available signal that a row is the real thing
 * rather than one catalogue's fuzzy near-miss.
 */
export interface SearchSuggestion {
  /** The catalogue's official title, which is what should be searched. */
  title: string;
  year?: number;
  type?: TvType;
  posterUrl?: string;
  plot?: string;
  genres: string[];
  /** Catalogue URL, so a suggestion can open the title directly. */
  url: string;
  imdbId?: string;
  /** Catalogues that independently returned this title. */
  sources: string[];
}

/**
 * The exact work the viewer meant, when they picked it rather than typed it.
 *
 * Choosing "Spider-Man: No Way Home" from the dropdown is a much stronger
 * statement than the text "spider-man": it names one work, out of a franchise
 * of a dozen that all match that text. Carrying the identity through to the
 * search is what lets the results honour the choice instead of re-deriving a
 * guess from the title string.
 */
export interface ExactMedia {
  title: string;
  year?: number;
  type?: TvType;
  imdbId?: string;
  /** The catalogue URL the suggestion came from, so the row always survives. */
  url?: string;
  posterUrl?: string;
}

export interface SearchOptions {
  exact?: ExactMedia;
  /**
   * Ask exactly these providers, for this search only.
   *
   * Set by the OTT platform pages, where the scope belongs to the page rather
   * than to a preference: the user is looking at Netflix, so the search box on
   * that page searches Netflix. Deliberately not persisted — a scope that
   * outlives the page it came from is indistinguishable from a stuck filter.
   *
   * An empty array is a caller saying "these providers, and there are none of
   * them", and is honoured as a search of nothing. Omitting the field is what
   * means "use the stored scope".
   */
  providers?: string[];
}

/** One past search, newest first. */
export interface SearchHistoryEntry {
  query: string;
  /** Epoch millis of the most recent time this query was run. */
  at: number;
  /** How many results it produced, so a fruitless query looks different. */
  resultCount?: number;
}

export interface Episode {
  name: string;
  url: string;
  episode?: number;
  season?: number;
  posterUrl?: string;
  rating?: number;
  description?: string;
  date?: string;
}

export interface LoadResponse {
  name: string;
  url: string;
  apiName: string;
  type: TvType;
  posterUrl?: string;
  year?: number;
  plot?: string;
  rating?: number;
  tags?: string[];
  duration?: string;
  episodes?: Episode[];
  actors?: string[];
  recommendations?: SearchResponse[];
  id?: number;
  /**
   * A live channel rather than a recording.
   *
   * `LiveStreamLoadResponse` on the Android side, and a whole content category
   * that was previously dropped: the bridge's `when` had no branch for it, so
   * every `TvType.Live` provider searched, opened a detail page and offered
   * nothing to play. Live changes more than the source — there is no duration
   * to seek within, no position worth resuming, and a stream that ends is a
   * channel going off air rather than a title finishing.
   */
  isLive?: boolean;
}

/**
 * How the provider classified this link.
 *
 * `ExtractorLinkType` on the Android side, and the value Android hands ExoPlayer
 * to pick a `MediaSource` factory. It is a statement rather than a guess: where
 * the provider leaves it unset the library infers it from the URL before we ever
 * see it, so by the time it reaches here it is the best answer available.
 */
export type ProviderLinkType = 'VIDEO' | 'M3U8' | 'DASH' | 'TORRENT' | 'MAGNET';

/**
 * An audio track delivered as its own file, beside the video.
 *
 * How a provider ships one video and four language tracks without muxing five
 * copies of the film. The headers travel with it because most hosts that do this
 * 403 a request without the `Referer`, so a URL alone is not a fetchable track.
 */
export interface ProviderAudioTrack {
  url: string;
  headers?: Record<string, string>;
}

/**
 * DRM as the provider declared it, rather than as a probe guessed at it.
 *
 * `scheme` is the resolved name of the system UUID; `unknown` means the provider
 * named a system this build has no name for, which is still very different from
 * "not encrypted" — it must keep the stream off the FFmpeg path either way.
 *
 * ClearKey is the case that is actually playable here: `kid` and `key` are a
 * complete licence, so the renderer can answer its own key request without a
 * server. Widevine and PlayReady need a CDM this app does not ship.
 */
export interface ProviderDrm {
  scheme: 'clearkey' | 'widevine' | 'playready' | 'unknown';
  /** The registered DRM system id, hyphenated. */
  uuid?: string;
  /** ClearKey key id, base64url as EME wants it. */
  kid?: string;
  /** ClearKey key, base64url. */
  key?: string;
  /** JWK key type; `oct` for ClearKey. */
  keyType?: string;
  licenseUrl?: string;
  keyRequestParameters?: Record<string, string>;
}

/** One part of a title the provider delivers in several files, in order. */
export interface ProviderPlaylistPart {
  url: string;
  /** Microseconds, as the provider gave it. 0 means it did not say. */
  durationUs?: number;
}

export interface ExtractorLink {
  source: string;
  name: string;
  url: string;
  referer: string;
  quality: number; // e.g. 1080, 720, 480, 360
  isM3u8?: boolean;
  isDash?: boolean;
  /**
   * The provider's own classification, unmodified.
   *
   * Read in preference to sniffing the URL, which is wrong in both directions:
   * providers serve playlists from `.php` addresses carrying no extension, and a
   * progressive MP4 behind a path containing `dash` is not a manifest.
   */
  linkType?: ProviderLinkType;
  /** The MIME type upstream attaches to `linkType`. */
  mimeType?: string;
  /** The extractor's own opaque state. Carried so it can be handed back. */
  extractorData?: string;
  audioTracks?: ProviderAudioTrack[];
  drm?: ProviderDrm;
  /** Set when the title is delivered in parts rather than as one file. */
  playlist?: ProviderPlaylistPart[];
  headers?: Record<string, string>;
  subtitles?: SubtitleFile[];
}

export interface SubtitleFile {
  url: string;
  lang: string;
  isAutoGenerated?: boolean;
}

export interface Score {
  value: number; // 0 to 10 scale
}

/**
 * One row of a provider's own catalogue — its Android "home" screen.
 *
 * Distinct from `discovery.ts`'s home sections, which come from Cinemeta and
 * AniList and are addressed by IMDb id. These rows come from the provider
 * itself and are addressed by `cs3ext://`, so every item on them is already
 * bound to the provider that can play it. That binding is the point: a
 * catalogue row is the one place in the app where "browse" and "this provider
 * can definitely resolve it" are the same list.
 */
export interface ProviderCatalogSection {
  /** The row's title, as the provider names it ("Trending Now", "Comedy"). */
  name: string;
  /**
   * The provider's opaque handle for the row. Must travel back verbatim to
   * request a further page — it is not a URL and must not be parsed.
   */
  data: string;
  /** Landscape artwork, which changes the card shape rather than the content. */
  horizontalImages?: boolean;
}

/** One fetched page of one catalogue row. */
export interface ProviderCatalogPage {
  provider: string;
  /** The section this page belongs to, echoed so a late reply can be placed. */
  section: string;
  page: number;
  items: SearchResponse[];
  /** Whether asking for `page + 1` is worth doing. */
  hasNext: boolean;
}

/** What a provider offers to browse, before anything is fetched. */
export interface ProviderCatalog {
  provider: string;
  hasMainPage: boolean;
  sections: ProviderCatalogSection[];
  /**
   * Why there is nothing to browse, when there is nothing to browse. A
   * provider with only a search endpoint is working correctly, and saying so
   * is different from reporting a failure.
   */
  unavailableReason?: string;
}
