import React, { useMemo, useState } from 'react';
import { BookOpen, ExternalLink, Info, Loader2, Users } from 'lucide-react';
import { DetailSection } from './DetailSection';
import { CollectionDialog } from './CollectionDialog';

import { Poster } from '../Poster';
import type { CreditPerson, ExtendedMetadata, ProductionNote } from '../../types/metadata';
import { metadataSectionState, shouldShowStatus } from './metadataSection';
import {
  answeringSources,
  describeCredit,
  failedSources,
  formatCertifications,
  formatMoney,
  formatRating,
  formatReleaseDate,
  formatRuntimeMinutes,
  formatSeasonCount,
  formatStatus,
  formatVotes,
  groupCredits,
  sourceLabel,
} from '../../utils/metadataDisplay';

/**
 * The cast, crew, ratings and production notes, on the detail page.
 *
 * What this replaces is one row of grey chips: `detail.actors` is `string[]`,
 * so the page could say Timothée Chalamet is in Dune and could not say he plays
 * Paul Atreides, show his face, name the director, or state when the film came
 * out beyond the year.
 *
 * ## Three rules this component exists to keep
 *
 * **Nothing *settled* renders empty, but a lookup in progress says so.** The
 * original rule here was that nothing at all is drawn until there is something
 * to draw — no skeleton, no empty headings — because a "Cast" heading over a
 * blank space reads as a lookup that failed, and for a title none of the
 * catalogues has heard of that impression would be permanent and wrong.
 *
 * That reasoning holds for the *settled* case and was wrong for the wait. Five
 * third-party hosts are being asked, Wikidata alone was measured at 11.3s on
 * Breaking Bad, and during all of it the page said nothing whatsoever — so the
 * viewer could not tell a slow lookup from a title with no entry, which is
 * exactly the distinction the outcomes exist to preserve. `pending` draws one
 * quiet line naming what is being fetched; when it clears with nothing found,
 * the original rule applies again and the component renders `null`.
 *
 * **Everything found is shown.** There is no "show all" toggle on the cast or
 * on the production notes. A collapsed list hides the thing the viewer came to
 * read behind a button that has to be discovered, and the rail already scrolls
 * — `Poster` lazy-loads, so a 250-strong anime cast costs its images only as
 * they are scrolled to.
 *
 * **A source that failed is never an error on the page.** It goes in one muted
 * line at the bottom, beside the sources that did answer. The viewer came here
 * to watch something; Wikidata being slow is not their problem and is not worth
 * a red state on their screen. It is worth *recording*, because the second
 * question after "the cast is missing" is always "which source was it".
 *
 * **Attribution is rendered, always.** Wikipedia prose is CC BY-SA and this
 * repository already carries a `LICENSE` and `THIRD-PARTY-NOTICES.md` because
 * getting licensing wrong is expensive for a GPL project redistributing
 * community work. `ProductionNote.attribution` is a required field precisely so
 * this component cannot draw a note without its credit.
 */

interface TitleMetadataProps {
  metadata: ExtendedMetadata | null;
  /** Fallback names from the provider's own `LoadResponse.actors`. */
  fallbackActors?: string[];
  /**
   * Genres the hero is already showing, so this section does not repeat them.
   *
   * Passed in rather than read from the metadata record: the hero draws the
   * *provider's* tags, and only the caller knows which those were.
   */
  providerTags?: string[];
  /**
   * The catalogues are being asked and have not finished.
   *
   * Owned by the caller rather than derived from `metadata`, because the
   * longest part of the wait is *before* the first record exists — the id is
   * resolved from the title first, and until that returns there is no
   * `ExtendedMetadata` at all and nothing here could read a flag off.
   */
  pending?: boolean;
}

/**
 * One line saying a lookup is running, and how far it has got.
 *
 * Deliberately a sentence rather than a skeleton. A shimmering placeholder
 * promises a specific shape of content and this cannot promise any — for a
 * title the catalogues have never heard of the honest outcome is that nothing
 * appears, and a skeleton would have spent the whole wait implying otherwise.
 */
