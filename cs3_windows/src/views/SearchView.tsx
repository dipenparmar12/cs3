import React, { useState } from 'react';
import type { SearchResponse } from '../types/api';
import { Filter, Loader2 } from 'lucide-react';
import { PosterCard } from '../components/PosterCard';

interface SearchViewProps {
  query: string;
  results: SearchResponse[];
  onSelectMedia: (item: SearchResponse) => void;
  /** Quick-play from the card, bypassing the detail page. */
  onPlayDirectly?: (item: SearchResponse) => void;
  isLoading: boolean;
  /** Surfaced when the search itself failed, so the user sees a cause not an empty grid. */
  error?: string | null;
}

export const SearchView: React.FC<SearchViewProps> = ({
  query,
  results,
  onSelectMedia,
  onPlayDirectly,
  isLoading,
  error,
}) => {
  const [activeProviderFilter, setActiveProviderFilter] = useState<string>('All');

  const providerCounts = (results || []).reduce<Record<string, number>>((acc, item) => {
    if (!item) return acc;
    const itemProviders = new Set<string>();
    if (item.apiName) itemProviders.add(item.apiName);
    if (Array.isArray(item.alternates)) {
      for (const alt of item.alternates) {
        if (alt?.apiName) itemProviders.add(alt.apiName);
      }
    }
    if (itemProviders.size === 0) itemProviders.add('Unknown Provider');
    for (const prov of itemProviders) {
      acc[prov] = (acc[prov] || 0) + 1;
    }
    return acc;
  }, {});

  const distinctProviders = Object.keys(providerCounts);

  const filteredResults = activeProviderFilter === 'All'
    ? results
    : (results || []).filter((item) => {
        if (!item) return false;
        if (item.apiName === activeProviderFilter) return true;
        return Array.isArray(item.alternates) && item.alternates.some((alt) => alt?.apiName === activeProviderFilter);
      });

  if (isLoading) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '350px',
          gap: '1.25rem',
          color: 'var(--text-muted)',
        }}
      >
        <div
          style={{
            width: '56px',
            height: '56px',
            borderRadius: '50%',
            background: 'var(--bg-card)',
            border: '1px solid var(--border-color)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--accent-light)',
            boxShadow: '0 4px 16px rgba(59, 130, 246, 0.2)',
          }}
        >
          <Loader2 size={28} className="spin" />
        </div>
        <div style={{ textAlign: 'center' }}>
          <h3 style={{ fontSize: '1.1rem', fontWeight: 600, color: '#fff', marginBottom: '0.4rem' }}>
            {query ? `Searching for "${query}"...` : 'Searching media providers...'}
          </h3>
          <p style={{ fontSize: '0.82rem', color: 'var(--text-subtle)', margin: 0 }}>
            Querying active catalogs and indexing metadata sources
          </p>
        </div>
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
            Found {results.length} titles across {distinctProviders.length} catalogue
            {distinctProviders.length === 1 ? '' : 's'}
          </p>
        </div>
      </div>

      {error && (
        <div
          style={{
            padding: '0.85rem 1rem',
            borderRadius: 8,
            background: 'rgba(220, 60, 60, 0.12)',
            border: '1px solid rgba(220, 60, 60, 0.35)',
            color: '#ffb4b4',
            fontSize: '0.85rem',
          }}
          role="alert"
        >
          Search failed: {error}
        </div>
      )}

      {/* Layer 2 Provider Filter Banners */}
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
          {filteredResults.map((item, idx) => {
            if (!item || !item.url) return null;
            return <PosterCard key={`${item.url}-${idx}`} item={item} onSelectMedia={onSelectMedia} onPlayDirectly={onPlayDirectly} />;
          })}
        </div>
      )}
    </div>
  );
};
