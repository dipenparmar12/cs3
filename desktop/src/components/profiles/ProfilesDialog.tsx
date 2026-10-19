import React, { useMemo, useState } from 'react';
import { Copy, Lock, Pencil, Trash2, UserPlus } from 'lucide-react';
import { Button, Checkbox, Dialog, DialogActions, FormField, Input } from '../ui';
import { ProfileAvatar, PROFILE_AVATARS } from './ProfileAvatar';
import {
  MAX_PROFILES,
  PROFILE_AVATAR_IDS,
  PROFILE_NAME_MAX,
  PROFILE_SECRET_MIN,
  type ProfileActionResult,
  type ProfileAvatarId,
  type UserProfile,
} from '../../types/profiles';
import {
  createProfile,
  deleteProfile,
  duplicateProfile,
  removeProfileLock,
  setProfileLock,
  switchProfile,
  updateProfile,
  useUserProfiles,
  verifyProfile,
} from '../../utils/useUserProfiles';

/**
 * Everything about profiles past the menu: the list, adding and editing one,
 * its optional lock, and deleting it.
 *
 * One dialog with views rather than dialogs opening dialogs — two stacked
 * dialogs would both take Escape — and a locked profile asked about from
 * another one is unlocked *in place*, its secret kept only for as long as this
 * dialog is open.
 */

type Then = 'switch' | 'edit' | 'duplicate' | 'delete';

export type ProfilesView =
  | { kind: 'list' }
  | { kind: 'editor'; profileId: string | null }
  | { kind: 'unlock'; profileId: string; then: Then }
  | { kind: 'delete'; profileId: string };

