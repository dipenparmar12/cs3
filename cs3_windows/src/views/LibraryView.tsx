import React, { useState } from 'react';
import { TvType } from '../types/api';
import type { SearchResponse } from '../types/api';

interface LibraryViewProps {
  onSelectMedia: (item: SearchResponse) => void;
}

export const LibraryView: React.FC<LibraryViewProps> = ({ onSelectMedia }) => {
  const [activeCategory, setActiveCategory] = useState<string>('Watching');

  const libraryItems: SearchResponse[] = [
    {
      name: 'Cyberpunk: Edgerunners',
      url: 'https://example.com/anime/cyberpunk-edgerunners',
      apiName: 'CloudStream Builtin',
      type: TvType.Anime,
      posterUrl: 'https://images.unsplash.com/photo-1578632767115-351597cf2477?w=500&q=80',
      year: 2022,
      quality: '1080p'
    },
    {
      name: 'Interstellar',
      url: 'https://example.com/movie/interstellar',
      apiName: 'CloudStream Builtin',
      type: TvType.Movie,
      posterUrl: 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=500&q=80',
      year: 2014,
      quality: '4K'
    }
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div>
        <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#fff' }}>Library & Watchlists</h2>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
          Your saved bookmarks, watch progress, and synced titles
        </p>
      </div>

      <div style={{ display: 'flex', gap: '0.5rem' }}>
        {['Watching', 'Completed', 'On Hold', 'Plan to Watch', 'Dropped'].map((cat) => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
            className={`chip ${activeCategory === cat ? 'active' : ''}`}
          >
            {cat}
          </button>
        ))}
      </div>

      <div className="poster-grid">
        {libraryItems.map((item, idx) => (
          <div key={idx} onClick={() => onSelectMedia(item)} className="poster-card">
            <div className="poster-image-container">
              <img src={item.posterUrl} alt={item.name} className="poster-image" />
              <span className="poster-badge">{item.type}</span>
            </div>
            <div className="poster-info">
              <h4 className="poster-title">{item.name}</h4>
              <div className="poster-meta">
                <span>{item.year}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
