import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Copy,
  MoreHorizontal,
  Pencil,
  Save,
  Star,
  Trash2,
} from 'lucide-react';
import { Button } from '../ui/Button';
import { Input } from '../ui/Field';
import { Menu, type MenuItem } from '../ui/Menu';
import { InfoHint } from '../settings/InfoHint';
import { canSaveSelection, checkProfileName, nameProblem, PROFILE_NAME_MAX, sameSelection, type Selection } from './profileNaming';

export interface BuiltInProfileDef {
  id: string;
  name: string;
  description: string;
  icon?: 'globe' | 'languages' | 'sparkles' | 'clapperboard' | 'shield';
  count: number;
  disabled?: boolean;
  disabledReason?: string;
}

export interface ProfileSummary {
  id: string;
  name: string;
  providers: string[];
  indexers: string[];
  updatedAt?: number;
  createdAt?: number;
}

export interface SourceProfileBarProps {
  profiles: ProfileSummary[];
  builtInProfiles?: BuiltInProfileDef[];
  activeId: string;
  /** The unnamed selection, kept across every switch (`sourceProfiles.ts`). */
  draft: Selection;
  onActivate: (id: string) => void;
  /** Saves the current selection under a new name, and switches to it. */
  onCreate: (name: string) => void;
  /** Writes the current selection into an existing profile, after the viewer confirmed. */
  onReplace: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  /** The profile new searches start from (applied at launch). */
  defaultId?: string;
  /** `all` clears the default. */
  onSetDefault?: (id: string) => void;
}

const count = (n: number) => `${n} ${n === 1 ? 'source' : 'sources'}`;

/**
 * Every search profile as a visible choice: All sources, the viewer's saved
 * profiles, the unsaved selection when there is one, and the presets. They
 * used to sit behind a "Change" dropdown, so a viewer could not see what there
 * was to choose from without opening it.
 *
 * Saving is one visible button beside the choices, offered only when the
 * unsaved selection holds something not yet saved (`canSaveSelection`). The
 * name is asked for in place; a name already in use offers to replace that
 * profile, never silently.
 */
