import React from 'react';
import {
  Bird,
  Cat,
  Crown,
  Dog,
  Flame,
  Gamepad2,
  Ghost,
  Heart,
  Leaf,
  Moon,
  Music,
  Rocket,
  Smile,
  Star,
  Sun,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import type { ProfileAvatarId } from '../../types/profiles';

/**
 * The avatars a profile can wear: a glyph on a colour, drawn rather than
 * uploaded, so making a profile never asks for a picture. SVG icons rather
 * than emoji, for the reason the flags are (`FlagIcon.tsx`) — Windows draws
 * emoji inconsistently.
 */
export const PROFILE_AVATARS: Record<ProfileAvatarId, { icon: LucideIcon; hue: number; label: string }> = {
  smile: { icon: Smile, hue: 212, label: 'Smile' },
  star: { icon: Star, hue: 45, label: 'Star' },
  rocket: { icon: Rocket, hue: 262, label: 'Rocket' },
  cat: { icon: Cat, hue: 24, label: 'Cat' },
  dog: { icon: Dog, hue: 32, label: 'Dog' },
  ghost: { icon: Ghost, hue: 228, label: 'Ghost' },
  gamepad: { icon: Gamepad2, hue: 290, label: 'Gamepad' },
  music: { icon: Music, hue: 330, label: 'Music' },
  leaf: { icon: Leaf, hue: 142, label: 'Leaf' },
  sun: { icon: Sun, hue: 38, label: 'Sun' },
  moon: { icon: Moon, hue: 245, label: 'Moon' },
  flame: { icon: Flame, hue: 8, label: 'Flame' },
  zap: { icon: Zap, hue: 52, label: 'Lightning' },
  heart: { icon: Heart, hue: 350, label: 'Heart' },
  crown: { icon: Crown, hue: 275, label: 'Crown' },
  bird: { icon: Bird, hue: 188, label: 'Bird' },
};

const SIZES = { xs: 20, sm: 26, md: 36, lg: 64 } as const;

export const ProfileAvatar: React.FC<{
  avatar: ProfileAvatarId;
  size?: keyof typeof SIZES;
  className?: string;
}> = ({ avatar, size = 'sm', className }) => {
  const entry = PROFILE_AVATARS[avatar] ?? PROFILE_AVATARS.smile;
  const Icon = entry.icon;
  const pixels = SIZES[size];
  return (
    <span
      className={`profile-avatar${className ? ` ${className}` : ''}`}
      style={{ width: pixels, height: pixels, '--avatar-hue': entry.hue } as React.CSSProperties}
      aria-hidden
    >
      <Icon size={Math.round(pixels * 0.56)} strokeWidth={2.2} />
    </span>
  );
};
