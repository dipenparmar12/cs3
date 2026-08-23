import React, { useEffect, useState } from 'react';
import { Type } from 'lucide-react';
import { SettingGroup, SettingRow } from './SettingRow';
import {
  DEFAULT_SUBTITLE_STYLE,
  SUBTITLE_BACKGROUNDS,
  SUBTITLE_COLORS,
  SUBTITLE_SCALES,
  subtitleCssVariables,
  type SubtitleBackground,
  type SubtitleStyle,
} from '../../utils/subtitleStyle';

/**
 * How subtitles look, with a preview that shows it.
 *
 * The preview is not decoration. Every one of these settings is judged against
 * a moving picture, and the only honest way to choose an outline over a box is
 * to see both over something bright — which is why the sample sits on a light
 * gradient rather than on the panel's own dark surface. Choosing blind and then
 * finding out mid-film is the experience this replaces.
 *
 * Writes are immediate rather than behind an Apply button: there is nothing to
 * validate, every change is reversible, and a player already open picks the new
 * values up the next time it reads preferences.
 */
export const SubtitleSettings: React.FC = () => {
  const [style, setStyle] = useState<SubtitleStyle>(DEFAULT_SUBTITLE_STYLE);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const stored = await window.cloudstream?.getPlayerPreferences();
      if (cancelled || !stored?.ok) {
        setLoaded(true);
        return;
      }
      const p = stored.preferences;
      setStyle({
        scale: p.subtitleScale ?? DEFAULT_SUBTITLE_STYLE.scale,
        color: p.subtitleColor ?? DEFAULT_SUBTITLE_STYLE.color,
        background: p.subtitleBackground ?? DEFAULT_SUBTITLE_STYLE.background,
        weight: p.subtitleWeight ?? DEFAULT_SUBTITLE_STYLE.weight,
        position: p.subtitlePosition ?? DEFAULT_SUBTITLE_STYLE.position,
      });
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /** Applied locally first so the preview never lags the click. */
  const update = (patch: Partial<SubtitleStyle>) => {
    const next = { ...style, ...patch };
    setStyle(next);
    void window.cloudstream?.setPlayerPreferences({
      subtitleScale: next.scale,
      subtitleColor: next.color,
      subtitleBackground: next.background,
      subtitleWeight: next.weight,
      subtitlePosition: next.position,
    });
  };

  const vars = subtitleCssVariables(style);

  return (
    <SettingGroup title="Subtitle appearance" icon={<Type size={15} />}>
      <SettingRow
        label="Preview"
        hint="Shown over a bright picture on purpose. Subtitles are hardest to read over snow, a white wall or light credits, so that is the case worth judging a setting against."
        stacked
      >
        <div className="sub-preview" style={vars as React.CSSProperties}>
          <span className="sub-preview__cue">
            They're not going to make it. We should go back.
          </span>
        </div>
      </SettingRow>

      <SettingRow label="Size" note={`${Math.round(style.scale * 100)}%`}>
        <div className="sub-choices">
          {SUBTITLE_SCALES.map((scale) => (
            <button
              key={scale}
              type="button"
              className={`btn btn-secondary sub-choice${style.scale === scale ? ' sub-choice--on' : ''}`}
              disabled={!loaded}
              onClick={() => update({ scale })}
            >
              {Math.round(scale * 100)}%
            </button>
          ))}
        </div>
      </SettingRow>

      <SettingRow label="Colour">
        <div className="sub-choices">
          {SUBTITLE_COLORS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`sub-swatch${style.color === option.value ? ' sub-swatch--on' : ''}`}
              style={{ background: option.value }}
              disabled={!loaded}
              title={option.label}
              aria-label={option.label}
              aria-pressed={style.color === option.value}
              onClick={() => update({ color: option.value })}
            />
          ))}
        </div>
      </SettingRow>

      <SettingRow
        label="Background"
        note={SUBTITLE_BACKGROUNDS.find((b) => b.value === style.background)?.hint}
        stacked
      >
        <div className="sub-choices">
          {SUBTITLE_BACKGROUNDS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`btn btn-secondary sub-choice${style.background === option.value ? ' sub-choice--on' : ''}`}
              disabled={!loaded}
              title={option.hint}
              onClick={() => update({ background: option.value as SubtitleBackground })}
            >
              {option.label}
            </button>
          ))}
        </div>
      </SettingRow>

      <SettingRow label="Bold" hint="Heavier strokes survive compression artefacts better on low-bitrate releases.">
        <label className="toggle">
          <input
            type="checkbox"
            checked={style.weight === 'bold'}
            disabled={!loaded}
            onChange={(event) => update({ weight: event.target.checked ? 'bold' : 'normal' })}
          />
          <span>{style.weight === 'bold' ? 'On' : 'Off'}</span>
        </label>
      </SettingRow>

      <SettingRow
        label="Raise from bottom"
        note={style.position === 0 ? 'Default position' : `${style.position}% up`}
        hint="Lifts subtitles clear of text burned into the picture. Common on the releases where an external subtitle is most wanted."
      >
        <input
          type="range"
          min={0}
          max={40}
          step={5}
          value={style.position}
          disabled={!loaded}
          onChange={(event) => update({ position: Number(event.target.value) })}
        />
      </SettingRow>

      <SettingRow label="Reset" note="Back to the defaults">
        <button
          type="button"
          className="btn btn-secondary"
          disabled={!loaded}
          onClick={() => update(DEFAULT_SUBTITLE_STYLE)}
        >
          Reset appearance
        </button>
      </SettingRow>
    </SettingGroup>
  );
};
