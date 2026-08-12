import React from 'react';
import type { SearchResponse } from '../types/api';
import { Search, Star } from 'lucide-react';

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
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div>
        <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#fff' }}>
          {query ? `Search Results for "${query}"` : 'Multi-Provider Search'}
        </h2>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
          {isLoading ? 'Querying community provider repositories...' : `Found ${results.length} results across active providers`}
        </p>
      </div>

      {isLoading ? (
        <div style={{ padding: '4rem', textAlign: 'center', color: 'var(--text-muted)' }}>
          <p>Searching providers...</p>
        </div>
      ) : results.length === 0 ? (
        <div style={{
          padding: '4rem 2rem',
          textAlign: 'center',
          background: 'var(--bg-card)',
          borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--border-color)',
          color: 'var(--text-muted)'
        }}>
          <Search size={32} style={{ marginBottom: '1rem', color: 'var(--text-subtle)' }} />
          <p style={{ fontSize: '0.95rem' }}>No results found for "{query}". Try a different keyword or active provider.</p>
        </div>
      ) : (
        <div className="poster-grid">
          {results.map((item, idx) => (
            <div key={idx} onClick={() => onSelectMedia(item)} className="poster-card">
              <div className="poster-image-container">
                <img src={item.posterUrl} alt={item.name} className="poster-image" />
                <span className="poster-badge">{item.type || 'Media'}</span>
                {item.quality && <span className="poster-quality">{item.quality}</span>}
              </div>
              <div className="poster-info">
                <h4 className="poster-title">{item.name}</h4>
                <div className="poster-meta">
                  <span>{item.year || '2024'}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '2px', color: '#f59e0b' }}>
                    <Star size={12} fill="#f59e0b" />
                    <span>8.8</span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
