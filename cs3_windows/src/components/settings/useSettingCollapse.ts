import { useCallback, useState } from 'react';
import { useSettingsQuery } from './SettingsLevelContext';

/**
 * Manages persistent collapse/expand state for a settings section.
 *
 * Rules:
 *  1. Defaults to EXPANDED (false) for optimal readability.
 *  2. Persists user preference across launches via localStorage.
 *  3. Auto-expands unconditionally when a search query is active so matching
 *     nested settings rows are never hidden from the viewer.
 */
export function useSettingCollapse(key: string): [boolean, () => void] {
  const query = useSettingsQuery();
  const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const storageKey = `cs3:settings:collapsed:${normalizedKey}`;

  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(storageKey) === 'true';
    } catch {
      return false;
    }
  });

  const toggle = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        if (next) {
          localStorage.setItem(storageKey, 'true');
        } else {
          localStorage.removeItem(storageKey);
        }
      } catch {
        // Storage access may be restricted; ignore gracefully
      }
      return next;
    });
  }, [storageKey]);

  // When search query is active, force expanded so matching rows are visible
  const isCollapsed = query !== '' ? false : collapsed;
  return [isCollapsed, toggle];
}
