import React, { useMemo } from 'react';
import { ExternalLink, Info, Loader2 } from 'lucide-react';

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

export const TitleMetadata: React.FC<TitleMetadataProps> = ({
  metadata,
  fallbackActors,
  providerTags,
  pending = false,
}) => {
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
    const order = [
      // "Creator" first for a series, where it is the credit the show is known
      // by; films have none, so it costs nothing there. Without it the job
      // sorts unranked behind twelve varieties of producer and is cut by the
      // slice below — measured on Breaking Bad's TVmaze crew.
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
    /**
     * Grouped case-insensitively, because the sources disagree about capitals.
     *
     * Measured on Breaking Bad: Wikidata's query binds `Director of
     * Photography` and TVmaze's `type` is `Director Of Photography`. Keyed on
     * the raw string those are two jobs, and the crew line drew the same credit
     * twice under two spellings of one label. The first spelling seen is the
     * one shown, and a person is listed once per job however many sources
     * named them in it.
     */
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

  /**
   * The About table, in the order a viewer reads it.
   *
   * Every row is conditional, and that is the whole rule this block follows:
   * a label with nothing beside it is worse than an absent label, because it
   * states that something should be there. Ordered by how often the answer is
   * the one someone came for — when it came out, how long it is, how much of it
   * there is — rather than by which catalogue supplies it.
   */
  const facts = useMemo(() => {
    const rows: Array<{ label: string; value: string }> = [];
    const released = formatReleaseDate(metadata?.releaseDate);
    // "Released" rather than "Year": the point of carrying a full date is that
    // it answers when the film actually came out, which a year does not.
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
    // Network and studio are separate rows rather than one "Studio" row: for a
    // series they answer different questions — who made it and who showed it —
    // and merging them attributes an AMC broadcast to Sony Pictures Television.
    if (metadata?.networks?.length) {
      rows.push({ label: 'Network', value: metadata.networks.slice(0, 3).map((n) => n.name).join(', ') });
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
   * Genres the provider did not supply.
   *
   * The hero already draws `detail.tags`, so repeating a genre the provider
   * gave would put the same chip on the page twice. These are the ones only the
   * catalogues knew — which for a scraped page is usually all of them, and for
   * a Cinemeta page is usually none.
   */
  const extraGenres = useMemo(() => {
    const known = new Set((providerTags ?? []).map((tag) => tag.trim().toLowerCase()));
    return (metadata?.genres ?? []).filter((genre) => !known.has(genre.trim().toLowerCase()));
  }, [metadata?.genres, providerTags]);

  /**
   * The provider's own flat name list, when nothing richer arrived.
   *
   * This is what the page showed before this component existed, and keeping it
   * as the floor is the difference between enrichment *adding* something and
   * enrichment *replacing* something with a blank space on every title the
   * catalogues do not cover.
   */
  // The four-way decision lives beside this file rather than in it, so it can
  // be tested — Node's type stripping cannot load JSX. See `metadataSection.ts`
  // for what each outcome costs when it is the wrong one.
  const section = metadataSectionState({ metadata, fallbackActors, pending });
  const looking = shouldShowStatus({ metadata, fallbackActors, pending });
  const answered = answeringSources(metadata?.outcomes);

  if (section === 'fallback') {
    return (
      <section className="detail-facts">
        <h2 className="detail-facts__heading">Cast</h2>
        {/* The provider's flat names are on screen, and the catalogues may
            still add faces and characters to them. Saying so is what stops the
            richer list appearing a few seconds later as if from nowhere. */}
        {looking && <MetadataStatus answered={answered} />}
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

  if (section !== 'content' || !metadata) {
    // Still being asked: one line, so the wait is visible work rather than an
    // absence. Settled with nothing: the original rule, and nothing is drawn.
    return looking ? (
      <section className="detail-facts">
        <h2 className="detail-facts__heading">About</h2>
        <MetadataStatus answered={answered} />
      </section>
    ) : null;
  }

  const failed = failedSources(metadata.outcomes);

  return (
    <>
      {(metadata.ratings?.length || facts.length > 0 || extraGenres.length > 0 || looking) && (
        <section className="detail-facts">
          <h2 className="detail-facts__heading">About</h2>

          {/* Above the facts rather than below them: rows arrive as sources
              land, so this explains a table that is about to grow. */}
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
            {/* The count is stated because the rail scrolls: without it there
                is no way to tell a list of twelve from the first twelve of a
                hundred, which is the one thing a scroll bar cannot say. */}
            <span className="detail-facts__count">{cast.length}</span>
            {looking && (
              // Said only while a source is genuinely still expected. A spinner
              // that outlives the request is worse than no spinner, so this
              // reads off `partial` rather than off a timer.
              <span className="detail-facts__pending"> · still looking</span>
            )}
          </h2>
          <div className="credit-rail">
            {cast.map((person, index) => (
              <PersonCard
                // Name alone is not unique: one performer can hold two credits
                // on one title, and React would collapse them into one card.
                key={`${person.name}:${person.character ?? ''}:${index}`}
                person={person}
              />
            ))}
          </div>
        </section>
      )}

      {notes.length > 0 && (
        <section className="detail-facts">
          <h2 className="detail-facts__heading">Behind the scenes</h2>
          <div className="metadata-notes">
            {notes.map((note) => (
              <NoteBlock key={`${note.heading}:${note.attribution.url}`} note={note} />
            ))}
          </div>
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
