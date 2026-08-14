import React from 'react';
import { ChevronUp, X, Radio } from 'lucide-react';

/**
 * The marker for a player that is still running out of sight.
 *
 * Stepping out of the player to the Downloads screen deliberately does not end
 * the session — the whole point is to keep the stream, its position and its
 * buffer — but that leaves something playing with nothing on screen accounting
 * for it. Audio continuing from an invisible player with no way to reach it is
 * the kind of thing people describe as the app being haunted.
 *
 * So it stays visible and stays reachable. Both exits are offered, because after
 * walking off to Downloads "I am finished with this" is at least as likely as
 * "take me back", and making the second require a return trip through the player
 * would be a worse answer than the close button it replaced.
 */

interface MiniPlayerBarProps {
  title: string;
  episodeTitle?: string;
  onReturn: () => void;
  onStop: () => void;
}

export const MiniPlayerBar: React.FC<MiniPlayerBarProps> = ({
  title,
  episodeTitle,
  onReturn,
  onStop,
}) => (
  <div
    className="mini-player-bar"
    role="status"
    aria-label="Playback continues in the background"
    style={{
      position: 'fixed',
      bottom: '1.1rem',
      right: '1.4rem',
      zIndex: 55,
      display: 'flex',
      alignItems: 'center',
      gap: '0.85rem',
      padding: '0.6rem 0.7rem 0.6rem 0.95rem',
      maxWidth: 'min(30rem, calc(100vw - 3rem))',
      background: 'rgba(12, 15, 23, 0.96)',
      backdropFilter: 'blur(12px)',
      border: '1px solid rgba(255, 255, 255, 0.12)',
      borderRadius: '10px',
      boxShadow: '0 10px 30px rgba(0, 0, 0, 0.55)',
      color: '#fff',
    }}
  >
    <Radio size={16} style={{ color: 'var(--accent-light, #60a5fa)', flexShrink: 0 }} />

    <div style={{ overflow: 'hidden', minWidth: 0 }}>
      <div
        style={{
          fontSize: '0.84rem',
          fontWeight: 600,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
        title={title}
      >
        {title}
      </div>
      <div
        style={{
          fontSize: '0.72rem',
          color: 'var(--text-subtle, #888)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {episodeTitle ? `${episodeTitle} · still playing` : 'Still playing'}
      </div>
    </div>

    <button
      onClick={onReturn}
      title="Back to the player"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.35rem',
        padding: '0.4rem 0.7rem',
        background: 'var(--accent-primary, #3b82f6)',
        border: 'none',
        borderRadius: '6px',
        color: '#fff',
        fontSize: '0.8rem',
        fontWeight: 600,
        cursor: 'pointer',
        flexShrink: 0,
      }}
    >
      <ChevronUp size={14} />
      Return
    </button>

    <button
      onClick={onStop}
      title="Stop playback and close"
      aria-label="Stop playback"
      style={{
        display: 'flex',
        padding: '0.4rem',
        background: 'transparent',
        border: 'none',
        color: '#aaa',
        cursor: 'pointer',
        flexShrink: 0,
      }}
    >
      <X size={16} />
    </button>
  </div>
);
