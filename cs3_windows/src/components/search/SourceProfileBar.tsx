import React, { useRef, useState } from 'react';
import { Check, Copy, Globe, Pencil, Plus, Trash2 } from 'lucide-react';
import { useDismissable } from '../../utils/useDismissable';

export interface ProfileSummary {
  id: string;
  name: string;
  providers: string[];
  indexers: string[];
}

/**
 * Switching between saved selections, and the reason there are any.
 *
 * "All sources" used to be wired to an erasure. Someone who picked eleven Hindi
 * providers out of two hundred, searched, then pressed it to check one thing
 * had thrown that minute away with no undo and no record of what was lost. It
 * is a pill here, and switching to it puts the selection down rather than
 * deleting it — the state machine in `electron/cs3/sourceProfiles.ts` has a
 * test named after exactly that round trip.
 *
 * Everything else follows from having somewhere to put a selection that is not
 * the bin: name one, keep several, copy one to vary it. A profile is one click
 * to switch, which is the whole feature — the management lives behind the pill
 * it belongs to rather than in a settings screen, because a profile is only
 * ever edited in the moment you notice it is wrong.
 */
export const SourceProfileBar: React.FC<{
  profiles: ProfileSummary[];
  activeId: string;
  /** True when the unnamed selection holds something worth keeping. */
  hasDraft: boolean;
  draftCount: number;
  onActivate: (id: string) => void;
  onCreate: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
}> = ({
  profiles,
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

  /**
   * The name box replaces the bar rather than opening a dialog.
   *
   * A modal over a modal is the shape that makes Escape ambiguous, and this
   * dialog already binds Escape in the capture phase so that closing a menu
   * does not close the film behind it. One text field in place costs nothing
   * and cannot stack.
   */
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
              // Consumed here so the dialog behind does not also close.
              event.stopPropagation();
              setNaming(null);
              setDraftName('');
            }
          }}
          placeholder={naming === 'new' ? 'Name this set of sources…' : 'New name…'}
          aria-label={naming === 'new' ? 'Name for the new profile' : 'New name for this profile'}
        />
        <button className="btn btn-primary btn-sm" onClick={submitName} disabled={!draftName.trim()}>
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

  return (
    <div className="profile-bar" ref={menuWrapper}>
      <div className="profile-bar__pills" role="group" aria-label="Saved source sets">
        <button
          className={`profile-pill${activeId === 'all' ? ' profile-pill--on' : ''}`}
          onClick={() => onActivate('all')}
          aria-pressed={activeId === 'all'}
          title="Search everything you have installed"
        >
          <Globe size={13} />
          All sources
        </button>

        {/*
          The unnamed selection, shown only when it holds something.

          Without a pill it has nowhere to be: switching to All sources would
          keep it safely in the store and give the user no way back to it, which
          is a quieter version of the bug this replaces.
        */}
        {hasDraft && (
          <button
            className={`profile-pill${activeId === '' ? ' profile-pill--on' : ''}`}
            onClick={() => onActivate('')}
            aria-pressed={activeId === ''}
            title="The selection you have not named yet"
          >
            Current selection
            <span className="profile-pill__count">{draftCount}</span>
          </button>
        )}

        {profiles.map((profile) => {
          const count = profile.providers.length + profile.indexers.length;
          const active = profile.id === activeId;
          return (
            <div key={profile.id} className="profile-pill-group">
              <button
                className={`profile-pill${active ? ' profile-pill--on' : ''}`}
                onClick={() => onActivate(profile.id)}
                aria-pressed={active}
                title={`Search ${count} source${count === 1 ? '' : 's'}`}
              >
                {profile.name}
                <span className="profile-pill__count">{count}</span>
              </button>
              <button
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
                    role="menuitem"
                    onClick={() => {
                      onDuplicate(profile.id);
                      setMenuFor(null);
                    }}
                  >
                    <Copy size={13} /> Duplicate
                  </button>
                  {/*
                    No confirmation. A profile is a shortcut to a selection, not
                    the selection itself — deleting one loses no sources, no
                    downloads and no history, and a prompt in front of a
                    reversible thirty-second action is noise. Compare the delete
                    prompt on downloads, which guards a file.
                  */}
                  <button
                    role="menuitem"
                    className="profile-menu__danger"
                    onClick={() => {
                      onDelete(profile.id);
                      setMenuFor(null);
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

      {/*
        Offered only when there is something to save.

        "Save as profile" over an empty selection creates a profile that
        searches everything, which is what the All sources pill already is.
      */}
      {hasDraft && activeId === '' && (
        <button
          className="btn btn-ghost btn-sm profile-bar__save"
          onClick={() => {
            setNaming('new');
            setDraftName('');
          }}
        >
          <Plus size={13} /> Save these {draftCount}
        </button>
      )}
    </div>
  );
};
