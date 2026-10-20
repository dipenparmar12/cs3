import React, { useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Clapperboard,
  Copy,
  Globe,
  Languages,
  MoreVertical,
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
  updatedAt?: number;
  createdAt?: number;
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
 * Search profiles management and switcher bar.
 * Follows progressive disclosure:
 * 1. All sources (pinned first)
 * 2. Your profiles (user-created, ordered by most recently modified)
 * 3. Presets (built-in profiles like Anime, Drama)
 * 4. Custom selection (draft state, shown only when unsaved changes exist)
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
  useDismissable(dropdownOpen, dropdownRef, () => {
    setDropdownOpen(false);
    setMenuFor(null);
  });

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
          placeholder={naming === 'new' ? 'Name this profile…' : 'New name…'}
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

  /** In-place delete confirmation for custom profile removal. */
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
          <Trash2 size={13} /> Delete
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

  // User-created profiles ordered by most recently modified
  const sortedCustomProfiles = [...profiles].sort((a, b) => {
    const timeA = a.updatedAt ?? a.createdAt ?? 0;
    const timeB = b.updatedAt ?? b.createdAt ?? 0;
    if (timeB !== timeA) return timeB - timeA;
    return a.name.localeCompare(b.name);
  });

  const allBuiltIn = defaultBuiltIns.find((b) => b.id === 'all');
  const otherPresets = defaultBuiltIns.filter((b) => b.id !== 'all');

  // Resolve current active profile info
  const activeCustom = profiles.find((p) => p.id === activeId);
  const activeBuiltIn = defaultBuiltIns.find((b) => b.id === activeId);
  const isDraftActive = activeId === '';

  let activeTitle = 'All sources';
  let activeCount = allBuiltIn?.count ?? 0;
  let activeIcon: BuiltInProfileDef['icon'] = 'globe';

  if (isDraftActive) {
    activeTitle = 'Your selection';
    activeCount = draftCount;
  } else if (activeCustom) {
    activeTitle = activeCustom.name;
    activeCount = activeCustom.providers.length + activeCustom.indexers.length;
  } else if (activeBuiltIn) {
    activeTitle = activeBuiltIn.name;
    activeCount = activeBuiltIn.count;
    activeIcon = activeBuiltIn.icon;
  }

  return (
    <div className="profile-bar-v2" ref={menuWrapper}>
      {/* Profile hero card */}
      <div className="profile-hero" ref={dropdownRef}>
        <div className="profile-hero__main">
          <div className="profile-hero__label-row">
            <span className="profile-hero__tag">
              {isDraftActive ? 'Unsaved' : 'Profile'}
            </span>
            {hasDraft && !isDraftActive && (
              <span className="profile-hero__draft-indicator" title="Working selection has unsaved changes">
                • Not saved yet
              </span>
            )}
          </div>
          <div className="profile-hero__title-row">
            <h3 className="profile-hero__name">
              {renderBuiltInIcon(activeIcon)}
              <span>{activeTitle}</span>
            </h3>
            <span className="profile-hero__count">
              {activeId === 'all' && activeCount > 0
                ? `${activeCount} available`
                : `${activeCount} ${activeCount === 1 ? 'source' : 'sources'}`}
            </span>
          </div>
        </div>

        <div className="profile-hero__actions">
          <button
            type="button"
            className="btn btn-secondary btn-sm profile-hero__switch-btn"
            onClick={() => setDropdownOpen((prev) => !prev)}
            aria-expanded={dropdownOpen}
            aria-haspopup="true"
          >
            <span>Change</span>
            <ChevronDown size={13} className={dropdownOpen ? 'rotate-180' : ''} />
          </button>
        </div>

        {/* Profile Switcher Dropdown */}
        {dropdownOpen && (
          <div className="profile-dropdown" role="menu">
            <div className="profile-dropdown__header">
              <span className="profile-dropdown__title">Search profiles</span>
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
              {/* 1. All sources: Pinned at top */}
              {allBuiltIn && (
                <div
                  role="menuitem"
                  className={`profile-dropdown__item${activeId === 'all' ? ' profile-dropdown__item--active' : ''}`}
                  onClick={() => {
                    onActivate('all');
                    setDropdownOpen(false);
                  }}
                  title={allBuiltIn.description}
                >
                  <div className="profile-dropdown__item-info">
                    <span className="profile-dropdown__item-name">
                      {renderBuiltInIcon(allBuiltIn.icon)}
                      {allBuiltIn.name}
                    </span>
                  </div>
                  <span className="profile-dropdown__item-count">
                    {allBuiltIn.count > 0 ? `${allBuiltIn.count} available` : 'All'}
                  </span>
                  {activeId === 'all' && <Check size={14} className="profile-dropdown__item-check" />}
                </div>
              )}

              {/* 2. Your profiles: User-created, ordered by most recently modified */}
              {sortedCustomProfiles.length > 0 && (
                <>
                  <div className="profile-dropdown__section-title">Your profiles</div>
                  {sortedCustomProfiles.map((profile) => {
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
                        title={`${profile.name} · ${count} sources saved`}
                      >
                        <div className="profile-dropdown__item-info">
                          <span className="profile-dropdown__item-name">{profile.name}</span>
                        </div>
                        <span className="profile-dropdown__item-count">{count} sources</span>
                        {active && <Check size={14} className="profile-dropdown__item-check" />}

                        <div
                          className="profile-dropdown__menu-wrapper"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            className="profile-dropdown__dots-btn"
                            title="Profile options"
                            aria-label={`Options for ${profile.name}`}
                            onClick={() => setMenuFor(menuFor === profile.id ? null : profile.id)}
                          >
                            <MoreVertical size={13} />
                          </button>
                          {menuFor === profile.id && (
                            <div className="profile-context-menu" role="menu">
                              <button
                                type="button"
                                className="profile-context-menu__item"
                                onClick={() => {
                                  setMenuFor(null);
                                  setNaming(profile.id);
                                  setDraftName(profile.name);
                                  setDropdownOpen(false);
                                }}
                              >
                                <Pencil size={12} /> Rename
                              </button>
                              <button
                                type="button"
                                className="profile-context-menu__item"
                                onClick={() => {
                                  setMenuFor(null);
                                  onDuplicate(profile.id);
                                  setDropdownOpen(false);
                                }}
                              >
                                <Copy size={12} /> Duplicate
                              </button>
                              <button
                                type="button"
                                className="profile-context-menu__item profile-context-menu__item--danger"
                                onClick={() => {
                                  setMenuFor(null);
                                  setDeleteConfirm(profile.id);
                                  setDropdownOpen(false);
                                }}
                              >
                                <Trash2 size={12} /> Delete
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </>
              )}

              {/* 3. Presets: Built-in profiles always below user profiles */}
              {otherPresets.length > 0 && (
                <>
                  <div className="profile-dropdown__section-title">Presets</div>
                  {otherPresets.map((builtin) => {
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
                        title={builtin.disabled ? builtin.disabledReason : builtin.description}
                      >
                        <div className="profile-dropdown__item-info">
                          <span className="profile-dropdown__item-name">
                            {renderBuiltInIcon(builtin.icon)}
                            {builtin.name}
                          </span>
                        </div>
                        {builtin.count > 0 && (
                          <span className="profile-dropdown__item-count">{builtin.count} sources</span>
                        )}
                        {active && <Check size={14} className="profile-dropdown__item-check" />}
                      </div>
                    );
                  })}
                </>
              )}

              {/* 4. Current selection: Shown only when unsaved changes exist */}
              {hasDraft && (
                <>
                  <div className="profile-dropdown__section-title">Your selection</div>
                  <div
                    role="menuitem"
                    className={`profile-dropdown__item${isDraftActive ? ' profile-dropdown__item--active' : ''}`}
                    onClick={() => {
                      onActivate('');
                      setDropdownOpen(false);
                    }}
                    title="Working selection with unsaved changes"
                  >
                    <div className="profile-dropdown__item-info">
                      <span className="profile-dropdown__item-name">
                        <span className="profile-pill__draft-dot" aria-hidden />
                        Custom selection
                      </span>
                    </div>
                    <span className="profile-dropdown__item-count profile-dropdown__item-count--draft">
                      {draftCount} sources · Unsaved
                    </span>
                    {isDraftActive && <Check size={14} className="profile-dropdown__item-check" />}
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
