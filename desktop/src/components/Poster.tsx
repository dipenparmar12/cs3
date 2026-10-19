import React, { useEffect, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { isSensitiveTitle } from '../utils/adultContent';
import {
  hideAdultItem,
  isAdultItemBlurred,
  revealAdultItem,
  useAdultState,
  useRegisterAdultPresence,
} from '../utils/useAdultMode';

/**
 * Artwork that degrades to something, instead of to a broken-image glyph,
 * and enforces visual privacy protection (blurring) for adult/NSFW content (§129.3).
 */
interface PosterProps {
  src?: string | null;
  /** Alt text, and the source of the letter in the default placeholder. */
  title: string;
  className?: string;
  /** Decorative artwork beside its own label takes an empty alt. */
  decorative?: boolean;
  loading?: 'lazy' | 'eager';
  /**
   * What to draw instead of the image.
   *
   * Each call site keeps its own — an episode row shows the episode number, the
   * detail hero shows a shaped placeholder — because they are sized and styled
   * differently and flattening them to one glyph would be a worse screen, not a
   * tidier one. Omitted, it falls back to the title's initial.
   */
  fallback?: React.ReactNode;
  /** True when the item is classified as adult/NSFW. */
  sensitive?: boolean;
  /** Stable identifier for individual-result unblurring during the session. */
  itemKey?: string;
  /** Whether to render the unobtrusive 18+ protection indicator and per-item reveal button. */
  showRevealControl?: boolean;
  allowIndividualReveal?: boolean;
}

export const Poster: React.FC<PosterProps> = ({
  src,
  title,
  className,
  decorative = false,
  loading = 'lazy',
  fallback,
  sensitive = false,
  itemKey,
  showRevealControl = false,
  allowIndividualReveal,
}) => {
  const [failed, setFailed] = useState(false);
  const adult = useAdultState();

  const isAdult = Boolean(sensitive) || isSensitiveTitle(title);
  useRegisterAdultPresence(isAdult);

  const resolvedKey = itemKey || src || title;
  const isBlurred = isAdult && isAdultItemBlurred(adult, resolvedKey);
  const isIndividuallyRevealed =
    isAdult &&
    adult.allowed &&
    adult.blurred &&
    Boolean(resolvedKey && adult.revealedKeys.has(resolvedKey));

  // A recycled card — a grid re-rendering with new data — must not inherit the
  // previous item's failure, or one dead poster poisons that slot for the
  // rest of the session.
  useEffect(() => setFailed(false), [src]);

  const showControls = allowIndividualReveal !== undefined ? allowIndividualReveal : showRevealControl;
  const badge =
    isAdult && showControls ? (
      <div
        className={`cs-poster-privacy${isBlurred ? ' cs-poster-privacy--blurred' : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        {isBlurred && (
          <span className="adult-badge" title="Adult / NSFW content (18+)">
            18+
          </span>
        )}
        {adult.allowed && (isBlurred || isIndividuallyRevealed) && (
          <button
            type="button"
            className="cs-poster-privacy__btn"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (isBlurred) revealAdultItem(resolvedKey);
              else hideAdultItem(resolvedKey);
            }}
            title={
              isBlurred
                ? 'Reveal this artwork for the current session'
                : 'Blur this artwork again'
            }
            aria-label={isBlurred ? `Unblur ${title}` : `Blur ${title}`}
          >
            {isBlurred ? <Eye size={12} /> : <EyeOff size={12} />}
            <span>{isBlurred ? 'Unblur' : 'Blur'}</span>
          </button>
        )}
      </div>
    ) : null;

  if (!src || failed) {
    if (fallback !== undefined) {
      return (
        <>
          {fallback}
          {badge}
        </>
      );
    }
    const initial = title.trim().charAt(0).toUpperCase() || '?';
    return (
      <>
        <div
          className={`poster-image--empty${className ? ` ${className}` : ''}`}
          aria-hidden="true"
        >
          {initial}
        </div>
        {badge}
      </>
    );
  }

  const imgClass = [className, isBlurred ? 'cs-poster--blurred' : '']
    .filter(Boolean)
    .join(' ');

  return (
    <>
      <img
        src={src}
        alt={decorative ? '' : isBlurred ? 'Protected adult content' : title}
        className={imgClass || undefined}
        loading={loading}
        onError={() => setFailed(true)}
      />
      {badge}
    </>
  );
};

