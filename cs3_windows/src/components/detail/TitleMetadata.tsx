import React, { useMemo, useState } from 'react';
import { ExternalLink, Info } from 'lucide-react';

import { Poster } from '../Poster';
import type { CreditPerson, ExtendedMetadata, ProductionNote } from '../../types/metadata';
import {
  answeringSources,
  describeCredit,
  failedSources,
  formatMoney,
  formatRating,
  formatReleaseDate,
  formatRuntimeMinutes,
  formatVotes,
  groupCredits,
  hasAnything,
  sourceLabel,
  stillLoading,
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
 * **Nothing renders until there is something to render.** Not a skeleton, not a
 * set of empty headings. A "Cast" heading over a blank space reads as a lookup
 * that failed, and for a title none of the four catalogues has ever heard of —
 * which is a large part of this app's corpus, since the providers scrape sites
 * rather than databases — that impression would be permanent and wrong. The
 * page simply looks as it does today.
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
}

/** Cast shown before "Show all". Two rows on a typical window. */
const CAST_PREVIEW = 12;

const PersonCard: React.FC<{ person: CreditPerson }> = ({ person }) => {
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

  // A profile link is an external page, so it opens in the system browser via
  // the app's existing `setWindowOpenHandler`; a credit with no link must not
  // render as a dead anchor, so it is a plain div instead.
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

export const TitleMetadata: React.FC<TitleMetadataProps> = ({ metadata, fallbackActors }) => {
  const [castExpanded, setCastExpanded] = useState(false);
  const [notesExpanded, setNotesExpanded] = useState(false);

  const { cast, crew } = useMemo(() => groupCredits(metadata?.people), [metadata?.people]);

  /**
   * Crew shown as one line, in the order a viewer looks for them.
   *
   * Grouped by job rather than by `Department`, because a reader scans for
   * "Director" and "Writer" as words — the department vocabulary is for
   * machines, and rendering "Directing: Denis Villeneuve" reads as a database
   * leaking through.
   */
  const crewGroups = useMemo(() => {
    const order = ['Director', 'Screenplay', 'Writer', 'Producer', 'Composer', 'Director of Photography'];
    const byJob = new Map<string, CreditPerson[]>();
    for (const person of crew) {
      const job = person.job?.trim();
      if (!job) continue;
      byJob.set(job, [...(byJob.get(job) ?? []), person]);
    }
    return [...byJob.entries()]
      .sort((a, b) => {
        const ai = order.indexOf(a[0]);
        const bi = order.indexOf(b[0]);
        // Unranked jobs keep their own order behind the ranked ones, rather
        // than sorting to the front on `indexOf`'s -1.
        return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
      })
      .slice(0, 8);
  }, [crew]);

  const notes = useMemo(
    () => [...(metadata?.production ?? []), ...(metadata?.trivia ?? [])],
    [metadata?.production, metadata?.trivia]
  );

  const facts = useMemo(() => {
    const rows: Array<{ label: string; value: string }> = [];
    const released = formatReleaseDate(metadata?.releaseDate);
    // "Released" rather than "Year": the point of carrying a full date is that
    // it answers when the film actually came out, which a year does not.
    if (released) rows.push({ label: 'Released', value: released });
    const runtime = formatRuntimeMinutes(metadata?.runtimeMinutes);
    if (runtime) rows.push({ label: 'Runtime', value: runtime });
    if (metadata?.countries?.length) {
      rows.push({ label: 'Country', value: metadata.countries.slice(0, 3).join(', ') });
    }
    if (metadata?.spokenLanguages?.length) {
      rows.push({ label: 'Language', value: metadata.spokenLanguages.slice(0, 3).join(', ') });
    }
    if (metadata?.studios?.length) {
      rows.push({ label: 'Studio', value: metadata.studios.slice(0, 3).map((s) => s.name).join(', ') });
    }
    const budget = formatMoney(metadata?.budget, metadata?.currency);
    if (budget) rows.push({ label: 'Budget', value: budget });
    const revenue = formatMoney(metadata?.revenue, metadata?.currency);
    if (revenue) rows.push({ label: 'Box office', value: revenue });
    return rows;
  }, [metadata]);

  /**
   * The provider's own flat name list, when nothing richer arrived.
   *
   * This is what the page showed before this component existed, and keeping it
   * as the floor is the difference between enrichment *adding* something and
   * enrichment *replacing* something with a blank space on every title the
   * catalogues do not cover.
   */
  const showFallbackOnly = !hasAnything(metadata) && (fallbackActors?.length ?? 0) > 0;

  if (showFallbackOnly) {
    return (
      <section className="detail-facts">
        <h2 className="detail-facts__heading">Cast</h2>
        <ul className="detail-facts__people">
          {fallbackActors!.map((actor) => (
            <li key={actor} className="detail-facts__person">
              {actor}
            </li>
          ))}
        </ul>
      </section>
    );
  }

  // Nothing to say, and deliberately nothing drawn. See the header.
  if (!hasAnything(metadata) || !metadata) return null;

  const visibleCast = castExpanded ? cast : cast.slice(0, CAST_PREVIEW);
  const visibleNotes = notesExpanded ? notes : notes.slice(0, 2);
  const answered = answeringSources(metadata.outcomes);
  const failed = failedSources(metadata.outcomes);

  return (
    <>
      {(metadata.ratings?.length || facts.length > 0) && (
        <section className="detail-facts">
          <h2 className="detail-facts__heading">About</h2>

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

          {crewGroups.length > 0 && (
            <dl className="metadata-facts metadata-facts--crew">
              {crewGroups.map(([job, people]) => (
                <div key={job} className="metadata-facts__row">
                  <dt>{job}</dt>
                  <dd>{people.map((person) => person.name).join(', ')}</dd>
                </div>
              ))}
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
        </section>
      )}

      {cast.length > 0 && (
        <section className="detail-facts">
          <h2 className="detail-facts__heading">
            Cast
            {stillLoading(metadata) && (
              // Said only while a source is genuinely still expected. A spinner
              // that outlives the request is worse than no spinner, so this
              // reads off `partial` rather than off a timer.
              <span className="detail-facts__pending"> · still looking</span>
            )}
          </h2>
          <div className="credit-rail">
            {visibleCast.map((person, index) => (
              <PersonCard
                // Name alone is not unique: one performer can hold two credits
                // on one title, and React would collapse them into one card.
                key={`${person.name}:${person.character ?? ''}:${index}`}
                person={person}
              />
            ))}
          </div>
          {cast.length > CAST_PREVIEW && (
            <button
              type="button"
              className="btn btn-sm metadata-more"
              onClick={() => setCastExpanded((open) => !open)}
            >
              {castExpanded ? 'Show fewer' : `Show all ${cast.length}`}
            </button>
          )}
        </section>
      )}

      {notes.length > 0 && (
        <section className="detail-facts">
          <h2 className="detail-facts__heading">Behind the scenes</h2>
          <div className="metadata-notes">
            {visibleNotes.map((note) => (
              <NoteBlock key={`${note.heading}:${note.attribution.url}`} note={note} />
            ))}
          </div>
          {notes.length > 2 && (
            <button
              type="button"
              className="btn btn-sm metadata-more"
              onClick={() => setNotesExpanded((open) => !open)}
            >
              {notesExpanded ? 'Show fewer' : `Show all ${notes.length} sections`}
            </button>
          )}
        </section>
      )}

      {(answered.length > 0 || failed.length > 0) && (
        <p className="metadata-provenance">
          <Info size={12} />
          {answered.length > 0 && <span>Metadata from {answered.join(', ')}.</span>}
          {/*
            Stated, never raised. A source being unreachable is not the viewer's
            problem — but it is the first thing anyone needs to know when the
            cast list is thinner than expected, and without this line the only
            available conclusion is that the app is broken.
          */}
          {failed.length > 0 && (
            <span className="metadata-provenance__failed">
              {' '}
              {failed.join(' and ')} could not be reached.
            </span>
          )}
        </p>
      )}
    </>
  );
};
