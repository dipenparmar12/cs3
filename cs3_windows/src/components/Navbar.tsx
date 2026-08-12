import React, { useState } from 'react';
import { Search, Bug, Check, ChevronDown, Filter } from 'lucide-react';

interface NavbarProps {
  onSearch: (query: string, selectedProviders?: string[]) => void;
  onOpenInspector: () => void;
  providers: string[];
  selectedProvider: string;
  setSelectedProvider: (provider: string) => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  onSearch,
  onOpenInspector,
  providers,
}) => {
  const [query, setQuery] = useState('');
  const [selectedProviders, setSelectedProviders] = useState<string[]>(['All']);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && query.trim()) {
      onSearch(query.trim(), selectedProviders);
    }
  };

  const handleToggleProvider = (p: string) => {
    if (p === 'All') {
      setSelectedProviders(['All']);
      return;
    }

    let updated = selectedProviders.filter((item) => item !== 'All');
    if (updated.includes(p)) {
      updated = updated.filter((item) => item !== p);
    } else {
      updated.push(p);
    }

    if (updated.length === 0) {
      updated = ['All'];
    }

    setSelectedProviders(updated);
  };

  const getDisplayText = (): string => {
    if (selectedProviders.includes('All') || selectedProviders.length === 0) {
      return 'All Providers';
    }
    if (selectedProviders.length === 1) {
      return selectedProviders[0];
    }
    return `${selectedProviders.length} Providers Selected`;
  };

  return (
    <header className="navbar">
      {/* Search Input Bar */}
      <div className="search-bar">
        <Search size={18} className="search-icon" />
        <input
          type="text"
          className="search-input"
          placeholder="Search movies, anime, TV shows across providers or paste URL..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <button
          onClick={() => query.trim() && onSearch(query.trim(), selectedProviders)}
          className="btn btn-primary"
          style={{ padding: '0.35rem 0.85rem', fontSize: '0.8rem' }}
        >
          Search
        </button>
      </div>

      {/* Right Controls: Layer 1 Multi-Select Provider Dropdown & Inspector */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', position: 'relative' }}>
        {/* Multi-Select Provider Selector Trigger Pill */}
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => setIsDropdownOpen((prev) => !prev)}
            className="btn btn-secondary"
            style={{
              padding: '0.4rem 0.85rem',
              fontSize: '0.8rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              borderColor: selectedProviders.includes('All') ? 'var(--border-color)' : 'var(--accent-primary)'
            }}
          >
            <Filter size={14} style={{ color: 'var(--accent-light)' }} />
            <span>{getDisplayText()}</span>
            <ChevronDown size={14} />
          </button>

          {/* Layer 1 Multi-Select Dropdown Menu */}
          {isDropdownOpen && (
            <div style={{
              position: 'absolute',
              top: 'calc(100% + 6px)',
              right: 0,
              width: '260px',
              maxHeight: '320px',
              backgroundColor: 'var(--bg-card)',
              border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-md)',
              boxShadow: '0 10px 30px rgba(0,0,0,0.6)',
              zIndex: 9999,
              padding: '0.75rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.5rem',
              overflowY: 'auto'
            }}>
              <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-subtle)', textTransform: 'uppercase' }}>
                Search Scope (Layer 1)
              </div>

              {/* All Providers Option */}
              <button
                onClick={() => handleToggleProvider('All')}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '0.45rem 0.65rem',
                  borderRadius: 'var(--radius-sm)',
                  backgroundColor: selectedProviders.includes('All') ? 'var(--bg-card-hover)' : 'transparent',
                  color: selectedProviders.includes('All') ? '#fff' : 'var(--text-main)',
                  border: 'none',
                  fontSize: '0.82rem',
                  cursor: 'pointer',
                  textAlign: 'left'
                }}
              >
                <span>All Providers</span>
                {selectedProviders.includes('All') && <Check size={14} style={{ color: 'var(--accent-light)' }} />}
              </button>

              <div style={{ height: '1px', backgroundColor: 'var(--border-color)', margin: '0.25rem 0' }} />

              {/* Individual Active Provider Options */}
              {providers.map((p) => {
                const isChecked = selectedProviders.includes(p);
                return (
                  <button
                    key={p}
                    onClick={() => handleToggleProvider(p)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '0.45rem 0.65rem',
                      borderRadius: 'var(--radius-sm)',
                      backgroundColor: isChecked ? 'var(--bg-card-hover)' : 'transparent',
                      color: isChecked ? '#fff' : 'var(--text-main)',
                      border: 'none',
                      fontSize: '0.82rem',
                      cursor: 'pointer',
                      textAlign: 'left'
                    }}
                  >
                    <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '180px' }}>{p}</span>
                    {isChecked && <Check size={14} style={{ color: 'var(--accent-light)' }} />}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* F12 Provider Inspector Button */}
        <button
          onClick={onOpenInspector}
          className="btn btn-secondary btn-icon"
          title="F12 - Open Provider Inspector & Debugger"
        >
          <Bug size={16} />
        </button>
      </div>
    </header>
  );
};