const MetadataStatus: React.FC<{ answered: string[] }> = ({ answered }) => (
  <p className="metadata-status" role="status">
    <Loader2 size={13} className="spin" />
    <span>
      Looking up cast, crew, ratings and production notes…
      {answered.length > 0 && (
        // Named as they land, so a slow source is visibly one source rather
        // than the whole lookup being stuck.
        <span className="metadata-status__done"> {answered.join(', ')} answered.</span>
      )}
    </span>
  </p>
);

const PersonCard: React.FC<{ person: CreditPerson; onSelect?: (person: CreditPerson) => void }> = ({
  person,
  onSelect,
}) => {
  const described = describeCredit(person);

  const card = (
    <>
      <div className="credit-card__portrait">
        <Poster
          src={person.imageUrl}
          title={person.name}
          decorative
          className="credit-card__image"
          fallback={
            <div className="credit-card__image credit-card__image--empty" aria-hidden="true">
              {person.name.trim().charAt(0).toUpperCase() || '?'}
            </div>
          }
        />
      </div>
      <p className="credit-card__name">{described.name}</p>
      {described.secondaryName && (
        // The original-language spelling, which for a large part of this app's
        // catalogue is the name the viewer actually recognises.
        <p className="credit-card__native" lang="und">
          {described.secondaryName}
        </p>
      )}
      {described.character && (
        <p className="credit-card__character">
          {described.character}
          {described.characterSecondary && (
            <span className="credit-card__native"> {described.characterSecondary}</span>
          )}
        </p>
      )}
      {described.note && <p className="credit-card__note">{described.note}</p>}
    </>
  );

  // With a person view available, a card opens their other work in the app —
  // the profile page is one click further, inside that view. Without it, a
  // profile link opens in the system browser as before; a credit with no link
  // is a plain div rather than a dead anchor.
  if (onSelect) {
    return (
      <button
        type="button"
        className="credit-card credit-card--link"
        onClick={() => onSelect(person)}
        title={`More from ${person.name}`}
      >
        {card}
      </button>
    );
  }
  return person.profileUrl ? (
    <a
      className="credit-card credit-card--link"
      href={person.profileUrl}
      target="_blank"
      rel="noreferrer noopener"
      title={`Read about ${person.name}`}
    >
      {card}
    </a>
  ) : (
    <div className="credit-card">{card}</div>
  );
};

const NoteBlock: React.FC<{ note: ProductionNote }> = ({ note }) => (
  <article className="metadata-note">
    <h3 className="metadata-note__heading">{note.heading}</h3>
    <p className="metadata-note__text">{note.text}</p>
    {/*
      Required by the licence, not by taste. `ProductionNote` makes the
      attribution non-optional so this cannot be forgotten in a later edit.
    */}
    <a
      className="metadata-note__attribution"
      href={note.attribution.url}
      target="_blank"
      rel="noreferrer noopener"
    >
      {sourceLabel(String(note.attribution.source))} · {note.attribution.licence}
      <ExternalLink size={11} />
    </a>
  </article>
);

export interface TitleCastProps {
  metadata: ExtendedMetadata | null | undefined;
  fallbackActors?: string[];
  pending?: boolean;
  /** Opens a person's other work. */
  onSelectPerson?: (person: CreditPerson) => void;
}

