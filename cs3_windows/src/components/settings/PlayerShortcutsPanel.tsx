import React from 'react';
import { SettingRow } from './SettingRow';

interface ShortcutItem {
  action: string;
  keys: string[];
}

interface ShortcutCategory {
  title: string;
  note: string;
  keywords: string;
  items: ShortcutItem[];
}

const SHORTCUT_CATEGORIES: ShortcutCategory[] = [
  {
    title: 'Playback & Fullscreen',
    note: 'Basic playback, pause and screen controls',
    keywords: 'play pause space k fullscreen f exit escape',
    items: [
      { action: 'Play / Pause', keys: ['Space', 'K'] },
      { action: 'Toggle Fullscreen', keys: ['F'] },
      { action: 'Exit Fullscreen / Close Panel', keys: ['Esc'] },
    ],
  },
  {
    title: 'Volume & Audio',
    note: 'Mute, unmute and volume adjustment',
    keywords: 'volume audio sound mute m arrow up down',
    items: [
      { action: 'Mute / Unmute', keys: ['M'] },
      { action: 'Volume Up (+5%)', keys: ['↑'] },
      { action: 'Volume Down (-5%)', keys: ['↓'] },
    ],
  },
  {
    title: 'Seeking & Navigation',
    note: '10s jump, timeline scrubber and direct percentage',
    keywords: 'seek forward backward 10s jump arrow left right j l home end percentage',
    items: [
      { action: 'Seek Forward 10s', keys: ['→', 'L'] },
      { action: 'Seek Backward 10s', keys: ['←', 'J'] },
      { action: 'Seek to 0% – 90%', keys: ['0', '–', '9'] },
      { action: 'Jump to Beginning (0:00)', keys: ['Home'] },
      { action: 'Jump to End', keys: ['End'] },
    ],
  },
  {
    title: 'Subtitles & Closed Captions',
    note: 'Toggle, track cycling and subtitle search drawer',
    keywords: 'subtitles cc captions tracks cycle c v s drawer sync',
    items: [
      { action: 'Toggle Subtitles On / Off', keys: ['C'] },
      { action: 'Cycle Subtitle Tracks', keys: ['V'] },
      { action: 'Open Subtitle & Sync Drawer', keys: ['S'] },
    ],
  },
  {
    title: 'Playback Speed & Episodes',
    note: 'Adjust speed and navigate TV series episodes',
    keywords: 'speed rate faster slower episodes next previous series n p e',
    items: [
      { action: 'Increase Speed', keys: ['>', ']'] },
      { action: 'Decrease Speed', keys: ['<', '['] },
      { action: 'Next Episode', keys: ['N'] },
      { action: 'Previous Episode', keys: ['P'] },
      { action: 'Toggle Episodes Drawer', keys: ['E'] },
    ],
  },
];

export const PlayerShortcutsPanel: React.FC = () => {
  return (
    <div className="player-shortcuts-wrapper">
      {SHORTCUT_CATEGORIES.map((category) => (
        <SettingRow
          key={category.title}
          label={category.title}
          note={category.note}
          keywords={category.keywords}
          stacked
        >
          <div className="player-shortcuts-grid">
            {category.items.map((item) => (
              <div key={item.action} className="player-shortcut-card">
                <span className="player-shortcut-row__action">{item.action}</span>
                <div className="player-shortcut-row__keys">
                  {item.keys.map((k, idx) => (
                    <React.Fragment key={idx}>
                      {idx > 0 && item.keys[idx - 1] !== '0' && k !== '–' && item.keys[idx - 1] !== '–' && (
                        <span className="player-kbd-sep">or</span>
                      )}
                      <kbd className="player-kbd">{k}</kbd>
                    </React.Fragment>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </SettingRow>
      ))}
    </div>
  );
};