export const SourceProfileBar: React.FC<SourceProfileBarProps> = ({
  profiles,
  builtInProfiles = [],
  activeId,
  draft,
  onActivate,
  onCreate,
  onReplace,
  onRename,
  onDuplicate,
  onDelete,
  defaultId,
  onSetDefault,
}) => {
  /** `new`, a profile id being renamed, or nothing. */
  const [naming, setNaming] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);

  const all = builtInProfiles.find((b) => b.id === 'all') ?? {
    id: 'all',
    name: 'All sources',
    description: 'Search everything you have installed',
    icon: 'globe' as const,
    count: 0,
  };
  const presets = builtInProfiles.filter((b) => b.id !== 'all');
  const reserved = [all.name, ...presets.map((preset) => preset.name), 'Unsaved selection'];

  const sorted = [...profiles].sort((a, b) => {
    const at = a.updatedAt ?? a.createdAt ?? 0;
    const bt = b.updatedAt ?? b.createdAt ?? 0;
    return bt !== at ? bt - at : a.name.localeCompare(b.name);
  });

  const draftSize = draft.providers.length + draft.indexers.length;
  // A selection identical to a saved profile is that profile; a second pill for it would only confuse.
  // A preset is applied to the unsaved selection, so while one is lit the two are the same thing.
  const showDraft =
    draftSize > 0 && !activeId.startsWith('builtin:') && !profiles.some((profile) => sameSelection(profile, draft));
  const canSave = canSaveSelection(activeId, draft, profiles);

  const renaming = naming && naming !== 'new' ? profiles.find((p) => p.id === naming) : undefined;
  const check = checkProfileName(name, profiles, reserved, renaming?.id);
  const problem = nameProblem(check);

  /*
   * Where focus goes when a name field or a confirmation closes. The control
   * that held it is gone, and without this the keyboard lands on the page
   * behind the dialog. `after` waits for the reply that changes the list
   * (a save, a delete), so focus ends on the profile now chosen.
   */
  const section = useRef<HTMLElement | null>(null);
  const refocus = useRef<{ after: boolean; activeId: string; count: number; at: number } | null>(null);
  const returnFocus = (after: boolean) => {
    refocus.current = { after, activeId, count: profiles.length, at: Date.now() };
  };
  useEffect(() => {
    const pending = refocus.current;
    if (!pending || naming !== null || deleting !== null) return;
    const target =
      section.current?.querySelector<HTMLElement>('.profile-choice--active') ??
      section.current?.querySelector<HTMLElement>('.profile-choice');
    target?.focus();
    // A reply that never comes must not move focus minutes later.
    const settled =
      !pending.after ||
      pending.activeId !== activeId ||
      pending.count !== profiles.length ||
      Date.now() - pending.at > 3000;
    if (settled) refocus.current = null;
  }, [naming, deleting, activeId, profiles.length]);

  const stopNaming = (after = false) => {
    returnFocus(after);
    setNaming(null);
    setName('');
  };

  const submit = () => {
    if (!check.ok) return;
    if (naming === 'new') onCreate(check.name);
    else if (naming) onRename(naming, check.name);
    stopNaming(naming === 'new');
  };

  const replace = (id: string) => {
    onReplace(id);
    stopNaming(true);
  };

  const menuFor = (profile: ProfileSummary): MenuItem[] => [
    {
      label: 'Rename',
      icon: Pencil,
      onSelect: () => {
        setDeleting(null);
        setNaming(profile.id);
        setName(profile.name);
      },
    },
    { label: 'Duplicate', icon: Copy, onSelect: () => onDuplicate(profile.id) },
    ...(onSetDefault
      ? [
          {
            label: defaultId === profile.id ? 'Stop using as default' : 'Use for new searches',
            icon: Star,
            onSelect: () => onSetDefault(defaultId === profile.id ? 'all' : profile.id),
          },
        ]
      : []),
    {
      label: 'Delete',
      icon: Trash2,
      tone: 'danger' as const,
      separatorBefore: true,
      onSelect: () => {
        stopNaming();
        setDeleting(profile.id);
      },
    },
  ];

  const pill = (
    id: string,
    label: React.ReactNode,
    detail: string,
    options: { title?: string; disabled?: boolean; tone?: 'draft' } = {}
  ) => {
    const active = activeId === id;
    return (
      <button
        type="button"
        className={`profile-choice${active ? ' profile-choice--active' : ''}${options.tone ? ` profile-choice--${options.tone}` : ''}`}
        aria-pressed={active}
        disabled={options.disabled}
        title={options.title}
        onClick={() => onActivate(id)}
      >
        <span className={`profile-choice__radio${active ? ' profile-choice__radio--on' : ''}`} aria-hidden />
        <span className="profile-choice__name">{label}</span>
        <span className="profile-choice__detail">{detail}</span>
      </button>
    );
  };

  const toDelete = deleting ? profiles.find((p) => p.id === deleting) : undefined;

  return (
    <section className="profile-chooser" aria-labelledby="profile-chooser-title" ref={section}>
      <div className="profile-chooser__head">
        <h3 id="profile-chooser-title" className="profile-chooser__title">
          Start from
        </h3>
        <InfoHint label="About source sets">
          Pick one starting point; the filters below narrow it. A <strong>source set</strong> is a named list of
          sources you saved. While one of yours is picked, changes are saved to it. Changes made from All
          sources or a built-in set stay unsaved until you use <strong>Save as source set</strong>. Switching
          never throws a selection away.
        </InfoHint>
        {canSave && naming !== 'new' ? (
          <Button
            className="profile-chooser__save"
            size="compact"
            icon={Save}
            onClick={() => {
              setDeleting(null);
              setNaming('new');
              setName('');
            }}
          >
            Save as source set
          </Button>
        ) : null}
      </div>

      <div className="profile-chooser__row" role="group" aria-label="Your source sets">
        {pill('all', all.name, all.count > 0 ? `${all.count}` : 'All', {
          title: all.description,
        })}
        {sorted.map((profile) => (
          <span key={profile.id} className="profile-choice__wrap">
            {pill(
              profile.id,
              <>
                {profile.name}
                {defaultId === profile.id ? (
                  <span className="profile-choice__default" title="New searches start from this source set">
                    <Star size={11} aria-hidden /> Default
                  </span>
                ) : null}
              </>,
              `${profile.providers.length + profile.indexers.length}`,
              { title: `${profile.name}: ${count(profile.providers.length + profile.indexers.length)}` }
            )}
            <Menu
              label={`Options for ${profile.name}`}
              items={menuFor(profile)}
              align="end"
              trigger={(props) => (
                <Button
                  {...props}
                  size="compact"
                  variant="ambient"
                  iconOnly
                  icon={MoreHorizontal}
                  aria-label={`Options for ${profile.name}`}
                  className="profile-choice__more"
                />
              )}
            />
          </span>
        ))}
        {showDraft
          ? pill('', 'Unsaved selection', `${draftSize}`, {
              title: `Your current selection, ${count(draftSize)}, not saved as a source set`,
              tone: 'draft',
            })
          : null}
      </div>

      {naming !== null ? (
        <div className="profile-chooser__form">
          <Input
            autoFocus
            size="compact"
            className="profile-chooser__input"
            value={name}
            maxLength={PROFILE_NAME_MAX + 20}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                submit();
              }
              if (event.key === 'Escape') {
                // Cancels the name, not the whole dialog.
                event.preventDefault();
                event.stopPropagation();
                stopNaming();
              }
            }}
            placeholder={naming === 'new' ? 'Source set name' : 'New name'}
            aria-label={naming === 'new' ? 'Name for the new source set' : `New name for ${renaming?.name ?? 'this source set'}`}
            aria-invalid={problem ? true : undefined}
            aria-describedby={problem ? 'profile-name-problem' : undefined}
          />
          <Button size="compact" variant="prominent" onClick={submit} disabled={!check.ok}>
            {naming === 'new' ? 'Save' : 'Rename'}
          </Button>
          <Button size="compact" variant="ambient" onClick={() => stopNaming()}>
            Cancel
          </Button>
          {problem ? (
            <p id="profile-name-problem" className="profile-chooser__problem" role="alert">
              {problem}
              {!check.ok && check.reason === 'taken' && naming === 'new' ? (
                <Button size="compact" variant="ambient" onClick={() => replace(check.id)}>
                  Replace it with this selection
                </Button>
              ) : null}
            </p>
          ) : null}
        </div>
      ) : null}

      {toDelete ? (
        <div className="profile-chooser__form" role="alertdialog" aria-label={`Delete ${toDelete.name}`}>
          <AlertTriangle size={14} aria-hidden className="profile-chooser__warn" />
          <span className="profile-chooser__confirm">
            Delete <strong>{toDelete.name}</strong>? Its sources stay installed.
          </span>
          <Button
            size="compact"
            variant="destructive"
            icon={Trash2}
            onClick={() => {
              onDelete(toDelete.id);
              returnFocus(true);
              setDeleting(null);
            }}
          >
            Delete
          </Button>
          <Button
            size="compact"
            variant="ambient"
            onClick={() => {
              returnFocus(false);
              setDeleting(null);
            }}
          >
            Cancel
          </Button>
        </div>
      ) : null}

      {presets.length > 0 ? (
        <div className="profile-chooser__row" role="group" aria-label="Built-in source sets">
          <span className="profile-chooser__label">Built-in</span>
          {presets.map((preset) =>
            pill(preset.id, preset.name, preset.count > 0 ? `${preset.count}` : '0', {
              title: preset.disabled ? preset.disabledReason : `${preset.description} (${count(preset.count)})`,
              disabled: preset.disabled,
            })
          )}
        </div>
      ) : null}
    </section>
  );
};