export const TitleCast: React.FC<TitleCastProps> = ({
  metadata,
  fallbackActors,
  pending = false,
  onSelectPerson,
}) => {
  const { cast } = useMemo(() => groupCredits(metadata?.people), [metadata?.people]);
  const section = metadataSectionState({ metadata, fallbackActors, pending });
  const looking = shouldShowStatus({ metadata, fallbackActors, pending });
  const answered = answeringSources(metadata?.outcomes);

  const [viewAll, setViewAll] = useState(false);

  if (section === 'fallback') {
    return (
      <DetailSection id="cast" title="Cast" icon={<Users size={16} />} count={fallbackActors!.length} className="detail-facts--cast">
        {looking && <MetadataStatus answered={answered} />}
        <ul className="detail-facts__people">
          {fallbackActors!.map((actor) => (
            <li key={actor} className="detail-facts__person">
              {onSelectPerson ? (
                <button
                  type="button"
                  className="detail-facts__person-link"
                  onClick={() => onSelectPerson({ name: actor, role: 'cast', sources: [] } as unknown as CreditPerson)}
                  title={`More from ${actor}`}
                >
                  {actor}
                </button>
              ) : (
                actor
              )}
            </li>
          ))}
        </ul>
      </DetailSection>
    );
  }

  if (section !== 'content' || !metadata || cast.length === 0) {
    return null;
  }

  return (
    <DetailSection
      id="cast"
      title={looking ? 'Cast · still looking' : 'Cast'}
      icon={<Users size={16} />}
      count={cast.length}
      className="detail-facts--cast"
      onViewAll={cast.length > 8 ? () => setViewAll(true) : undefined}
    >
      <div className="credit-rail">
        {cast.map((person, index) => (
          <PersonCard
            key={`${person.name}:${person.character ?? ''}:${index}`}
            person={person}
            onSelect={onSelectPerson}
          />
        ))}
      </div>
      {viewAll && (
        <CollectionDialog title="Cast" count={cast.length} icon={<Users size={18} />} layout="people" onClose={() => setViewAll(false)}>
          {cast.map((person, index) => (
            <PersonCard
              key={`${person.name}:${person.character ?? ''}:${index}`}
              person={person}
              onSelect={
                onSelectPerson
                  ? (chosen) => {
                      setViewAll(false);
                      onSelectPerson(chosen);
                    }
                  : undefined
              }
            />
          ))}
        </CollectionDialog>
      )}
    </DetailSection>
  );
};

export interface TitleAboutProps {
  metadata: ExtendedMetadata | null | undefined;
  providerTags?: string[];
  fallbackActors?: string[];
  pending?: boolean;
  /** Opens a person's other work (crew names become links). */
  onSelectPerson?: (person: CreditPerson) => void;
  /** Opens a studio's other work. */
  onSelectStudio?: (studio: { name: string; url?: string }) => void;
}

