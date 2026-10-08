import React from 'react';
import { Dialog } from '../ui';

/**
 * "View all" for a detail-page rail — cast, trailers, a franchise, related
 * titles — as a grid in a dialog over the page.
 *
 * A dialog rather than a route: the viewer is reading this title, and the
 * collection is part of it. Closing returns to the page exactly as it was;
 * choosing an item closes the dialog and opens the item, the same as the rail.
 */
export const CollectionDialog: React.FC<{
  title: string;
  count?: number;
  icon?: React.ReactNode;
  onClose: () => void;
  /** `posters` lays out 2:3 cards; `wide` lays out 16:9 video cards; `people` round portraits. */
  layout?: 'posters' | 'wide' | 'people';
  children: React.ReactNode;
}> = ({ title, count, icon, onClose, layout = 'posters', children }) => (
  <Dialog
    size="xl"
    icon={icon}
    title={count !== undefined ? `${title} · ${count}` : title}
    onClose={onClose}
    className="collection-dialog"
  >
    <div className={`collection-dialog__grid collection-dialog__grid--${layout}`}>{children}</div>
  </Dialog>
);
