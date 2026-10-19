import React, { useEffect, useState } from 'react';
import { Lock } from 'lucide-react';
import { Button, FormField, Input } from '../ui';
import { ProfileAvatar } from './ProfileAvatar';
import type { UserProfilesState } from '../../types/profiles';
import { loadUserProfiles, switchProfile, useUserProfiles } from '../../utils/useUserProfiles';

/**
 * What decides which profile the app is drawn for.
 *
 * The app is keyed on the active profile, so a switch unmounts it whole and
 * mounts it fresh: no screen, filter or player can carry one person's state
 * into another's. Nothing is drawn until the main process has said which
 * profile is open — one round trip at launch — because the answer may be a
 * locked profile that must show nothing until it is unlocked.
 */
export const ProfileRoot: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { state, switchingTo } = useUserProfiles();
  useEffect(() => {
    void loadUserProfiles();
  }, []);

  if (!state) return null;
  if (switchingTo) {
    return (
      <div className="profile-screen" role="status" aria-live="polite">
        <ProfileAvatar avatar={switchingTo.avatar} size="lg" />
        <p className="profile-screen__caption">Opening {switchingTo.name}…</p>
      </div>
    );
  }
  if (state.gated) return <ProfileLockScreen state={state} />;
  return <React.Fragment key={state.activeId}>{children}</React.Fragment>;
};

/**
 * The app opened on a locked profile. Its PIN, or another profile — never a
 * glimpse of the locked one's library first.
 */
const ProfileLockScreen: React.FC<{ state: UserProfilesState }> = ({ state }) => {
  const [chosenId, setChosenId] = useState(state.activeId);
  const [secret, setSecret] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const chosen = state.profiles.find((profile) => profile.id === chosenId) ?? state.profiles[0];
  const others = state.profiles.filter((profile) => profile.id !== chosen.id);

  const open = async (profileId: string, withSecret?: string) => {
    setBusy(true);
    setError(null);
    const result = await switchProfile(profileId, withSecret);
    setBusy(false);
    if (!result.ok) setError(result.error);
  };

  return (
    <div className="profile-screen">
      <div className="profile-screen__card">
        <ProfileAvatar avatar={chosen.avatar} size="lg" />
        <h1 className="profile-screen__name">{chosen.name}</h1>
        {chosen.locked ? (
          <form
            className="profile-screen__form"
            onSubmit={(event) => {
              event.preventDefault();
              if (secret && !busy) void open(chosen.id, secret);
            }}
          >
            <FormField label="PIN or password" error={error ?? undefined}>
              {(control) => (
                <Input
                  {...control}
                  key={chosen.id}
                  type="password"
                  autoComplete="off"
                  autoFocus
                  value={secret}
                  onChange={(event) => setSecret(event.target.value)}
                />
              )}
            </FormField>
            <Button type="submit" variant="prominent" icon={Lock} loading={busy} disabled={!secret}>
              Unlock
            </Button>
          </form>
        ) : (
          <Button variant="prominent" loading={busy} onClick={() => void open(chosen.id)}>
            Open
          </Button>
        )}
      </div>

      {others.length > 0 ? (
        <div className="profile-screen__others">
          <span className="profile-screen__caption">Use another profile</span>
          <div className="profile-screen__choices">
            {others.map((profile) => (
              <button
                key={profile.id}
                type="button"
                className="profile-screen__choice"
                onClick={() => {
                  setChosenId(profile.id);
                  setSecret('');
                  setError(null);
                  if (!profile.locked) void open(profile.id);
                }}
                disabled={busy}
              >
                <ProfileAvatar avatar={profile.avatar} size="md" />
                <span>{profile.name}</span>
                {profile.locked ? <Lock size={11} aria-label="Locked" /> : null}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
};
