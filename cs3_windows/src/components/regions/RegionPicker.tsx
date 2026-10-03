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
