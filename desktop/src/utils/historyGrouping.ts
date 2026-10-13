import type {
  GroupedHistoryItem,
  HistoryEvent,
} from '../types/history.ts';
import { formatHistorySize, formatRuntime } from './format.ts';

/**
 * Derives a consistent group identity key for grouping media events.
 */
export function deriveGroupKey(event: HistoryEvent): string {
  if (event.mediaKey && event.mediaKey.trim()) {
    return event.mediaKey.trim();
  }

  // Fallback: title normalized + year
  const normalizedTitle = (event.title || 'untitled')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, '-');

  return event.year ? `${normalizedTitle}:${event.year}` : normalizedTitle;
}

/**
 * Groups an array of raw chronological history events into consolidated media items.
 */
export function groupHistoryEvents(
  events: HistoryEvent[],
  sortBy: 'recent' | 'oldest' | 'played' | 'failed' | 'downloaded' = 'recent'
): GroupedHistoryItem[] {
  const map = new Map<string, HistoryEvent[]>();

  for (const event of events) {
    const key = deriveGroupKey(event);
    const existing = map.get(key);
    if (existing) {
      existing.push(event);
    } else {
      map.set(key, [event]);
    }
  }

  const grouped: GroupedHistoryItem[] = [];

  for (const [groupKey, groupEvents] of map.entries()) {
    // Sort events within the group newest first
    groupEvents.sort((a, b) => b.timestamp - a.timestamp);
    const latest = groupEvents[0];

    const distinctActions = Array.from(new Set(groupEvents.map((e) => e.action)));
    const distinctStatuses = Array.from(new Set(groupEvents.map((e) => e.status)));

    const hasPlayed = groupEvents.some(
      (e) =>
        e.status === 'Played' ||
        e.action === 'playback_started' ||
        e.action === 'playback_completed' ||
        e.action === 'playback_stopped'
    );
    const hasDownloaded = groupEvents.some(
      (e) =>
        e.status === 'Downloaded' ||
        e.action === 'download_started' ||
        e.action === 'download_completed'
    );
    const hasFailed = groupEvents.some(
      (e) =>
        e.status === 'Failed' ||
        e.status === 'Download Failed' ||
        e.action === 'playback_failed' ||
        e.action === 'download_failed'
    );
    const hasAttempted = groupEvents.some(
      (e) => e.status === 'Attempted' || e.action === 'source_selected' || e.action === 'playback_attempt'
    );

    const totalDurationSeconds = groupEvents.reduce(
      (sum, e) => sum + (e.durationSeconds || 0),
      0
    );

    grouped.push({
      id: latest.id,
      groupKey,
      mediaKey: latest.mediaKey || groupKey,
      title: latest.title,
      originalTitle: latest.originalTitle,
      year: latest.year,
      type: latest.type,
      posterUrl: latest.posterUrl || groupEvents.find((e) => e.posterUrl)?.posterUrl,
      backdropUrl: latest.backdropUrl || groupEvents.find((e) => e.backdropUrl)?.backdropUrl,
      mediaUrl: latest.mediaUrl,
      visitCount: groupEvents.length,
      latestEvent: latest,
      events: groupEvents,
      distinctActions,
      distinctStatuses,
      hasPlayed,
      hasDownloaded,
      hasFailed,
      hasAttempted,
      season: latest.season,
      episode: latest.episode,
      episodeTitle: latest.episodeTitle,
      latestTimestamp: latest.timestamp,
      totalDurationSeconds: totalDurationSeconds > 0 ? totalDurationSeconds : undefined,
    });
  }

  // Sort grouped list according to sortBy
  if (sortBy === 'recent') {
    grouped.sort((a, b) => b.latestTimestamp - a.latestTimestamp);
  } else if (sortBy === 'oldest') {
    grouped.sort((a, b) => a.latestTimestamp - b.latestTimestamp);
  } else if (sortBy === 'played') {
    grouped.sort((a, b) => {
      if (a.hasPlayed && !b.hasPlayed) return -1;
      if (!a.hasPlayed && b.hasPlayed) return 1;
      return b.latestTimestamp - a.latestTimestamp;
    });
  } else if (sortBy === 'failed') {
    grouped.sort((a, b) => {
      if (a.hasFailed && !b.hasFailed) return -1;
      if (!a.hasFailed && b.hasFailed) return 1;
      return b.latestTimestamp - a.latestTimestamp;
    });
  } else if (sortBy === 'downloaded') {
    grouped.sort((a, b) => {
      if (a.hasDownloaded && !b.hasDownloaded) return -1;
      if (!a.hasDownloaded && b.hasDownloaded) return 1;
      return b.latestTimestamp - a.latestTimestamp;
    });
  }

  return grouped;
}

