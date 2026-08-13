import React, { useEffect, useState } from 'react';
import { Play, Star, Calendar, Info, Loader2 } from 'lucide-react';
import type { LoadResponse, SearchResponse } from '../types/api';
import { LibraryBucketSelector } from './LibraryBucketSelector';

interface ContentHoverCardProps {
  item: SearchResponse;
  alignRight?: boolean;
  onSelectMedia: (item: SearchResponse) => void;
  onPlayDirectly?: (item: SearchResponse) => void;
  onClose: () => void;
}

export const ContentHoverCard: React.FC<ContentHoverCardProps> = ({
  item,
  alignRight = false,
  onSelectMedia,
  onPlayDirectly,
  onClose,
}) => {
  const [details, setDetails] = useState<LoadResponse | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;
    const fetchDetails = async () => {
      if (!window.cloudstream || !item || !item.url) return;
      setLoading(true);
      try {
        const res = await window.cloudstream.loadMedia(item.url);
        if (active && res) setDetails(res);
      } catch {
        // Best-effort fallback
      } finally {
        if (active) setLoading(false);
      }
    };
    fetchDetails();
    return () => {
      active = false;
    };
  }, [item?.url]);

  const poster = details?.posterUrl || item?.posterUrl;
  const title = details?.name || item?.name || 'Untitled';
  const year = details?.year || item?.year;
  const rating = details?.rating;
  const plot = details?.plot;
  const tags = details?.tags || [];
  const type = details?.type || item?.type || 'Movie';
  const quality = item?.quality;

  return (
    <div
      className={`hover-preview-popup${alignRight ? ' hover-preview-popup--right' : ''}`}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        className="hover-preview-popup__banner"
        style={{ backgroundImage: poster ? `url(${poster})` : undefined }}
      >
        <div className="hover-preview-popup__banner-gradient" />
      </div>

      <div className="hover-preview-popup__content">
        <h3 className="hover-preview-popup__title">{title}</h3>

        <div className="hover-preview-popup__meta">
          {year && (
            <span>
              <Calendar size={13} style={{ display: 'inline', marginRight: '3px' }} /> {year}
            </span>
          )}
          {rating != null && (
            <span style={{ color: '#f59e0b', fontWeight: 600 }}>
              <Star size={13} style={{ display: 'inline', marginRight: '3px' }} fill="#f59e0b" />
              {rating.toFixed(1)}
            </span>
          )}
          {quality && <span className="badge badge--muted">{quality}</span>}
          <span className="badge badge--muted">{type}</span>
          {item?.apiName && (
            <span style={{ fontSize: '0.72rem', color: 'var(--accent-light)' }}>{item.apiName}</span>
          )}
        </div>

        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--text-muted)', fontSize: '0.78rem', padding: '0.4rem 0' }}>
            <Loader2 className="spin" size={14} /> Loading info…
          </div>
        ) : (
          plot && <p className="hover-preview-popup__plot">{plot}</p>
        )}

        {tags.length > 0 && (
          <div className="hover-preview-popup__tags">
            {tags.slice(0, 4).map((tag) => (
              <span key={tag} className="badge badge--muted" style={{ fontSize: '0.68rem', padding: '0.15rem 0.4rem' }}>
                {tag}
              </span>
            ))}
          </div>
        )}

        <div className="hover-preview-popup__actions">
          <button
            type="button"
            className="btn btn-primary"
            style={{ padding: '0.35rem 0.75rem', fontSize: '0.78rem', gap: '0.35rem' }}
            onClick={() => {
              onClose();
              if (onPlayDirectly) onPlayDirectly(item);
              else onSelectMedia(item);
            }}
          >
            <Play size={14} fill="#fff" /> Play
          </button>

          <LibraryBucketSelector item={item} size="sm" />

          <button
            type="button"
            className="btn btn-secondary"
            style={{ padding: '0.35rem 0.65rem', fontSize: '0.78rem', gap: '0.3rem' }}
            onClick={() => {
              onClose();
              onSelectMedia(item);
            }}
          >
            <Info size={14} /> Details
          </button>
        </div>
      </div>
    </div>
  );
};
