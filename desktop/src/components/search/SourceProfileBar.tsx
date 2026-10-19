import React, { useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Clapperboard,
  Copy,
  Globe,
  Languages,
  Pencil,
  Plus,
  ShieldAlert,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { useDismissable } from '../../utils/useDismissable';

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
}

export interface SourceProfileBarProps {
  profiles: ProfileSummary[];
  builtInProfiles?: BuiltInProfileDef[];
  activeId: string;
  /** True when the unnamed selection holds something worth keeping. */
  hasDraft: boolean;
  draftCount: number;
  onActivate: (id: string) => void;
  onCreate: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
}

function renderBuiltInIcon(icon?: BuiltInProfileDef['icon']) {
  switch (icon) {
    case 'globe':
      return <Globe size={13} />;
    case 'languages':
      return <Languages size={13} />;
    case 'sparkles':
      return <Sparkles size={13} />;
    case 'clapperboard':
      return <Clapperboard size={13} />;
    case 'shield':
      return <ShieldAlert size={13} />;
    default:
      return <Globe size={13} />;
  }
}

/**
 * Source profiles bar for search scope dialog.
 * Supports built-in source profiles (All, English, Hindi, Anime, Drama, NSFW),
 * custom user-defined profiles, unsaved draft indicators, inline creation, and
 * deletion confirmation.
 */
export const SourceProfileBar: React.FC<SourceProfileBarProps> = ({
  profiles,
  builtInProfiles = [],
  activeId,
  hasDraft,
  draftCount,
  onActivate,
  onCreate,
  onRename,
  onDuplicate,
  onDelete,
}) => {
  const [naming, setNaming] = useState<'new' | string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const menuWrapper = useRef<HTMLDivElement | null>(null);

  useDismissable(menuFor !== null, menuWrapper, () => setMenuFor(null));

  const submitName = () => {
    const name = draftName.trim();
    if (name) {
      if (naming === 'new') onCreate(name);
      else if (naming) onRename(naming, name);
    }
    setNaming(null);
    setDraftName('');
  };

  /** In-place naming field replaces the bar so no stacked modals occur. */
  if (naming !== null) {
    return (
      <div className="profile-bar profile-bar--naming">
        <input
          autoFocus
          value={draftName}
          onChange={(event) => setDraftName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') submitName();
            if (event.key === 'Escape') {
              event.stopPropagation();
              setNaming(null);
              setDraftName('');
            }
          }}
          placeholder={naming === 'new' ? 'Name this set of sources…' : 'New name…'}
          aria-label={naming === 'new' ? 'Name for the new profile' : 'New name for this profile'}
        />
        <button
          className="btn btn-primary btn-sm"
          onClick={submitName}
          disabled={!draftName.trim()}
        >
          <Check size={13} /> Save
        </button>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => {
            setNaming(null);
            setDraftName('');
          }}
        >
          Cancel
        </button>
      </div>
    );
  }

  /** In-place delete confirmation for consequential custom profile removal. */
  if (deleteConfirm !== null) {
    const profileToDelete = profiles.find((p) => p.id === deleteConfirm);
    return (
      <div className="profile-bar profile-bar--delete-confirm" role="alertdialog">
        <AlertTriangle size={14} className="profile-bar__warning-icon" />
        <span className="profile-bar__confirm-text">
          Delete profile <strong>“{profileToDelete?.name ?? 'selected'}”</strong>?
        </span>
        <button
          className="btn btn-danger btn-sm"
          onClick={() => {
            onDelete(deleteConfirm);
            setDeleteConfirm(null);
          }}
        >
          <Trash2 size={13} /> Delete profile
        </button>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => setDeleteConfirm(null)}
        >
          Cancel
        </button>
      </div>
    );
  }

  const defaultBuiltIns: BuiltInProfileDef[] =
    builtInProfiles.length > 0
      ? builtInProfiles
      : [
          {
            id: 'all',
            name: 'All sources',
            description: 'Search everything you have installed',
            icon: 'globe',
            count: 0,
          },
        ];

  return (
    <div className="profile-bar" ref={menuWrapper}>
      <div className="profile-bar__pills" role="group" aria-label="Source profiles">
        {/* Built-in predefined profiles */}
        <div className="profile-bar__group profile-bar__group--builtin" role="group" aria-label="Built-in profiles">
          {defaultBuiltIns.map((builtin) => {
            const active = activeId === builtin.id;
            return (
              <button
                key={builtin.id}
                type="button"
                className={`profile-pill profile-pill--builtin${active ? ' profile-pill--on' : ''}${
                  builtin.disabled ? ' profile-pill--disabled' : ''
                }`}
                onClick={() => {
                  if (!builtin.disabled) onActivate(builtin.id);
                }}
                disabled={builtin.disabled}
                aria-pressed={active}
                title={builtin.disabledReason ?? builtin.description}
              >
                {renderBuiltInIcon(builtin.icon)}
                <span>{builtin.name}</span>
                {builtin.count > 0 && (
                  <span className="profile-pill__count">{builtin.count}</span>
                )}
              </button>
            );
          })}
        </div>

        {/* Unsaved draft selection pill */}
        {hasDraft && (
          <button
            type="button"
            className={`profile-pill profile-pill--draft${activeId === '' ? ' profile-pill--on' : ''}`}
            onClick={() => onActivate('')}
            aria-pressed={activeId === ''}
            title="The working source selection you have not saved as a profile"
          >
            <span className="profile-pill__draft-dot" aria-hidden />
            <span>Current selection</span>
            <span className="profile-pill__count">{draftCount}</span>
          </button>
        )}

        {/* Custom user profiles */}
        {profiles.length > 0 && (
          <div className="profile-bar__group profile-bar__group--custom" role="group" aria-label="Custom profiles">
            {profiles.map((profile) => {
              const count = profile.providers.length + profile.indexers.length;
              const active = profile.id === activeId;
              return (
                <div key={profile.id} className="profile-pill-group">
                  <button
                    type="button"
                    className={`profile-pill${active ? ' profile-pill--on' : ''}`}
                    onClick={() => onActivate(profile.id)}
                    aria-pressed={active}
                    title={`Search ${count} source${count === 1 ? '' : 's'}`}
                  >
                    <span>{profile.name}</span>
                    <span className="profile-pill__count">{count}</span>
                  </button>
                  <button
                    type="button"
                    className="profile-pill__more"
                    onClick={() => setMenuFor(menuFor === profile.id ? null : profile.id)}
                    aria-label={`Manage ${profile.name}`}
                    aria-expanded={menuFor === profile.id}
                  >
                    ⋯
                  </button>

                  {menuFor === profile.id && (
                    <div className="profile-menu" role="menu">
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setNaming(profile.id);
                          setDraftName(profile.name);
                          setMenuFor(null);
                        }}
                      >
                        <Pencil size={13} /> Rename
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          onDuplicate(profile.id);
                          setMenuFor(null);
                        }}
                      >
                        <Copy size={13} /> Duplicate
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        className="profile-menu__danger"
                        onClick={() => {
                          setMenuFor(null);
                          setDeleteConfirm(profile.id);
                        }}
                      >
                        <Trash2 size={13} /> Delete
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Prominent + Create profile action */}
      <button
        type="button"
        className="btn btn-secondary btn-sm profile-bar__create-btn"
        onClick={() => {
          setNaming('new');
          setDraftName('');
        }}
        title="Create a new profile from current source selection"
      >
        <Plus size={13} /> Create profile
      </button>
    </div>
  );
};
