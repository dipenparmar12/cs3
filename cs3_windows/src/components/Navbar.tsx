import React, { useState } from 'react';
import { Search, Bug, Layers } from 'lucide-react';

interface NavbarProps {
  onSearch: (query: string) => void;
  onOpenInspector: () => void;
  providers: string[];
  selectedProvider: string;
  setSelectedProvider: (provider: string) => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  onSearch,
  onOpenInspector,
  providers,
  selectedProvider,
  setSelectedProvider,
}) => {
  const [searchInput, setSearchInput] = useState('');

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      onSearch(searchInput);
    }
  };

  return (
    <header style={{
      height: '64px',
      borderBottom: '1px solid var(--border-color)',
      backgroundColor: 'var(--bg-sidebar)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 2rem',
      gap: '1.5rem'
    }}>
      {/* Search Input Bar */}
      <div style={{
        position: 'relative',
        flex: 1,
        maxWidth: '520px'
      }}>
        <Search size={18} style={{
          position: 'absolute',
          left: '12px',
          top: '50%',
          transform: 'translateY(-50%)',
          color: 'var(--text-subtle)'
        }} />
        <input
          type="text"
          placeholder="Search titles, anime, movies or paste URL..."
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          onKeyDown={handleKeyDown}
          style={{
            width: '100%',
            padding: '0.55rem 1rem 0.55rem 2.5rem',
            backgroundColor: 'var(--bg-input)',
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-md)',
            color: 'var(--text-main)',
            fontSize: '0.875rem',
            outline: 'none',
            transition: 'var(--transition)'
          }}
        />
      </div>

      {/* Right Tools */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
        {/* Provider Selector Dropdown */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Layers size={16} style={{ color: 'var(--text-muted)' }} />
          <select
            value={selectedProvider}
            onChange={(e) => setSelectedProvider(e.target.value)}
            style={{
              backgroundColor: 'var(--bg-card)',
              border: '1px solid var(--border-color)',
              color: 'var(--text-main)',
              padding: '0.45rem 0.75rem',
              borderRadius: 'var(--radius-md)',
              fontSize: '0.82rem',
              outline: 'none',
              cursor: 'pointer'
            }}
          >
            <option value="All">All Providers</option>
            {providers.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </div>

        {/* F12 Provider Inspector Button */}
        <button
          onClick={onOpenInspector}
          className="btn btn-secondary"
          title="Open Provider Inspector (F12)"
          style={{ fontSize: '0.8rem', padding: '0.45rem 0.85rem' }}
        >
          <Bug size={16} style={{ color: 'var(--accent-light)' }} />
          <span>Inspector (F12)</span>
        </button>
      </div>
    </header>
  );
};
