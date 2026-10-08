import React, { useCallback, useRef, useState } from 'react';
import { ChevronDown, Layers, Play } from 'lucide-react';
import type { SearchResponse } from '../../types/api';
import { releaseNameOf, type VariantInfo } from '../../utils/variantGroups';
import { useDismissable } from '../../utils/useDismissable';

/**
 * "4 variants · 1080p · 720p · Hindi" under a card, and the list behind it.
 *
 * Secondary on purpose: the card is the title, this says more of it exists
 * and offers each one. Opening a variant goes to its page; the play button
 * beside it plays that exact release — the same two intents the card itself
 * has, so nothing new to learn.
 */
export const VariantChip: React.FC<{
  variants: VariantInfo[];
  summary: string;
  identical: boolean;
  onOpen: (item: SearchResponse) => void;
  onPlay?: (item: SearchResponse) => void;
}> = ({ variants, summary, identical, onOpen, onPlay }) => {
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement | null>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismissable(open, wrapper, close);

  const label = identical ? `${variants.length} copies` : `${variants.length} variants`;

  return (
    <div className="variant-chip" ref={wrapper}>
      <button
        type="button"
        className={`variant-chip__trigger${open ? ' is-open' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        title={identical ? 'The same release, listed more than once' : 'Other releases of this title from this source'}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((current) => !current);
        }}
      >
        <Layers size={11} aria-hidden />
        <span className="variant-chip__count">{label}</span>
        {summary && <span className="variant-chip__summary">{summary}</span>}
        <ChevronDown size={11} aria-hidden />
      </button>

      {open && (
        <div className="variant-chip__menu" role="menu" onClick={(event) => event.stopPropagation()}>
          {variants.map((variant, index) => (
            <div key={`${variant.item.url}-${index}`} className="variant-chip__row" role="none">
              <button
                type="button"
                role="menuitem"
                className="variant-chip__open"
                title={releaseNameOf(variant.item)}
                onClick={() => {
                  setOpen(false);
                  onOpen(variant.item);
                }}
              >
                <span className="variant-chip__label">{variant.label}</span>
                <span className="variant-chip__name">{releaseNameOf(variant.item)}</span>
              </button>
              {onPlay && (
                <button
                  type="button"
                  className="variant-chip__play"
                  aria-label={`Play ${variant.label}`}
                  title="Play this one"
                  onClick={() => {
                    setOpen(false);
                    onPlay(variant.item);
                  }}
                >
                  <Play size={12} fill="currentColor" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
