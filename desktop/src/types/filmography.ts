/**
 * "More from this person / studio" — the shapes on both sides of
 * `metadata:filmography`. See `electron/metadata/filmography.ts`.
 */

/** Who to look up. The profile URL carries an id where a source gave one. */
export interface FilmographyRequest {
  kind: 'person' | 'studio';
  name: string;
  /** Wikidata, TVmaze or AniList page for this person, when known. */
  profileUrl?: string;
  /**
   * The title the viewer is on. When no id is known, the person is found as
   * *the* "Name" credited on this title — which is what tells two actors with
   * the same name apart.
   */
  contextImdbId?: string;
}

export type FilmographyRole =
  | 'Acting'
  | 'Voice'
  | 'Directing'
  | 'Writing'
  | 'Producing'
  | 'Music'
  | 'Cinematography'
  | 'Editing'
  | 'Creator'
  | 'Production';

export interface FilmographyWork {
  title: string;
  year?: number;
  type: 'movie' | 'series';
  imdbId?: string;
  posterUrl?: string;
  roles: FilmographyRole[];
  /** Who they played, where the source says. */
  character?: string;
}

export interface Filmography {
  name: string;
  description?: string;
  imageUrl?: string;
  profileUrl?: string;
  source: 'wikidata' | 'tvmaze';
  works: FilmographyWork[];
}
