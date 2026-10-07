import React from 'react';
import type { Region, RegionId } from '../../../electron/cs3/regions';
import './regions.css';

/**
 * The region grid shared by first-run and Settings (PRD-54), so the two cannot
 * come to offer different regions.
 *
 * "All regions" is a mode, not an erasure: ticking it keeps the named regions
 * selected underneath, so unticking it gives back exactly what was there.
 */
export const RegionPicker: React.FC<{
  regions: Region[];
  selected: RegionId[];
  onChange: (next: RegionId[]) => void;
  disabled?: boolean;
}> = ({ regions, selected, onChange, disabled }) => {
  const all = selected.includes('ALL');
  const toggle = (id: RegionId) =>
    onChange(selected.includes(id) ? selected.filter((r) => r !== id) : [...selected, id]);

  return (
    <div className="region-picker" role="group" aria-label="Regions">
      {regions.map((region) => {
        const checked = selected.includes(region.id) || (all && region.id !== 'ALL');
        return (
          <label
            key={region.id}
            className={`region-picker__item${checked ? ' is-checked' : ''}${region.id === 'ALL' ? ' region-picker__item--all' : ''}`}
            title={region.languages.length > 0 ? region.languages.join(', ') : 'Every repository in the catalogue'}
          >
            <input
              type="checkbox"
              checked={checked}
              disabled={disabled || (all && region.id !== 'ALL')}
              onChange={() => toggle(region.id)}
            />
            <span>{region.label}</span>
          </label>
        );
      })}
    </div>
  );
};

/** "English, Hindi, Tamil +9" — the languages a selection watches, as a person would say them. */
function languageSummary(regions: Region[], selected: RegionId[]): string {
  const codes = [...new Set(regions.filter((r) => selected.includes(r.id)).flatMap((r) => r.languages))];
  let names: Intl.DisplayNames | null = null;
  try {
    names = new Intl.DisplayNames(['en'], { type: 'language' });
  } catch {
    names = null;
  }
  const named = codes.map((code) => names?.of(code) ?? code);
  return named.length > 3 ? `${named.slice(0, 3).join(', ')} +${named.length - 3}` : named.join(', ');
}

/**
 * Also search other regions' repositories for extensions in the viewer's
 * languages (PRD-54 §5). A regional repository's language describes most of
 * it, not all of it: German Providers can carry an English scraper, and
 * nobody new to the app would know to look there. Shared so first-run and
 * Settings describe it identically.
 */
export const CrossRegionOption: React.FC<{
  regions: Region[];
  selected: RegionId[];
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}> = ({ regions, selected, checked, onChange, disabled }) => {
  // All regions already takes everything; there is nothing left to look through.
  if (selected.includes('ALL') || selected.length === 0) return null;
  const languages = languageSummary(regions, selected);
  return (
    <label className="region-cross">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>
        Also find {languages} providers in other regions' repositories
        <em>For example an English-language provider inside a German repository. Only those are added.</em>
      </span>
    </label>
  );
};
