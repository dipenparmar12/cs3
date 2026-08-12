import React, { useState } from 'react';
import type { SearchResponse } from '../types/api';
import { Play, Star, Filter, Layers } from 'lucide-react';

interface SearchViewProps {
  query: string;
  results: SearchResponse[];
  onSelectMedia: (item: SearchResponse) => void;
  isLoading: boolean;
}

export const SearchView: React.FC<SearchViewProps> = ({
  query,
  results,
  onSelectMedia,
  isLoading,
}) => {
  const [activeProviderFilter, setActiveProviderFilter] = useState<string>('All');

  // Compute provider distribution counts for Layer 2 Filter Banners
  const providerCounts = results.reduce<Record<string, number>>((acc, item) => {
    const key = item.apiName || 'Unknown Provider';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  const distinctProviders = Object.keys(providerCounts);

  // Filter visible items based on Layer 2 selection
  const filteredResults = activeProviderFilter === 'All'
    ? results
    : results.filter((item) => item.apiName === activeProviderFilter);

  if (isLoading) {
    return (
      <div style={{ padding: '4rem', textAlign: 'center', color: 'var(--text-muted)' }}>
        <p>Searching providers for "{query}"...</p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Search Header Info */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#fff' }}>
            {query ? `Search Results for "${query}"` : 'Search Media'}
          </h2>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            Found {results.length} titles across {distinctProviders.length} providers
          </p>
        </div>
      </div>

      {/* Layer 2: Post-Search Result Provider Filter Chips / Banners */}
      {results.length > 0 && distinctProviders.length > 1 && (
        <div style={{
          background: 'var(--bg-card)',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--border-color)',
          padding: '0.85rem 1.25rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.65rem'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.78rem', color: 'var(--text-subtle)', fontWeight: 600 }}>
            <Filter size={14} style={{ color: 'var(--accent-light)' }} />
            <span>Layer 2: Filter Results by Provider ({distinctProviders.length} Active)</span>
          </div>

          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button
              onClick={() => setActiveProviderFilter('All')}
              className={`chip ${activeProviderFilter === 'All' ? 'active' : ''}`}
              style={{ fontSize: '0.78rem', padding: '0.35rem 0.85rem' }}
            >
              All Providers ({results.length})
            </button>

            {distinctProviders.map((prov) => {
              const count = providerCounts[prov];
              const isActive = activeProviderFilter === prov;

              return (
                <button
                  key={prov}
                  onClick={() => setActiveProviderFilter(prov)}
                  className={`chip ${isActive ? 'active' : ''}`}
                  style={{ fontSize: '0.78rem', padding: '0.35rem 0.85rem' }}
                >
                  {prov} ({count})
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Media Results Grid */}
      {filteredResults.length === 0 ? (
        <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
          <p>No results found matching your provider filter.</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '1.25rem' }}>
          {filteredResults.map((item, idx) => (
            <div key={idx} className="poster-card" onClick={() => onSelectMedia(item)}>
              <div className="poster-container">
                <img src={item.posterUrl} alt={item.name} loading="lazy" />
                <span className="poster-badge">{item.type || 'Movie'}</span>

                <div className="poster-overlay">
                  <button className="play-button-overlay">
                    <Play size={20} fill="#fff" />
                  </button>
                </div>
              </div>

              <div className="poster-info">
                <h3 className="poster-title">{item.name}</h3>
                <div className="poster-meta">
                  <span>{item.year || 2024}</span>
                  <span style={{ color: 'var(--accent-light)', fontSize: '0.72rem' }}>
                    {item.apiName}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
