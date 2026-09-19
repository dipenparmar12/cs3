import React, { useMemo, useState } from 'react';
import { Film, Loader2, Play } from 'lucide-react';

import { Poster } from '../Poster';
import type { TitleVideo } from '../../types/metadata';
import {
  formatVideoDate,
  formatVideoDuration,
  groupVideos,
  videoSectionState,
} from '../../utils/videoGallery';

/**
 * Trailers and promotional videos, on the detail page.
 *
 * ## What this replaces
 *
 * Nothing — and that is the finding worth recording. `ExtendedMetadata.videos`
 * has been assembled by `enrichmentService` since extended metadata was built,
 * carried across the IPC boundary, cached, and **rendered by no component at
 * all**. It is the fourth instance of the failure this repository keeps
 * cataloguing: a channel invoked and never registered, a channel registered and
 * never invoked, a component built and never mounted, and now a *field*
 * populated and never read. `componentReachability.test.mts` catches the third;
 * none of the tests catch this one, because the data flowed correctly the whole
 * way and simply stopped.
 *
 * ## Three rules
 *
 * **Nothing settled renders empty.** Same rule and same four-way shape as
 * `metadataSection.ts`, and the same reason: a "Trailers" heading over a blank
 * space reads as a lookup that failed, and for a title no catalogue has a
 * trailer for that impression would be permanent and wrong. PRD-45 §10 asks for
 * both "hide the section" and "show a no-trailers state"; those cannot both be
 * right, and the third bullet — do not leave empty space — is what both are
 * protecting. So: hidden when settled and empty, one line while looking.
 *
 * **A card says what the video is, not what the film is.** The publisher's
 * title routinely begins with the film's name, which is already at the top of
 * the page; `videoTitles.ts` strips it. What is left — "Official Trailer 3",
 * "First Look" — is the thing being chosen between.
 *
 * **Resolution is visible.** Pressing a trailer spawns yt-dlp and takes one to
 * three seconds. A card that does nothing for three seconds is a broken card,
 * so the pressed one holds a spinner and the rest stay live.
 */

interface TrailerGalleryProps {
  videos: TitleVideo[] | undefined;
  /** The metadata lookup is still running; videos arrive with it. */
  pending?: boolean;
  /** Resolves and plays. Rejects are reported by the caller, not swallowed. */
  onPlay: (video: TitleVideo) => void;
  /** The id currently being resolved, so its card can say so. */
  resolvingId?: string | null;
}

const VideoCard: React.FC<{
  video: TitleVideo;
  busy: boolean;
  onPlay: (video: TitleVideo) => void;
}> = ({ video, busy, onPlay }) => {
  const duration = formatVideoDuration(video.durationSeconds);
  const year = formatVideoDate(video.publishedAt);

  /**
   * The caption's second line, assembled from whatever is known.
   *
   * Every part is conditional and the row is dropped entirely when none exists
   * — the same rule the About table follows. Measured: nothing keyless
   * publishes a duration or a date, so on a freshly opened page this is usually
   * the publisher alone, and after a trailer has been played once it gains the
   * rest from yt-dlp's reply.
   */
  const facts = [video.publisher, duration, year].filter(Boolean).join(' · ');

  return (
    <button
      type="button"
      className={`video-card${busy ? ' video-card--busy' : ''}`}
      onClick={() => onPlay(video)}
      disabled={busy}
      // The full publisher title, which the chip deliberately shortens.
      title={video.title}
      aria-label={`Play ${video.label}`}
    >
      <span className="video-card__frame">
        <Poster
          src={video.thumbnailUrl}
          title={video.label}
          decorative
          className="video-card__image"
          fallback={
            <span className="video-card__placeholder" aria-hidden>
              <Film size={20} />
            </span>
          }
        />
        <span className="video-card__play" aria-hidden>
          {busy ? <Loader2 size={18} className="spin" /> : <Play size={18} fill="currentColor" />}
        </span>
        {duration && <span className="video-card__duration">{duration}</span>}
      </span>

      <span className="video-card__caption">
        <span className="video-card__label">{video.label}</span>
        {facts && <span className="video-card__facts">{facts}</span>}
      </span>
    </button>
  );
};

export const TrailerGallery: React.FC<TrailerGalleryProps> = ({
  videos,
  pending,
  onPlay,
  resolvingId,
}) => {
  const grouped = useMemo(() => groupVideos(videos ?? []), [videos]);
  const state = videoSectionState({ videos, pending });

  /**
   * Related videos are collapsed behind a count, and trailers never are.
   *
   * The opposite of `TitleMetadata`'s "everything found is shown", and for a
   * reason that does not apply there: a cast list is what somebody came to
   * read, while a rail of featurettes below the trailers is a second thing
   * competing with the first. The count is on the button, so nothing is hidden
   * without saying how much.
   */
  const [relatedOpen, setRelatedOpen] = useState(false);

  if (state === 'nothing') return null;

  if (state === 'looking') {
    return (
      <section className="detail-facts">
        <h2 className="detail-facts__heading">Trailers &amp; videos</h2>
        <p className="metadata-status" role="status">
          <Loader2 size={13} className="spin" />
          <span>Looking for trailers…</span>
        </p>
      </section>
    );
  }

  return (
    <section className="detail-facts">
      <h2 className="detail-facts__heading">
        Trailers &amp; videos
        {/* The count, for the reason the cast rail states one: a scroll bar
            cannot say whether it is showing three of three or three of nine. */}
        <span className="detail-facts__count">{grouped.total}</span>
      </h2>

      {grouped.trailerGroups.map((group) => (
        <div className="video-group" key={group.heading ?? 'all'}>
          {group.heading && <h3 className="video-group__heading">{group.heading}</h3>}
          <div className="video-rail">
            {group.videos.map((video) => (
              <VideoCard
                key={video.id}
                video={video}
                busy={resolvingId === video.id}
                onPlay={onPlay}
              />
            ))}
          </div>
        </div>
      ))}

      {grouped.related.length > 0 && (
        <div className="video-group">
          <button
            type="button"
            className="video-group__toggle"
            onClick={() => setRelatedOpen((open) => !open)}
            aria-expanded={relatedOpen}
          >
            {relatedOpen ? 'Hide' : 'Show'} related videos
            <span className="detail-facts__count">{grouped.related.length}</span>
          </button>
          {relatedOpen && (
            <div className="video-rail">
              {grouped.related.map((video) => (
                <VideoCard
                  key={video.id}
                  video={video}
                  busy={resolvingId === video.id}
                  onPlay={onPlay}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
};
