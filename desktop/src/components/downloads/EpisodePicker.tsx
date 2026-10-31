import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { Episode } from '../../types/api';
import { Button, Checkbox, SearchInput, Select } from '../ui';
import { episodeKey, filterEpisodes, groupBySeason, seasonState, toggleSeason } from './episodeSelection';

/**
 * Pick episodes for a batch download, across every season.
 *
 * Built for long series: seasons fold (the active one starts open), each with
 * a select-all; a filter takes a number, `s2`, `s2e3` or words of the name;
 * Expand all and Collapse all; and a quality per episode over the run's
 * default. Rows are plain and short so a 1,000-episode list stays usable.
 */
const QUALITY_OPTIONS = [
  { value: '', label: 'Default' },
  { value: '2160', label: '4K' },
  { value: '1080', label: '1080p' },
  { value: '720', label: '720p' },
  { value: '480', label: '480p' },
  { value: '0', label: 'Best' },
];

export const EpisodePicker: React.FC<{
  episodes: Episode[];
  activeSeason: number;
  selected: ReadonlySet<string>;
  onSelectedChange: (next: Set<string>) => void;
  quality: ReadonlyMap<string, number>;
  onQualityChange: (next: Map<string, number>) => void;
  disabled?: boolean;
}> = ({ episodes, activeSeason, selected, onSelectedChange, quality, onQualityChange, disabled }) => {
  const [query, setQuery] = useState('');
  const groups = useMemo(() => groupBySeason(episodes), [episodes]);
  const shown = useMemo(() => filterEpisodes(groups, query), [groups, query]);
  const [open, setOpen] = useState<Set<number>>(() => new Set([activeSeason]));
  // A filter opens what it found; clearing it restores the folds.
  const isOpen = (season: number) => Boolean(query.trim()) || open.has(season);

  const setAll = (on: boolean) => {
    const next = new Set(selected);
    for (const group of shown) {
      for (const episode of group.episodes) {
        if (on) next.add(episodeKey(episode));
        else next.delete(episodeKey(episode));
      }
    }
    onSelectedChange(next);
  };

  return (
    <div className="episode-picker">
      <div className="episode-picker__toolbar">
        <SearchInput
          variant="compact"
          value={query}
          onChange={setQuery}
          label="Find an episode"
          placeholder="Find an episode: 3, s2, s2e3 or a name"
          meta={query ? `${shown.reduce((n, g) => n + g.episodes.length, 0)} shown` : undefined}
        />
        <Button size="compact" variant="ambient" disabled={disabled} onClick={() => setAll(true)}>
          Select all{query ? ' shown' : ''}
        </Button>
        <Button size="compact" variant="ambient" disabled={disabled} onClick={() => setAll(false)}>
          None
        </Button>
        <Button size="compact" variant="ambient" onClick={() => setOpen(new Set(groups.map((g) => g.season)))}>
          Expand all
        </Button>
        <Button size="compact" variant="ambient" onClick={() => setOpen(new Set())}>
          Collapse all
        </Button>
      </div>

      <div className="episode-picker__list">
        {shown.length === 0 && <p className="settings-note">No episode matches “{query}”.</p>}
        {shown.map((group) => {
          const state = seasonState(group, selected);
          const picked = group.episodes.filter((e) => selected.has(episodeKey(e))).length;
          const expanded = isOpen(group.season);
          return (
            <section key={group.season} className="episode-picker__season">
              <header className="episode-picker__season-head">
                <button
                  type="button"
                  className="episode-picker__fold"
                  aria-expanded={expanded}
                  onClick={() => {
                    const next = new Set(open);
                    if (next.has(group.season)) next.delete(group.season);
                    else next.add(group.season);
                    setOpen(next);
                  }}
                >
                  {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  Season {group.season}
                  <span className="episode-picker__count">
                    {picked} of {group.episodes.length}
                  </span>
                </button>
                <Checkbox
                  label={`All of season ${group.season}`}
                  checked={state === 'all'}
                  indeterminate={state === 'some'}
                  disabled={disabled}
                  onChange={() => onSelectedChange(toggleSeason(group, selected))}
                />
              </header>
              {expanded && (
                <ul className="episode-picker__episodes">
                  {group.episodes.map((episode) => {
                    const key = episodeKey(episode);
                    const own = quality.get(key);
                    return (
                      <li key={key} className="episode-picker__row">
                        <Checkbox
                          label={
                            <>
                              <span className="episode-picker__num">E{episode.episode ?? '?'}</span>
                              {episode.name && <span className="episode-picker__name">{episode.name}</span>}
                            </>
                          }
                          checked={selected.has(key)}
                          disabled={disabled}
                          onChange={(on) => {
                            const next = new Set(selected);
                            if (on) next.add(key);
                            else next.delete(key);
                            onSelectedChange(next);
                          }}
                        />
                        <Select
                          size="compact"
                          aria-label={`Quality for episode ${episode.episode ?? ''}`}
                          value={own === undefined ? '' : String(own)}
                          disabled={disabled || !selected.has(key)}
                          onChange={(e) => {
                            const next = new Map(quality);
                            if (e.target.value === '') next.delete(key);
                            else next.set(key, Number(e.target.value));
                            onQualityChange(next);
                          }}
                          options={QUALITY_OPTIONS}
                        />
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
};
