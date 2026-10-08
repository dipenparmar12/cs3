import React, { useEffect, useMemo, useState } from 'react';
import { Building2, ExternalLink, Loader2, User } from 'lucide-react';
import { Dialog } from '../ui';
import { Poster } from '../Poster';
import { PosterCard } from '../PosterCard';
import type { SearchResponse, TvType } from '../../types/api';
import type { Filmography, FilmographyRequest, FilmographyRole, FilmographyWork } from '../../types/filmography';
import { describeError } from '../../utils/errors';

/**
 * "More from …" — a person's or studio's other work, browsable in place.
 *
 * Opened from a cast card, a crew name or a studio on the detail page. Each
 * work is an ordinary catalogue card: opening it navigates like any other
 * title, and Play plays it — nothing here is a second kind of result.
 *
 * The roles filter appears only when there is more than one role to filter
 * by: an actor's page needs no "Acting" chip, a writer-director's does.
 */
export const FilmographyDialog: React.FC<{
  request: FilmographyRequest;
  /** The person's photo and job on the title in view, shown while loading. */
  hint?: { imageUrl?: string; subtitle?: string };
  onClose: () => void;
  onSelectMedia: (item: SearchResponse) => void;
  onPlayDirectly?: (item: SearchResponse) => void;
  onSearch?: (query: string) => void;
}> = ({ request, hint, onClose, onSelectMedia, onPlayDirectly, onSearch }) => {
  const [state, setState] = useState<{ status: 'loading' | 'ready' | 'none' | 'error'; data?: Filmography; error?: string }>({
    status: 'loading',
  });
  const [role, setRole] = useState<FilmographyRole | 'all'>('all');
  const [type, setType] = useState<'all' | 'movie' | 'series'>('all');

  useEffect(() => {
    let active = true;
    setState({ status: 'loading' });
    void window.cloudstream
      ?.getFilmography?.(request)
      .then((response) => {
        if (!active) return;
        if (!response?.ok) setState({ status: 'error', error: response?.error });
        else if (!response.filmography || response.filmography.works.length === 0) {
          setState({ status: 'none', data: response.filmography ?? undefined });
        } else setState({ status: 'ready', data: response.filmography });
      })
      .catch((error) => active && setState({ status: 'error', error: describeError(error) }));
    return () => {
      active = false;
    };
  }, [request]);

  const works = state.data?.works ?? [];
  const roles = useMemo(() => {
    const counts = new Map<FilmographyRole, number>();
    for (const work of works) for (const r of work.roles) counts.set(r, (counts.get(r) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [works]);
  const hasSeries = works.some((work) => work.type === 'series');
  const hasMovies = works.some((work) => work.type === 'movie');
  const shown = works.filter(
    (work) => (role === 'all' || work.roles.includes(role)) && (type === 'all' || work.type === type)
  );

  const asItem = (work: FilmographyWork): SearchResponse => ({
    name: work.title,
    url: work.imdbId
      ? `cs3meta://cinemeta/${work.type === 'series' ? 'series' : 'movie'}/${work.imdbId}`
      : `search://${encodeURIComponent(work.title)}`,
    apiName: 'Cinemeta',
    type: (work.type === 'series' ? 'TvSeries' : 'Movie') as TvType,
    year: work.year,
    posterUrl: work.posterUrl,
    imdbId: work.imdbId,
  });

  const open = (work: FilmographyWork) => {
    onClose();
    if (!work.imdbId && onSearch) {
      onSearch(work.title);
      return;
    }
    onSelectMedia(asItem(work));
  };

  const name = state.data?.name ?? request.name;
  const isStudio = request.kind === 'studio';

  return (
    <Dialog
      size="xl"
      icon={isStudio ? <Building2 size={18} /> : <User size={18} />}
      title={`More from ${name}`}
      onClose={onClose}
      className="filmography"
    >
      <div className="filmography__head">
        {!isStudio && (
          <Poster
            src={state.data?.imageUrl ?? hint?.imageUrl}
            title={name}
            decorative
            className="filmography__photo"
            fallback={<div className="filmography__photo filmography__photo--empty">{name.charAt(0)}</div>}
          />
        )}
        <div className="filmography__about">
          {(state.data?.description || hint?.subtitle) && (
            <p className="filmography__description">{state.data?.description ?? hint?.subtitle}</p>
          )}
          {state.status === 'ready' && (
            <p className="filmography__count">
              {works.length} title{works.length === 1 ? '' : 's'}
            </p>
          )}
          {state.data?.profileUrl && (
            <a className="filmography__profile" href={state.data.profileUrl} target="_blank" rel="noreferrer noopener">
              {state.data.source === 'tvmaze' ? 'TVmaze' : 'Wikidata'} page <ExternalLink size={11} />
            </a>
          )}
        </div>
      </div>

      {state.status === 'ready' && (roles.length > 1 || (hasMovies && hasSeries)) && (
        <div className="filmography__filters" role="toolbar" aria-label="Filter">
          {roles.length > 1 && (
            <div className="type-tabs">
              <button
                type="button"
                className={`type-tabs__tab${role === 'all' ? ' type-tabs__tab--on' : ''}`}
                onClick={() => setRole('all')}
              >
                All <span>{works.length}</span>
              </button>
              {roles.map(([name, count]) => (
                <button
                  key={name}
                  type="button"
                  className={`type-tabs__tab${role === name ? ' type-tabs__tab--on' : ''}`}
                  onClick={() => setRole(name)}
                >
                  {name} <span>{count}</span>
                </button>
              ))}
            </div>
          )}
          {hasMovies && hasSeries && (
            <div className="type-tabs">
              {(['all', 'movie', 'series'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  className={`type-tabs__tab${type === value ? ' type-tabs__tab--on' : ''}`}
                  onClick={() => setType(value)}
                >
                  {value === 'all' ? 'Films & series' : value === 'movie' ? 'Films' : 'Series'}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {state.status === 'loading' && (
        <p className="metadata-status" role="status">
          <Loader2 size={13} className="spin" /> Looking up {isStudio ? 'what they made' : 'their work'}…
        </p>
      )}
      {state.status === 'none' && (
        <p className="filmography__empty">
          No other work could be found for {name} with certainty.
          {onSearch && (
            <>
              {' '}
              <button type="button" className="metadata-facts__link" onClick={() => { onClose(); onSearch(name); }}>
                Search for “{name}”
              </button>
            </>
          )}
        </p>
      )}
      {state.status === 'error' && (
        <p className="filmography__empty">Could not look this up right now. {state.error}</p>
      )}

      {state.status === 'ready' && (
        <div className="collection-dialog__grid collection-dialog__grid--posters">
          {shown.map((work) => (
            <div key={`${work.imdbId ?? work.title}:${work.year ?? ''}`} className="filmography__work">
              <PosterCard
                item={asItem(work)}
                onSelectMedia={() => open(work)}
                onPlayDirectly={
                  onPlayDirectly && work.imdbId
                    ? () => {
                        onClose();
                        onPlayDirectly(asItem(work));
                      }
                    : undefined
                }
                showBucketButton={false}
              />
              <p className="filmography__roles">
                {work.character ? `as ${work.character}` : work.roles.join(' · ')}
              </p>
            </div>
          ))}
        </div>
      )}
    </Dialog>
  );
};
