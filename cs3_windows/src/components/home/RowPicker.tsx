import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LayoutList, Loader2 } from 'lucide-react';
import type { DiscoveryRow } from '../../../electron/cs3/discovery';
import { useDismissable } from '../../utils/useDismissable';
import { setRowVisible } from '../../utils/homeRows';

/**
 * Which rows the home screen shows, ticked on the home screen.
 *
 * The page was a fixed stack of every row every catalogue published —
 * twenty-eight on a real install, free-to-air news beside public-domain noir
 * beside trending films — with one switch, for anime. Each row is now its own
 * switch, grouped by where it comes from, and a row switched off is not
 * fetched at all.
 *
 * The list comes from `discover:rows`, which answers without fetching, so a
 * row that is off is still listed — otherwise there would be no way to switch
 * it back on.
 */
export const RowPicker: React.FC<{
  hidden: string[];
  onChange: (next: string[]) => void;
}> = ({ hidden, onChange }) => {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<DiscoveryRow[] | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismissable(open, wrap, close);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void window.cloudstream
      ?.getDiscoveryRows?.()
      .then((response) => {
        if (!cancelled && response?.ok) setRows(response.rows ?? []);
      })
      .catch(() => {
        if (!cancelled) setRows([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const groups = useMemo(() => {
    const byGroup = new Map<string, DiscoveryRow[]>();
    for (const row of rows ?? []) {
      const list = byGroup.get(row.group);
      if (list) list.push(row);
      else byGroup.set(row.group, [row]);
    }
    return [...byGroup.entries()];
  }, [rows]);

  const hiddenSet = useMemo(() => new Set(hidden), [hidden]);
  const shownCount = (rows ?? []).filter((row) => !hiddenSet.has(row.id)).length;

  return (
    <div className="row-picker" ref={wrap}>
      <button
        type="button"
        className={`cat-picker__button${open ? ' cat-picker__button--open' : ''}`}
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="dialog"
        title="Choose which rows this page shows"
      >
        <LayoutList size={13} aria-hidden />
        <span>Rows</span>
      </button>

      {open && (
        <div className="row-picker__menu" role="dialog" aria-label="Rows on the home screen">
          <p className="cat-picker__hint">
            Tick the rows you want on this page.
            {rows ? ` ${shownCount} of ${rows.length} shown.` : ''}
          </p>

          {rows === null ? (
            <p className="cat-picker__loading">
              <Loader2 size={13} className="spin" aria-hidden /> Reading rows…
            </p>
          ) : (
            <div className="row-picker__groups">
              {groups.map(([group, list]) => (
                <fieldset key={group} className="row-picker__group">
                  <legend>{group}</legend>
                  {list.map((row) => {
                    const shown = !hiddenSet.has(row.id);
                    return (
                      <label key={row.id} className="row-picker__row">
                        <input
                          type="checkbox"
                          checked={shown}
                          onChange={(event) => onChange(setRowVisible(hidden, row.id, event.target.checked))}
                        />
                        <span className="row-picker__text">
                          <strong>{row.title}</strong>
                          {row.subtitle && <em>{row.subtitle}</em>}
                        </span>
                      </label>
                    );
                  })}
                </fieldset>
              ))}
            </div>
          )}

          <div className="row-picker__foot">
            <button type="button" className="btn btn-sm btn-secondary" onClick={() => onChange([])}>
              Show every row
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
