import React, { useCallback, useState } from 'react';
import { AlertTriangle, Check, Download, DownloadCloud, RotateCcw, Zap } from 'lucide-react';

import { CardBadge, badgeLabel } from '../../utils/cardState';
import { useFlash } from '../../utils/useFlash';

/**
 * What the marks on a poster mean, for anyone who wants to know.
 *
 * PRD-46 §11, and its own caveat is the important half: **normal users should
 * not need to read this.** If somebody has to come to Settings to find out what
 * a badge means, the badge has failed — so every one of them already carries
 * the same sentence in its tooltip, and this page is a reference rather than a
 * prerequisite.
 *
 * It earns its place for two reasons that a tooltip cannot cover. A tooltip is
 * only reachable if you already found the badge, so there is no way to see the
 * whole vocabulary at once; and the dimming of a visited card has nothing to
 * hover at all — it is the one state with no target, and without a line here
 * the only way to learn it is to notice it, which people mostly do not.
 *
 * The erase control sits beside it deliberately. The visit ledger is the only
 * thing this feature stores that a viewer might not want stored — it is a list
 * of what they have looked at — so the explanation of it and the way to clear
 * it are one block rather than two screens apart.
 */

const ROWS: Array<{ badge: CardBadge; icon: React.ReactNode; meaning: string }> = [
  {
    badge: CardBadge.Downloading,
    icon: <DownloadCloud size={13} aria-hidden />,
    meaning: 'A copy is being saved right now, or is waiting its turn.',
  },
  {
    badge: CardBadge.Downloaded,
    icon: <Download size={13} aria-hidden />,
    meaning: 'A copy is on this computer and will play without the internet.',
  },
  {
    badge: CardBadge.NoSources,
    icon: <AlertTriangle size={13} aria-hidden />,
    meaning:
      'Nothing playable was found last time. Opening it looks again, so it is worth one more try.',
  },
  {
    badge: CardBadge.Failed,
    icon: <AlertTriangle size={13} aria-hidden />,
    // Named as ours, because it usually is — and because the fix is a release
    // rather than anything the viewer can do.
    meaning: 'The app itself could not play this last time. It often works after an update.',
  },
  {
    badge: CardBadge.Continue,
    icon: <RotateCcw size={13} aria-hidden />,
    meaning: 'Part-watched. The bar across the bottom of the poster shows how far.',
  },
  {
    badge: CardBadge.Ready,
    icon: <Zap size={13} aria-hidden />,
    meaning: 'Sources have already been found, so this should start straight away.',
  },
  {
    badge: CardBadge.Watched,
    icon: <Check size={13} aria-hidden />,
    meaning: 'Watched to the end.',
  },
];

export const CardStatusLegend: React.FC = () => {
  const [clearing, setClearing] = useState(false);
  const { message: status, flash } = useFlash<string>(3000);

  const clearVisits = useCallback(async () => {
    setClearing(true);
    try {
      const response = await window.cloudstream?.clearTitleVisits?.();
      flash(
        response?.ok
          ? `Forgot ${response.cleared} title${response.cleared === 1 ? '' : 's'}.`
          : 'Could not clear that.'
      );
    } finally {
      setClearing(false);
    }
  }, [flash]);

  return (
    <div className="card-legend">
      <p className="card-legend__intro">
        Posters remember what has already happened to them, so you do not have to open the
        same thing twice to find out. Every mark also says what it means if you hover it.
      </p>

      <ul className="card-legend__list">
        {/* The one state with nothing to hover, so it is stated first. */}
        <li className="card-legend__row">
          <span className="card-legend__chip card-legend__chip--visited">Dimmed</span>
          <span>You have opened this one before. The artwork brightens again on hover.</span>
        </li>
        {ROWS.map((row) => (
          <li key={row.badge} className="card-legend__row">
            <span className={`poster-state poster-state--${row.badge} card-legend__chip`}>
              {row.icon}
              <span className="poster-state__label">{badgeLabel(row.badge)}</span>
            </span>
            <span>{row.meaning}</span>
          </li>
        ))}
      </ul>

      <div className="card-legend__actions">
        <button className="btn btn-secondary" onClick={clearVisits} disabled={clearing}>
          {clearing ? 'Clearing…' : 'Forget which titles I have opened'}
        </button>
        {status && <span className="muted">{status}</span>}
      </div>
    </div>
  );
};