export const ProfilesDialog: React.FC<{ initial: ProfilesView; onClose: () => void }> = ({ initial, onClose }) => {
  const { state } = useUserProfiles();
  const [view, setView] = useState<ProfilesView>(initial);
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const profiles = state?.profiles ?? [];
  const find = (id: string) => profiles.find((profile) => profile.id === id);
  const startedInList = initial.kind === 'list';
  const back = () => {
    setError(null);
    if (startedInList) setView({ kind: 'list' });
    else onClose();
  };

  /** A locked profile other than the one in use needs its secret for anything. */
  const needsSecret = (profile: UserProfile) =>
    profile.locked && profile.id !== state?.activeId && secrets[profile.id] === undefined;

  const run = async (work: () => Promise<ProfileActionResult>): Promise<ProfileActionResult> => {
    setBusy(true);
    setError(null);
    const result = await work();
    setBusy(false);
    if (!result.ok) setError(result.error);
    return result;
  };

  const perform = async (profile: UserProfile, then: Then, secret = secrets[profile.id]) => {
    setError(null);
    if (then === 'switch') {
      const result = await run(() => switchProfile(profile.id, secret));
      if (result.ok) onClose();
    } else if (then === 'edit') {
      setView({ kind: 'editor', profileId: profile.id });
    } else if (then === 'duplicate') {
      const result = await run(() => duplicateProfile(profile.id, secret));
      if (result.ok) setView({ kind: 'list' });
    } else {
      setView({ kind: 'delete', profileId: profile.id });
    }
  };

  const act = (profile: UserProfile, then: Then) => {
    if (needsSecret(profile)) setView({ kind: 'unlock', profileId: profile.id, then });
    else void perform(profile, then);
  };

  if (!state) return null;

  if (view.kind === 'unlock') {
    const profile = find(view.profileId);
    if (!profile) return null;
    return (
      <UnlockView
        profile={profile}
        busy={busy}
        error={error}
        onCancel={back}
        onUnlock={async (secret) => {
          if (view.then === 'switch') return perform(profile, 'switch', secret);
          const result = await run(() => verifyProfile(profile.id, secret));
          if (!result.ok) return;
          setSecrets((known) => ({ ...known, [profile.id]: secret }));
          void perform(profile, view.then, secret);
        }}
      />
    );
  }

  if (view.kind === 'delete') {
    const profile = find(view.profileId);
    if (!profile) return null;
    return (
      <Dialog
        size="sm"
        tone="danger"
        icon={<Trash2 size={18} />}
        title={`Delete ${profile.name}?`}
        description="Its library, history and settings are removed from this computer. This can't be undone."
        onClose={back}
        dismissable={!busy}
        initialFocus=".profiles-dialog__safe"
        footer={
          <DialogActions>
            <Button className="profiles-dialog__safe" onClick={back} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              loading={busy}
              onClick={async () => {
                const result = await run(() => deleteProfile(profile.id, secrets[profile.id]));
                if (result.ok) setView({ kind: 'list' });
              }}
            >
              Delete profile
            </Button>
          </DialogActions>
        }
      >
        {error ? <p className="profiles-dialog__error" role="alert">{error}</p> : null}
      </Dialog>
    );
  }

  if (view.kind === 'editor') {
    const profile = view.profileId ? find(view.profileId) ?? null : null;
    return (
      <EditorView
        key={view.profileId ?? 'new'}
        profile={profile}
        profiles={profiles}
        isActive={profile?.id === state.activeId}
        knownSecret={profile ? secrets[profile.id] : undefined}
        busy={busy}
        error={error}
        onCancel={back}
        onDelete={profile && !profile.isDefault ? () => setView({ kind: 'delete', profileId: profile.id }) : undefined}
        onSave={async (draft) => {
          if (!profile) {
            const result = await run(() =>
              createProfile({ name: draft.name, avatar: draft.avatar, secret: draft.lock?.secret })
            );
            if (result.ok) setView({ kind: 'list' });
            return;
          }
          const secret = secrets[profile.id];
          if (draft.name !== profile.name || draft.avatar !== profile.avatar) {
            const result = await run(() => updateProfile(profile.id, { name: draft.name, avatar: draft.avatar }, secret));
            if (!result.ok) return;
          }
          if (draft.lock) {
            const { mode, secret: next, current } = draft.lock;
            const result = await run(() =>
              mode === 'remove'
                ? removeProfileLock(profile.id, current ?? '')
                : setProfileLock(profile.id, next ?? '', current ?? secret)
            );
            if (!result.ok) return;
          }
          back();
        }}
      />
    );
  }

  const full = profiles.length >= MAX_PROFILES;
  return (
    <Dialog
      size="md"
      title="Profiles"
      description="Each profile keeps its own library, history and settings."
      onClose={onClose}
      dismissable={!busy}
      footer={
        <DialogActions
          start={
            <Button
              icon={UserPlus}
              onClick={() => setView({ kind: 'editor', profileId: null })}
              disabled={full || busy}
              title={full ? `Up to ${MAX_PROFILES} profiles` : undefined}
            >
              Add profile
            </Button>
          }
        >
          <Button variant="prominent" onClick={onClose}>
            Done
          </Button>
        </DialogActions>
      }
    >
      <ul className="profiles-dialog__list">
        {profiles.map((profile) => {
          const inUse = profile.id === state.activeId && !state.gated;
          return (
            <li key={profile.id} className="profiles-dialog__row">
              <ProfileAvatar avatar={profile.avatar} size="md" />
              <div className="profiles-dialog__identity">
                <span className="profiles-dialog__name">{profile.name}</span>
                <span className="profiles-dialog__meta">
                  {[inUse ? 'In use' : null, profile.isDefault ? 'Default' : null].filter(Boolean).join(' · ')}
                  {profile.locked ? (
                    <span className="profiles-dialog__locked">
                      <Lock size={11} aria-hidden /> Locked
                    </span>
                  ) : null}
                </span>
              </div>
              <div className="profiles-dialog__actions">
                {!inUse ? (
                  <Button size="compact" onClick={() => act(profile, 'switch')} disabled={busy}>
                    Switch
                  </Button>
                ) : null}
                <Button
                  size="compact"
                  variant="ambient"
                  iconOnly
                  icon={Pencil}
                  aria-label={`Edit ${profile.name}`}
                  title="Edit"
                  onClick={() => act(profile, 'edit')}
                  disabled={busy}
                />
                <Button
                  size="compact"
                  variant="ambient"
                  iconOnly
                  icon={Copy}
                  aria-label={`Duplicate ${profile.name}`}
                  title="Duplicate (settings only)"
                  onClick={() => act(profile, 'duplicate')}
                  disabled={busy || full}
                />
                {!profile.isDefault ? (
                  <Button
                    size="compact"
                    variant="ambient"
                    iconOnly
                    icon={Trash2}
                    aria-label={`Delete ${profile.name}`}
                    title="Delete"
                    onClick={() => act(profile, 'delete')}
                    disabled={busy}
                  />
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
      {error ? <p className="profiles-dialog__error" role="alert">{error}</p> : null}
    </Dialog>
  );
};

// --- unlock -------------------------------------------------------------------

const UnlockView: React.FC<{
  profile: UserProfile;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onUnlock: (secret: string) => void | Promise<void>;
}> = ({ profile, busy, error, onCancel, onUnlock }) => {
  const [secret, setSecret] = useState('');
  return (
    <Dialog
      size="sm"
      icon={<Lock size={18} />}
      title={`Unlock ${profile.name}`}
      description="Enter its PIN or password."
      onClose={onCancel}
      dismissable={!busy}
      footer={
        <DialogActions>
          <Button onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button variant="prominent" loading={busy} disabled={!secret} onClick={() => void onUnlock(secret)}>
            Unlock
          </Button>
        </DialogActions>
      }
    >
      <form
        className="profiles-dialog__unlock"
        onSubmit={(event) => {
          event.preventDefault();
          if (secret && !busy) void onUnlock(secret);
        }}
      >
        <ProfileAvatar avatar={profile.avatar} size="lg" />
        <FormField label="PIN or password" error={error ?? undefined}>
          {(control) => (
            <Input
              {...control}
              type="password"
              autoComplete="off"
              autoFocus
              value={secret}
              onChange={(event) => setSecret(event.target.value)}
            />
          )}
        </FormField>
      </form>
    </Dialog>
  );
};

// --- add / edit -----------------------------------------------------------------

interface EditorDraft {
  name: string;
  avatar: ProfileAvatarId;
  lock?: { mode: 'set' | 'change' | 'remove'; secret?: string; current?: string };
}

const EditorView: React.FC<{
  profile: UserProfile | null;
  profiles: UserProfile[];
  isActive: boolean;
  knownSecret?: string;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onDelete?: () => void;
  onSave: (draft: EditorDraft) => void | Promise<void>;
}> = ({ profile, profiles, isActive, knownSecret, busy, error, onCancel, onDelete, onSave }) => {
  const firstFreeAvatar = useMemo(() => {
    const used = new Set(profiles.map((entry) => entry.avatar));
    return PROFILE_AVATAR_IDS.find((id) => !used.has(id)) ?? PROFILE_AVATAR_IDS[0];
  }, [profiles]);
  const [name, setName] = useState(profile?.name ?? '');
  const [avatar, setAvatar] = useState<ProfileAvatarId>(profile?.avatar ?? firstFreeAvatar);
  /** `keep` leaves the lock as it is; the other modes say what Save does to it. */
  const [lockMode, setLockMode] = useState<'keep' | 'set' | 'change' | 'remove'>('keep');
  const [secret, setSecret] = useState('');
  const [confirm, setConfirm] = useState('');
  const [current, setCurrent] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  const locked = Boolean(profile?.locked);
  const choosingSecret = lockMode === 'set' || lockMode === 'change';
  // The current secret is asked for when changing a lock, unless it was just
  // entered to open this profile from another one.
  const askCurrent = locked && (lockMode === 'change' || lockMode === 'remove') && knownSecret === undefined;

  const submit = () => {
    const trimmed = name.replace(/\s+/g, ' ').trim();
    if (!trimmed) return setProblem('Give the profile a name.');
    if (choosingSecret) {
      if (secret.length < PROFILE_SECRET_MIN) return setProblem(`Use at least ${PROFILE_SECRET_MIN} characters.`);
      if (secret !== confirm) return setProblem("The two entries don't match.");
    }
    if (askCurrent && !current) return setProblem('Enter the current PIN or password.');
    setProblem(null);
    void onSave({
      name: trimmed,
      avatar,
      lock:
        lockMode === 'keep'
          ? undefined
          : { mode: lockMode, secret: choosingSecret ? secret : undefined, current: current || knownSecret },
    });
  };

  const shown = problem ?? error;
  return (
    <Dialog
      size="md"
      title={profile ? 'Edit profile' : 'Add profile'}
      onClose={onCancel}
      dismissable={!busy}
      footer={
        <DialogActions
          start={
            onDelete ? (
              <Button variant="ambient" icon={Trash2} onClick={onDelete} disabled={busy}>
                Delete
              </Button>
            ) : undefined
          }
        >
          <Button onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button variant="prominent" loading={busy} onClick={submit}>
            {profile ? 'Save' : 'Add profile'}
          </Button>
        </DialogActions>
      }
    >
      <form
        className="profiles-dialog__editor"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div className="profiles-dialog__avatars" role="group" aria-label="Avatar">
          {PROFILE_AVATAR_IDS.map((id) => (
            <button
              key={id}
              type="button"
              className={`profiles-dialog__avatar-choice${id === avatar ? ' profiles-dialog__avatar-choice--on' : ''}`}
              aria-pressed={id === avatar}
              aria-label={PROFILE_AVATARS[id].label}
              title={PROFILE_AVATARS[id].label}
              onClick={() => setAvatar(id)}
            >
              <ProfileAvatar avatar={id} size="md" />
            </button>
          ))}
        </div>

        <FormField label="Name">
          {(control) => (
            <Input
              {...control}
              value={name}
              maxLength={PROFILE_NAME_MAX}
              autoFocus={!profile}
              placeholder="Who's watching?"
              onChange={(event) => setName(event.target.value)}
            />
          )}
        </FormField>

        <div className="profiles-dialog__lock">
          {locked ? (
            <div className="profiles-dialog__lock-row">
              <span className="profiles-dialog__locked">
                <Lock size={12} aria-hidden /> Locked
              </span>
              {lockMode === 'keep' ? (
                <span className="profiles-dialog__lock-actions">
                  <Button size="compact" variant="ambient" onClick={() => setLockMode('change')}>
                    Change PIN
                  </Button>
                  <Button size="compact" variant="ambient" onClick={() => setLockMode('remove')}>
                    Remove lock
                  </Button>
                </span>
              ) : (
                <Button size="compact" variant="ambient" onClick={() => setLockMode('keep')}>
                  Keep as is
                </Button>
              )}
            </div>
          ) : (
            <Checkbox
              checked={lockMode === 'set'}
              onChange={(on) => setLockMode(on ? 'set' : 'keep')}
              label="Lock with a PIN or password"
              description={
                isActive || !profile ? 'Optional. Asked for whenever someone switches to this profile.' : undefined
              }
            />
          )}

          {askCurrent ? (
            <FormField label="Current PIN or password">
              {(control) => (
                <Input
                  {...control}
                  type="password"
                  autoComplete="off"
                  value={current}
                  onChange={(event) => setCurrent(event.target.value)}
                />
              )}
            </FormField>
          ) : null}

          {choosingSecret ? (
            <div className="profiles-dialog__secret">
              <FormField
                label={lockMode === 'change' ? 'New PIN or password' : 'PIN or password'}
                helper={`A short PIN is easiest for everyday switching. Anything from ${PROFILE_SECRET_MIN} characters works.`}
              >
                {(control) => (
                  <Input
                    {...control}
                    type="password"
                    autoComplete="new-password"
                    value={secret}
                    onChange={(event) => setSecret(event.target.value)}
                  />
                )}
              </FormField>
              <FormField label="Confirm">
                {(control) => (
                  <Input
                    {...control}
                    type="password"
                    autoComplete="new-password"
                    value={confirm}
                    onChange={(event) => setConfirm(event.target.value)}
                  />
                )}
              </FormField>
            </div>
          ) : null}
        </div>

        {shown ? <p className="profiles-dialog__error" role="alert">{shown}</p> : null}
        {/* Enter submits from any field. */}
        <button type="submit" hidden aria-hidden tabIndex={-1} />
      </form>
    </Dialog>
  );
};
