import { useEffect, useMemo, useState } from 'react';
import { Loader2, X } from 'lucide-react';

/**
 * Which streaming services appear in the sidebar — Android's home-screen
 * provider picker, desktop-shaped.
 *
 * The list is not a table we maintain. Beside the hand-listed services it
 * carries every installed, enabled provider that publishes a catalogue
 * (`hasMainPage`), discovered by the main process from what extensions
 * registered. Installing an extension grows this list; nothing here names one.
 */
interface PickerPlatform {
  id: string;
  name: string;
  accent: string;
  availability: 'ready' | 'disabled' | 'aggregate' | 'missing';
  discovered?: boolean;
  extension?: string;
  types?: string[];
  lang?: string;
}

interface Props {
  onClose: () => void;
  /** Called after every toggle so the sidebar re-reads its list. */
  onChanged: () => void;
}

export const StreamingServicePicker: React.FC<Props> = ({ onClose, onChanged }) => {
  const [platforms, setPlatforms] = useState<PickerPlatform[] | null>(null);
  const [enabled, setEnabled] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void window.cloudstream?.listAllOttPlatforms().then((response) => {
      if (!live) return;
      if (!response?.ok) {
        setError(response?.error ?? 'Could not read the installed providers.');
        setPlatforms([]);
        return;
      }
      setPlatforms((response.platforms ?? []) as PickerPlatform[]);
      setEnabled(new Set(response.enabled ?? []));
    });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const toggle = async (id: string) => {
    const next = !enabled.has(id);
    const response = await window.cloudstream?.setOttPlatformEnabled(id, next);
    if (response?.ok && response.enabled) {
      setEnabled(new Set(response.enabled));
      onChanged();
    } else {
      setError(response?.error ?? 'That change was not saved.');
    }
  };

  const { listed, discovered } = useMemo(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const matches = (p: PickerPlatform) => {
      const hay = [p.name, p.extension, p.lang, ...(p.types ?? [])].join(' ').toLowerCase();
      return words.every((w) => hay.includes(w));
    };
    const all = (platforms ?? []).filter(matches);
    return {
      listed: all.filter((p) => !p.discovered),
      discovered: all.filter((p) => p.discovered),
    };
  }, [platforms, query]);

  const row = (p: PickerPlatform) => (
    <label
      key={p.id}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.6rem',
        padding: '0.45rem 0.6rem',
        borderRadius: 'var(--radius-md)',
        cursor: 'pointer',
        background: enabled.has(p.id) ? 'var(--bg-card-hover)' : 'transparent',
      }}
    >
      <input type="checkbox" checked={enabled.has(p.id)} onChange={() => void toggle(p.id)} />
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: p.accent, flexShrink: 0 }} />
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ color: '#fff', fontSize: '0.85rem' }}>{p.name}</span>
        <span style={{ display: 'block', color: 'var(--text-subtle)', fontSize: '0.7rem' }}>
          {p.discovered
            ? [p.extension, p.lang?.toUpperCase(), (p.types ?? []).slice(0, 3).join(', ')]
                .filter(Boolean)
                .join(' · ')
            : p.availability === 'missing'
              ? 'Not installed yet — its page offers the extension'
              : p.availability === 'disabled'
                ? 'Installed but switched off'
                : p.availability === 'aggregate'
                  ? 'Carried by another extension'
                  : 'Installed'}
        </span>
      </span>
    </label>
  );

  return (
    <div
      role="dialog"
      aria-label="Choose streaming services"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.55)',
        zIndex: 50,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
      }}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        style={{
          width: 'min(520px, 100%)',
          maxHeight: '80vh',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--bg-sidebar)',
          border: '1px solid var(--border-color)',
          borderRadius: 'var(--radius-lg, 12px)',
          padding: '1rem',
          gap: '0.75rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 style={{ fontSize: '1rem', color: '#fff', margin: 0 }}>Streaming services</h2>
          <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
            <X size={18} />
          </button>
        </div>
        <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-subtle)' }}>
          Pick which catalogues appear in the sidebar. Every installed provider that publishes a
          home page is listed — install more extensions to see more here.
        </p>
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter by name, extension, language or type"
          style={{
            padding: '0.5rem 0.7rem',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border-color)',
            background: 'var(--bg-card)',
            color: '#fff',
          }}
        />
        {error && <div style={{ color: '#f87171', fontSize: '0.75rem' }}>{error}</div>}
        <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
          {platforms === null ? (
            <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
              <Loader2 size={14} className="spin" /> Reading installed providers…
            </div>
          ) : (
            <>
              {listed.map(row)}
              <div style={{ margin: '0.6rem 0 0.2rem', fontSize: '0.66rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-subtle)' }}>
                From your extensions ({discovered.length})
              </div>
              {discovered.length === 0 ? (
                <div style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>
                  {query
                    ? 'Nothing matches that filter.'
                    : 'No installed provider publishes a catalogue yet. Add a repository on the Extensions screen.'}
                </div>
              ) : (
                discovered.map(row)
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
