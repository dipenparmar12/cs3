import React, { useState } from 'react';
import { Lock, UserCog, UserPlus, Users } from 'lucide-react';
import { Menu, type MenuItem } from '../ui';
import { ProfileAvatar } from './ProfileAvatar';
import { ProfilesDialog, type ProfilesView } from './ProfilesDialog';
import { MAX_PROFILES } from '../../types/profiles';
import { activeProfile, switchProfile, useUserProfiles } from '../../utils/useUserProfiles';

/**
 * The avatar at the top right: who is watching, and the way into profiles.
 *
 * With one profile it is a short menu — add a profile, edit this one — so a
 * single viewer never meets anything that feels like an account system. The
 * other profiles appear only once there are some.
 */
export const ProfileMenu: React.FC = () => {
  const { state } = useUserProfiles();
  const [dialog, setDialog] = useState<ProfilesView | null>(null);
  const active = activeProfile(state);
  if (!state || !active) return null;

  const others = state.profiles.filter((profile) => profile.id !== active.id);
  const items: MenuItem[] = [
    ...others.map((profile, index) => ({
      label: profile.name,
      leading: <ProfileAvatar avatar={profile.avatar} size="xs" />,
      trailing: profile.locked ? <Lock size={12} aria-label="Locked" /> : undefined,
      separatorBefore: index === 0,
      onSelect: () => {
        if (profile.locked) setDialog({ kind: 'unlock', profileId: profile.id, then: 'switch' });
        else void switchProfile(profile.id);
      },
    })),
    ...(others.length > 0
      ? [{ label: 'Manage profiles', icon: Users, separatorBefore: true, onSelect: () => setDialog({ kind: 'list' }) }]
      : []),
    {
      label: 'Add profile',
      icon: UserPlus,
      separatorBefore: others.length === 0,
      disabled: state.profiles.length >= MAX_PROFILES,
      onSelect: () => setDialog({ kind: 'editor', profileId: null }),
    },
    { label: 'Profile settings', icon: UserCog, onSelect: () => setDialog({ kind: 'editor', profileId: active.id }) },
  ];

  return (
    <>
      <Menu
        label="Profile"
        align="end"
        className="viewer-menu"
        header={
          <div className="viewer-menu__header">
            <ProfileAvatar avatar={active.avatar} size="md" />
            <span className="viewer-menu__who">
              <strong>{active.name}</strong>
              {active.locked ? (
                <span className="viewer-menu__locked">
                  <Lock size={11} aria-hidden /> Locked
                </span>
              ) : null}
            </span>
          </div>
        }
        trigger={(props) => (
          <button
            {...props}
            type="button"
            className="viewer-menu__trigger"
            aria-label={`Profile: ${active.name}`}
            title={active.name}
          >
            <ProfileAvatar avatar={active.avatar} size="sm" />
          </button>
        )}
        items={items}
      />
      {dialog ? <ProfilesDialog initial={dialog} onClose={() => setDialog(null)} /> : null}
    </>
  );
};
