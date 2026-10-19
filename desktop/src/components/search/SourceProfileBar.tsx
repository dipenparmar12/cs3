import React, { useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Clapperboard,
  Copy,
  Globe,
  Languages,
  Pencil,
  Plus,
  ShieldAlert,
  SlidersHorizontal,
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
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const menuWrapper = useRef<HTMLDivElement | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  useDismissable(menuFor !== null, menuWrapper, () => setMenuFor(null));
  useDismissable(dropdownOpen, dropdownRef, () => setDropdownOpen(false));

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

  // Resolve current active profile info
  const activeCustom = profiles.find((p) => p.id === activeId);
  const activeBuiltIn = defaultBuiltIns.find((b) => b.id === activeId);
  const isDraftActive = activeId === '';

  let activeTitle = 'All sources';
  let activeDescription = 'Search every enabled extension and torrent source';
  let activeCount = defaultBuiltIns.find((b) => b.id === 'all')?.count ?? 0;
  let activeIcon: BuiltInProfileDef['icon'] = 'globe';

  if (isDraftActive) {
    activeTitle = 'Current selection';
    activeDescription = 'Unsaved custom source selection';
    activeCount = draftCount;
  } else if (activeCustom) {
    activeTitle = activeCustom.name;
    activeDescription = 'Custom saved search profile';
    activeCount = activeCustom.providers.length + activeCustom.indexers.length;
  } else if (activeBuiltIn) {
    activeTitle = activeBuiltIn.name;
    activeDescription = activeBuiltIn.description;
    activeCount = activeBuiltIn.count;
    activeIcon = activeBuiltIn.icon;
  }

  return (
    <div className="profile-bar-v2" ref={menuWrapper}>
      {/* Profile selector hero */}
      <div className="profile-hero" ref={dropdownRef}>
        <div className="profile-hero__main">
          <div className="profile-hero__badge">
            <span className="profile-hero__tag">Active Profile</span>
            {hasDraft && !isDraftActive && (
              <span className="profile-hero__draft-indicator" title="You have an unsaved selection draft">
                • Unsaved changes
              </span>
            )}
          </div>
          <div className="profile-hero__title-row">
            <h3 className="profile-hero__name">
              {renderBuiltInIcon(activeIcon)}
              <span>{activeTitle}</span>
            </h3>
            <span className="profile-hero__count">
              {activeCount} {activeCount === 1 ? 'source' : 'sources'} enabled
            </span>
          </div>
          <p className="profile-hero__desc">{activeDescription}</p>
        </div>

        <div className="profile-hero__actions">
          <button
            type="button"
            className="btn btn-secondary btn-sm profile-hero__switch-btn"
            onClick={() => setDropdownOpen((prev) => !prev)}
            aria-expanded={dropdownOpen}
            aria-haspopup="true"
          >
            <SlidersHorizontal size={13} />
            <span>Change profile</span>
            <ChevronDown size={13} className={dropdownOpen ? 'rotate-180' : ''} />
          </button>

          <button
            type="button"
            className="btn btn-ghost btn-sm profile-hero__create-btn"
            onClick={() => {
              setNaming('new');
              setDraftName('');
              setDropdownOpen(false);
            }}
            title="Create a new profile from current source selection"
          >
            <Plus size={13} />
            <span>Create profile</span>
          </button>
        </div>

        {/* Profile Switcher Dropdown */}
        {dropdownOpen && (
          <div className="profile-dropdown" role="menu">
            <div className="profile-dropdown__header">
              <span>Switch or manage search profiles</span>
              <button
                type="button"
                className="profile-dropdown__new-btn"
                onClick={() => {
                  setNaming('new');
                  setDraftName('');
                  setDropdownOpen(false);
                }}
              >
                <Plus size={12} /> New
              </button>
            </div>

            <div className="profile-dropdown__list">
              {/* Built-in preset profiles */}
              <div className="profile-dropdown__section-title">Built-in Presets</div>
              {defaultBuiltIns.map((builtin) => {
                const active = activeId === builtin.id;
                return (
                  <div
                    key={builtin.id}
                    role="menuitem"
                    className={`profile-dropdown__item${active ? ' profile-dropdown__item--active' : ''}${
                      builtin.disabled ? ' profile-dropdown__item--disabled' : ''
                    }`}
                    onClick={() => {
                      if (!builtin.disabled) {
                        onActivate(builtin.id);
                        setDropdownOpen(false);
                      }
                    }}
                  >
                    <div className="profile-dropdown__item-info">
                      <span className="profile-dropdown__item-name">
                        {renderBuiltInIcon(builtin.icon)}
                        {builtin.name}
                      </span>
                      <span className="profile-dropdown__item-desc">{builtin.description}</span>
                    </div>
                    {builtin.count > 0 && (
                      <span className="profile-dropdown__item-count">{builtin.count}</span>
                    )}
                    {active && <Check size={14} className="profile-dropdown__item-check" />}
                  </div>
                );
              })}

              {/* Unsaved draft selection */}
              {hasDraft && (
                <>
                  <div className="profile-dropdown__section-title">Draft</div>
                  <div
                    role="menuitem"
                    className={`profile-dropdown__item${isDraftActive ? ' profile-dropdown__item--active' : ''}`}
                    onClick={() => {
                      onActivate('');
                      setDropdownOpen(false);
                    }}
                  >
                    <div className="profile-dropdown__item-info">
                      <span className="profile-dropdown__item-name">
                        <span className="profile-pill__draft-dot" aria-hidden />
                        Current selection
                      </span>
                      <span className="profile-dropdown__item-desc">
                        Working selection not yet saved as a named profile
                      </span>
                    </div>
                    <span className="profile-dropdown__item-count">{draftCount}</span>
                    {isDraftActive && <Check size={14} className="profile-dropdown__item-check" />}
                  </div>
                </>
              )}

              {/* Custom user profiles */}
              {profiles.length > 0 && (
                <>
                  <div className="profile-dropdown__section-title">Custom Profiles</div>
                  {profiles.map((profile) => {
                    const count = profile.providers.length + profile.indexers.length;
                    const active = profile.id === activeId;
                    return (
                      <div
                        key={profile.id}
                        role="menuitem"
                        className={`profile-dropdown__item${active ? ' profile-dropdown__item--active' : ''}`}
                        onClick={() => {
                          onActivate(profile.id);
                          setDropdownOpen(false);
                        }}
                      >
                        <div className="profile-dropdown__item-info">
                          <span className="profile-dropdown__item-name">{profile.name}</span>
                          <span className="profile-dropdown__item-desc">
                            {count} sources saved
                          </span>
                        </div>
                        <span className="profile-dropdown__item-count">{count}</span>
                        {active && <Check size={14} className="profile-dropdown__item-check" />}

                        <div className="profile-dropdown__item-actions" onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            className="profile-dropdown__action-btn"
                            title="Rename"
                            onClick={() => {
                              setNaming(profile.id);
                              setDraftName(profile.name);
                              setDropdownOpen(false);
                            }}
                          >
                            <Pencil size={12} />
                          </button>
                          <button
                            type="button"
                            className="profile-dropdown__action-btn"
                            title="Duplicate"
                            onClick={() => {
                              onDuplicate(profile.id);
                              setDropdownOpen(false);
                            }}
                          >
                            <Copy size={12} />
                          </button>
                          <button
                            type="button"
                            className="profile-dropdown__action-btn profile-dropdown__action-btn--danger"
                            title="Delete"
                            onClick={() => {
                              setDeleteConfirm(profile.id);
                              setDropdownOpen(false);
                            }}
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