export interface ActionAccent {
  key: string;
  label: string;
  count?: number;
  bg: string;
  text: string;
  border: string;
}

/**
 * Returns distinct colored action accent tags for a grouped history item.
 */
export function getActionAccents(item: GroupedHistoryItem): ActionAccent[] {
  const accents: ActionAccent[] = [];

  const playedCount = item.events.filter(
    (e) => e.status === 'Played' || e.action === 'playback_started' || e.action === 'playback_completed'
  ).length;

  const downloadCount = item.events.filter(
    (e) => e.status === 'Downloaded' || e.action === 'download_started' || e.action === 'download_completed'
  ).length;

  const failedCount = item.events.filter(
    (e) => e.status === 'Failed' || e.status === 'Download Failed' || e.action === 'playback_failed' || e.action === 'download_failed'
  ).length;

  const refreshCount = item.events.filter(
    (e) => e.action === 'source_selected' || e.status === 'Attempted'
  ).length;

  if (playedCount > 0) {
    accents.push({
      key: 'played',
      label: 'Streamed',
      count: playedCount > 1 ? playedCount : undefined,
      bg: 'rgba(16, 185, 129, 0.14)',
      text: '#34d399',
      border: 'rgba(16, 185, 129, 0.35)',
    });
  }

  if (downloadCount > 0) {
    accents.push({
      key: 'downloaded',
      label: 'Downloaded',
      count: downloadCount > 1 ? downloadCount : undefined,
      bg: 'rgba(59, 130, 246, 0.14)',
      text: '#60a5fa',
      border: 'rgba(59, 130, 246, 0.35)',
    });
  }

  if (failedCount > 0) {
    accents.push({
      key: 'failed',
      label: 'Failed',
      count: failedCount > 1 ? failedCount : undefined,
      bg: 'rgba(244, 63, 94, 0.14)',
      text: '#fb7185',
      border: 'rgba(244, 63, 94, 0.35)',
    });
  }

  if (refreshCount > 0 && playedCount === 0 && downloadCount === 0 && failedCount === 0) {
    accents.push({
      key: 'refreshed',
      label: 'Refreshed',
      count: refreshCount > 1 ? refreshCount : undefined,
      bg: 'rgba(245, 158, 11, 0.14)',
      text: '#fbbf24',
      border: 'rgba(245, 158, 11, 0.35)',
    });
  }

  return accents;
}

/**
 * Returns human-readable description text for a specific history event action.
 */
export function formatEventActionText(event: HistoryEvent): string {
  const provider = event.source?.providerName || event.source?.indexerName;
  const quality = event.source?.quality || (event.source?.resolution ? `${event.source.resolution}p` : undefined);
  const size = event.source?.sizeBytes ? formatHistorySize(event.source.sizeBytes) : undefined;

  if (event.status === 'Played') {
    const parts = [
      'Streamed',
      quality,
      provider ? `via ${provider}` : undefined,
      event.durationSeconds ? `(${formatRuntime(event.durationSeconds)})` : undefined,
    ].filter(Boolean);
    return parts.join(' ');
  }

  if (event.status === 'Downloaded') {
    const parts = [
      'Downloaded',
      quality,
      provider ? `via ${provider}` : undefined,
      size ? `(${size})` : undefined,
    ].filter(Boolean);
    return parts.join(' ');
  }

  if (event.status === 'Failed') {
    return event.failureReason ? `Playback failed: ${event.failureReason}` : 'Playback failed';
  }

  if (event.status === 'Download Failed') {
    return event.failureReason ? `Download failed: ${event.failureReason}` : 'Download failed';
  }

  if (event.action === 'source_selected' || event.status === 'Attempted') {
    const count = event.sourcesDiscovered?.length;
    if (count !== undefined && count > 0) {
      return `Refreshed sources (${count} stream${count === 1 ? '' : 's'} discovered)`;
    }
    return provider ? `Source query via ${provider}` : 'Attempted source discovery';
  }

  if (event.action === 'detail_opened') {
    return 'Viewed media details & seasons';
  }

  return event.status;
}
