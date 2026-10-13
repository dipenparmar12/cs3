import { useEffect, useMemo, useState } from 'react';
import type { TorrentResult } from '../types/torrent';
import type { SourceProvenance } from '../utils/sourceExport';

/**
 * The origin chain for every provider in a source list.
 *
 * A `TorrentResult` carries the provider's *name* and nothing about its
 * ancestry — the repository, extension and provider mapping lives in
 * `PluginManager` and only there. So a list that wants to say where each row
 * came from has to ask, and asking per row is thirty IPC calls to read one Map.
 *
 * Resolved once per distinct provider name and cached across re-renders, since
 * the mapping only changes when an extension is installed or removed.
 */
export function useSourceProvenance(sources: TorrentResult[]): {
  provenanceFor: (source: TorrentResult) => SourceProvenance | undefined;
  ready: boolean;
} {
  const [map, setMap] = useState<Record<string, SourceProvenance>>({});

  /** Joined rather than the array itself: a new array each render would refetch. */
  const names = useMemo(() => {
    const distinct = new Set<string>();
    for (const source of sources) {
      const name = source.providerName ?? source.indexerName;
      if (name) distinct.add(name);
    }
    return [...distinct].sort();
  }, [sources]);
  const key = names.join(' ');

  useEffect(() => {
    if (names.length === 0) return;
    let active = true;
    void (async () => {
      const response = await window.cloudstream?.getProviderProvenanceMap?.(names);
      if (active && response?.ok) {
        // Merged rather than replaced: a list that grows as discovery streams in
        // must not lose the chains already resolved for the rows on screen.
        setMap((current) => ({ ...current, ...response.provenance }));
      }
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const provenanceFor = useMemo(
    () => (source: TorrentResult) => {
      const name = source.providerName ?? source.indexerName;
      return name ? map[name] : undefined;
    },
    [map]
  );

  return { provenanceFor, ready: Object.keys(map).length > 0 };
}