export const TitleAbout: React.FC<TitleAboutProps> = ({
  metadata,
  providerTags,
  fallbackActors,
  pending = false,
  onSelectPerson,
  onSelectStudio,
}) => {
  const { crew } = useMemo(() => groupCredits(metadata?.people), [metadata?.people]);

  const crewGroups = useMemo(() => {
    const order = [
      'Creator',
      'Director',
      'Screenplay',
      'Writer',
      'Producer',
      'Executive Producer',
      'Composer',
      'Music',
      'Director of Photography',
    ];
    const byJob = new Map<string, { label: string; people: CreditPerson[] }>();
    for (const person of crew) {
      const job = person.job?.trim();
      if (!job) continue;
      const key = job.toLowerCase();
      const group = byJob.get(key) ?? { label: job, people: [] };
      if (!group.people.some((existing) => existing.name === person.name)) {
        group.people.push(person);
      }
      byJob.set(key, group);
    }
    return [...byJob.values()]
      .map((group) => [group.label, group.people] as const)
      .sort((a, b) => {
        const ai = order.findIndex((job) => job.toLowerCase() === a[0].toLowerCase());
        const bi = order.findIndex((job) => job.toLowerCase() === b[0].toLowerCase());
        return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
      })
      .slice(0, 8);
  }, [crew]);

  const facts = useMemo(() => {
    const rows: Array<{ label: string; value: string }> = [];
    const released = formatReleaseDate(metadata?.releaseDate);
    if (released) rows.push({ label: 'Released', value: released });
    const status = formatStatus(metadata?.status);
    if (status) rows.push({ label: 'Status', value: status });
    const runtime = formatRuntimeMinutes(metadata?.runtimeMinutes);
    if (runtime) rows.push({ label: 'Runtime', value: runtime });
    const episodes = formatSeasonCount(metadata?.seasonCount, metadata?.episodeCount);
    if (episodes) rows.push({ label: 'Episodes', value: episodes });
    const certification = formatCertifications(metadata?.certifications);
    if (certification) rows.push({ label: 'Rated', value: certification });
    if (metadata?.countries?.length) {
      rows.push({ label: 'Country', value: metadata.countries.slice(0, 3).join(', ') });
    }
    if (metadata?.spokenLanguages?.length) {
      rows.push({ label: 'Language', value: metadata.spokenLanguages.slice(0, 3).join(', ') });
    }
    if (metadata?.networks?.length) {
      rows.push({ label: 'Network', value: metadata.networks.slice(0, 3).map((n) => n.name).join(', ') });
    }
    // Studios are drawn as links below when they can be browsed.
    if (metadata?.studios?.length && !onSelectStudio) {
      rows.push({ label: 'Studio', value: metadata.studios.slice(0, 3).map((s) => s.name).join(', ') });
    }
    const budget = formatMoney(metadata?.budget, metadata?.currency);
    if (budget) rows.push({ label: 'Budget', value: budget });
    const revenue = formatMoney(metadata?.revenue, metadata?.currency);
    if (revenue) rows.push({ label: 'Box office', value: revenue });
    return rows;
  }, [metadata]);

  const extraGenres = useMemo(() => {
    const known = new Set((providerTags ?? []).map((tag) => tag.trim().toLowerCase()));
    return (metadata?.genres ?? []).filter((genre) => !known.has(genre.trim().toLowerCase()));
  }, [metadata?.genres, providerTags]);

  const section = metadataSectionState({ metadata, fallbackActors, pending });
  const looking = shouldShowStatus({ metadata, fallbackActors, pending });
  const answered = answeringSources(metadata?.outcomes);

  if (section !== 'content' || !metadata) {
    return looking ? (
      <DetailSection id="about" title="About" icon={<Info size={16} />} className="detail-facts--about">
        <MetadataStatus answered={answered} />
      </DetailSection>
    ) : null;
  }

  if (
    !metadata.ratings?.length &&
    facts.length === 0 &&
    extraGenres.length === 0 &&
    !looking &&
    crewGroups.length === 0 &&
    (!metadata.awards || metadata.awards.length === 0)
  ) {
    return null;
  }

  return (
    <DetailSection id="about" title="About" icon={<Info size={16} />} className="detail-facts--about">
      {looking && <MetadataStatus answered={answered} />}

      {extraGenres.length > 0 && (
        <div className="metadata-genres">
          {extraGenres.slice(0, 8).map((genre) => (
            <span key={genre} className="badge badge--muted">
              {genre}
            </span>
          ))}
        </div>
      )}

      {metadata.ratings && metadata.ratings.length > 0 && (
        <div className="metadata-ratings">
          {metadata.ratings.map((rating) => {
            const formatted = formatRating(rating);
            if (!formatted) return null;
            const votes = formatVotes(rating.votes);
            const body = (
              <>
                <span className="metadata-rating__value">{formatted}</span>
                <span className="metadata-rating__source">
                  {sourceLabel(String(rating.source))}
                  {rating.kind && rating.kind !== 'user' ? ` · ${rating.kind}` : ''}
                </span>
                {votes && <span className="metadata-rating__votes">{votes} votes</span>}
              </>
            );
            const key = `${rating.source}:${rating.kind ?? 'user'}`;
            return rating.url ? (
              <a
                key={key}
                className="metadata-rating metadata-rating--link"
                href={rating.url}
                target="_blank"
                rel="noreferrer noopener"
              >
                {body}
              </a>
            ) : (
              <div key={key} className="metadata-rating">
                {body}
              </div>
            );
          })}
        </div>
      )}

      {facts.length > 0 && (
        <dl className="metadata-facts">
          {facts.map((fact) => (
            <div key={fact.label} className="metadata-facts__row">
              <dt>{fact.label}</dt>
              <dd>{fact.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {(crewGroups.length > 0 || (onSelectStudio && metadata.studios?.length)) && (
        <dl className="metadata-facts metadata-facts--crew">
          {crewGroups.map(([job, people]) => (
            <div key={job} className="metadata-facts__row">
              <dt>{job}</dt>
              <dd>
                {onSelectPerson
                  ? people.map((person, index) => (
                      <React.Fragment key={person.name}>
                        {index > 0 && ', '}
                        <button
                          type="button"
                          className="metadata-facts__link"
                          onClick={() => onSelectPerson(person)}
                          title={`More from ${person.name}`}
                        >
                          {person.name}
                        </button>
                      </React.Fragment>
                    ))
                  : people.map((person) => person.name).join(', ')}
              </dd>
            </div>
          ))}
          {onSelectStudio && metadata.studios && metadata.studios.length > 0 && (
            <div className="metadata-facts__row">
              <dt>Studio</dt>
              <dd>
                {metadata.studios.slice(0, 4).map((studio, index) => (
                  <React.Fragment key={studio.name}>
                    {index > 0 && ', '}
                    <button
                      type="button"
                      className="metadata-facts__link"
                      onClick={() => onSelectStudio(studio)}
                      title={`More from ${studio.name}`}
                    >
                      {studio.name}
                    </button>
                  </React.Fragment>
                ))}
              </dd>
            </div>
          )}
        </dl>
      )}

      {metadata.awards && metadata.awards.length > 0 && (
        <ul className="detail-facts__people metadata-awards">
          {metadata.awards.slice(0, 4).map((award) => (
            <li key={award} className="detail-facts__person">
              {award}
            </li>
          ))}
        </ul>
      )}
    </DetailSection>
  );
};

export interface TitleBehindTheScenesProps {
  metadata: ExtendedMetadata | null | undefined;
}

export const TitleBehindTheScenes: React.FC<TitleBehindTheScenesProps> = ({ metadata }) => {
  const notes = useMemo(
    () => [...(metadata?.production ?? []), ...(metadata?.trivia ?? [])],
    [metadata?.production, metadata?.trivia]
  );

  if (notes.length === 0) return null;

  return (
    <DetailSection id="behind" title="Behind the scenes" icon={<BookOpen size={16} />} count={notes.length} className="detail-facts--notes">
      <div className="metadata-notes">
        {notes.map((note) => (
          <NoteBlock key={`${note.heading}:${note.attribution.url}`} note={note} />
        ))}
      </div>
    </DetailSection>
  );
};

export interface TitleProvenanceProps {
  metadata: ExtendedMetadata | null | undefined;
}

export const TitleProvenance: React.FC<TitleProvenanceProps> = ({ metadata }) => {
  const answered = answeringSources(metadata?.outcomes);
  const failed = failedSources(metadata?.outcomes);

  if (answered.length === 0 && failed.length === 0) return null;

  return (
    <p className="metadata-provenance">
      <Info size={12} />
      {answered.length > 0 && <span>Metadata from {answered.join(', ')}.</span>}
      {failed.length > 0 && (
        <span className="metadata-provenance__failed">
          {' '}
          {failed.join(' and ')} could not be reached.
        </span>
      )}
    </p>
  );
};

export const TitleMetadata: React.FC<TitleMetadataProps> = ({
  metadata,
  fallbackActors,
  providerTags,
  pending = false,
}) => {
  return (
    <>
      <TitleCast metadata={metadata} fallbackActors={fallbackActors} pending={pending} />
      <TitleAbout metadata={metadata} providerTags={providerTags} fallbackActors={fallbackActors} pending={pending} />
      <TitleBehindTheScenes metadata={metadata} />
      <TitleProvenance metadata={metadata} />
    </>
  );
};
