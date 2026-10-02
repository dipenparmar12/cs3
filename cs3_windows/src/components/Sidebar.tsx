import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Home,
  Search,
  Film,
  History,
  Download,
  Loader2,
  Pin,
  PinOff,
  Plus,
  Puzzle,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
} from 'lucide-react';
import { useExtensionJobs } from './extensions/useExtensionJobs';
import { StreamingServicePicker } from './StreamingServicePicker';

/**
 * The `ott:` arm is a template literal rather than a fixed union because the
 * platform table is data. Adding ZEE5 to `cs3/ottPlatforms.ts` should add a
 * sidebar entry and a route, not require a second edit here that someone will
 * forget — which is how a platform ends up listed and unreachable.
 */
export type ActiveTab =
  | 'home'
  | 'search'
  | 'library'
  | 'history'
  | 'downloads'
  | 'extensions'
  | 'settings'
  | `ott:${string}`;

/** What the sidebar needs to draw one streaming-service row. */
export interface SidebarOttPlatform {
  id: string;
  name: string;
  accent: string;
  availability: 'ready' | 'disabled' | 'missing';
  /** Declared adult (NSFW) by its provider — shown with an 18+ flag. */
  adult?: boolean;
  /** Pinned by the viewer; the list arrives with pinned rows first, in order. */
  pinned?: boolean;
  /** Mostly general content with some 18+ rows — badged, but no age warning. */
  mixedAdult?: boolean;
}

/**
 * The 18+ flag on a service row: sensitive content is disclosed before it is
 * opened. Outlined for a service that is general content with some 18+ rows.
 */
const AdultFlag: React.FC<{ partial?: boolean }> = ({ partial }) =>
  partial ? (
    <span
      className="adult-badge adult-badge--partial"
      title="Has some adult (18+) rows — hidden while adult content is off, otherwise shown after you confirm your age"
    >
      18+
    </span>
  ) : (
    <span className="adult-badge" title="Adult content (18+) — you will be asked to confirm your age">
      18+
    </span>
  );

interface SidebarProps {
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;
  downloadCount: number;
  missingComponentCount?: number;
  /** Whether search results are currently active on screen. */
  hasSearchResults?: boolean;
  /** Clears active search results from screen. */
  onClearResults?: () => void;
  /**
   * The streaming services, newest inventory first.
   *
   * Passed in rather than fetched here so the list refreshes when an install
   * changes it — the sidebar is mounted for the life of the app and would
   * otherwise show the state it saw at launch forever.
   */
  ottPlatforms?: SidebarOttPlatform[];
  /** Re-reads the list after the service picker changes it. */
  onOttPlatformsChanged?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  setActiveTab,
  downloadCount,
  missingComponentCount = 0,
  hasSearchResults = false,
  onClearResults,
  ottPlatforms = [],
  onOttPlatformsChanged,
}) => {
  /**
   * Services with nothing installed are collapsed behind a disclosure.
   *
   * All seven are always *listed* somewhere — a user looking for Sony LIV has
   * to be able to find out it is reachable — but showing four dead rows above
   * the fold on a fresh install makes the sidebar read as mostly broken. The
   * ones that work sit at the top; the rest are one click away and say what
   * they need.
   */
  const [showUnavailable, setShowUnavailable] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const available = ottPlatforms.filter((p) => p.availability !== 'missing');
  const unavailable = ottPlatforms.filter((p) => p.availability === 'missing');

  /*
   * Find a service by typing. Matches the sidebar's own rows first, then every
   * other enabled service the extensions provide (read when the box opens),
   * which can be added and opened in one click.
   */
  const [searchOpen, setSearchOpen] = useState(false);
  const [serviceQuery, setServiceQuery] = useState('');
  const [allPlatforms, setAllPlatforms] = useState<SidebarOttPlatform[] | null>(null);
  useEffect(() => {
    if (!searchOpen) return;
    let live = true;
    setAllPlatforms(null);
    void window.cloudstream?.listAllOttPlatforms().then((response) => {
      if (live) setAllPlatforms((response?.platforms ?? []) as SidebarOttPlatform[]);
    });
    return () => {
      live = false;
    };
  }, [searchOpen]);

  const queryWords = serviceQuery.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const searching = searchOpen && queryWords.length > 0;
  const matchesService = (name: string) => {
    const folded = name.toLowerCase().replace(/[^a-z0-9]+/g, ' ');
    const compact = folded.replace(/ /g, '');
    // "net" finds Netflix; "primev" finds Prime Video; "disney plus" finds Disney+.
    return queryWords.every((q) => folded.split(' ').some((w) => w.startsWith(q)) || compact.includes(q));
  };
  const shownMatches = searching ? ottPlatforms.filter((p) => matchesService(p.name)) : [];
  const shownIds = new Set(ottPlatforms.map((p) => p.id));
  const extraMatches = searching
    ? (allPlatforms ?? []).filter(
        (p) => !shownIds.has(p.id) && p.availability !== 'missing' && matchesService(p.name)
      )
    : [];

  /*
   * Pinning. The main process owns the order and sends the list pinned-first;
   * `localPinned` only holds a change until that list comes back, so a drag
   * lands where it was dropped instead of snapping back for a moment.
   */
  const serverPinned = ottPlatforms.filter((p) => p.pinned).map((p) => p.id);
  const [localPinned, setLocalPinned] = useState<string[] | null>(null);
  const serverPinnedKey = serverPinned.join('|');
  useEffect(() => setLocalPinned(null), [serverPinnedKey]);
  const pinnedIds = localPinned ?? serverPinned;
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const navRef = useRef<HTMLElement | null>(null);
  const scrollIntervalRef = useRef<number | null>(null);

  const stopAutoScroll = useCallback(() => {
    if (scrollIntervalRef.current !== null) {
      window.clearInterval(scrollIntervalRef.current);
      scrollIntervalRef.current = null;
    }
  }, []);

  const handleNavDragOver = useCallback((e: React.DragEvent) => {
    if (!dragging || !navRef.current) return;
    const nav = navRef.current;
    const rect = nav.getBoundingClientRect();
    const mouseY = e.clientY;
    const threshold = 40;
    const topZone = rect.top + threshold;
    const bottomZone = rect.bottom - threshold;

    if (mouseY < topZone) {
      const speed = Math.max(3, Math.min(15, (topZone - mouseY) / 2));
      if (!scrollIntervalRef.current) {
        scrollIntervalRef.current = window.setInterval(() => {
          if (navRef.current) {
            navRef.current.scrollTop -= speed;
          }
        }, 16);
      }
    } else if (mouseY > bottomZone) {
      const speed = Math.max(3, Math.min(15, (mouseY - bottomZone) / 2));
      if (!scrollIntervalRef.current) {
        scrollIntervalRef.current = window.setInterval(() => {
          if (navRef.current) {
            navRef.current.scrollTop += speed;
          }
        }, 16);
      }
    } else {
      stopAutoScroll();
    }
  }, [dragging, stopAutoScroll]);

  useEffect(() => {
    return () => stopAutoScroll();
  }, [stopAutoScroll]);

  const savePinned = async (next: string[]) => {
    setLocalPinned(next);
    const response = await window.cloudstream?.setOttPinnedPlatforms(next);
    if (!response?.ok) setLocalPinned(null);
    onOttPlatformsChanged?.();
  };
  const togglePin = (platformId: string) =>
    void savePinned(
      pinnedIds.includes(platformId)
        ? pinnedIds.filter((pid) => pid !== platformId)
        : [...pinnedIds, platformId]
    );
  /** Drops `from` into `to`'s place among the pinned rows. */
  const movePinned = (from: string, to: string) => {
    if (from === to || !pinnedIds.includes(from) || !pinnedIds.includes(to)) return;
    const next = pinnedIds.filter((pid) => pid !== from);
    const target = next.indexOf(to);
    const fromIndex = pinnedIds.indexOf(from);
    const toIndex = pinnedIds.indexOf(to);
    // Dragging down lands after the target, dragging up lands before it.
    next.splice(fromIndex < toIndex ? target + 1 : target, 0, from);
    void savePinned(next);
  };

  const byId = new Map(ottPlatforms.map((p) => [p.id, p]));
  const pinnedRows = pinnedIds
    .map((pid) => byId.get(pid))
    .filter((p): p is SidebarOttPlatform => Boolean(p));
  const orderedRows = [
    ...pinnedRows,
    ...available.filter((p) => !pinnedIds.includes(p.id)),
    ...(showUnavailable ? unavailable.filter((p) => !pinnedIds.includes(p.id)) : []),
  ];

  const openService = async (platform: SidebarOttPlatform) => {
    if (!shownIds.has(platform.id)) {
      await window.cloudstream?.setOttPlatformEnabled(platform.id, true);
      onOttPlatformsChanged?.();
    }
    setActiveTab(`ott:${platform.id}`);
    setSearchOpen(false);
    setServiceQuery('');
  };
  const { snapshot: extensionJobs } = useExtensionJobs();

  // Opening a service that is not installed should not then hide the row that
  // is currently selected.
  useEffect(() => {
    if (activeTab.startsWith('ott:') && unavailable.some((p) => `ott:${p.id}` === activeTab)) {
      setShowUnavailable(true);
    }
  }, [activeTab, unavailable]);

  const navItems = [
    { id: 'home' as ActiveTab, label: 'Home', icon: Home },
    { id: 'search' as ActiveTab, label: 'Search', icon: Search },
    { id: 'library' as ActiveTab, label: 'Library', icon: Film },
    { id: 'history' as ActiveTab, label: 'History', icon: History },
    { id: 'downloads' as ActiveTab, label: 'Downloads', icon: Download, badge: downloadCount },
    {
      id: 'extensions' as ActiveTab,
      label: 'Extensions',
      icon: Puzzle,
      // Installs keep going when the viewer leaves the screen, so the one
      // place that is always visible says so.
      activity: extensionJobs.running + extensionJobs.queued,
    },
    {
      id: 'settings' as ActiveTab,
      label: 'Settings',
      icon: Settings,
      warnBadge: missingComponentCount > 0 ? `${missingComponentCount}` : undefined,
    },
  ];

  return (
    <aside style={{
      width: '240px',
      backgroundColor: 'var(--bg-sidebar)',
      borderRight: '1px solid var(--border-color)',
      display: 'flex',
      flexDirection: 'column',
      padding: '1.25rem 1rem',
      gap: '2rem'
    }}>
      {/* Brand Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', paddingLeft: '0.5rem' }}>
        <div style={{
          width: '38px',
          height: '38px',
          borderRadius: '10px',
          background: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#fff',
          boxShadow: '0 4px 12px rgba(59, 130, 246, 0.4)'
        }}>
          <Film size={22} />
        </div>
        <div>
          <h1 style={{ fontSize: '1.05rem', fontWeight: 700, letterSpacing: '-0.02em', color: '#fff' }}>
            CloudStream
          </h1>
          <span style={{ fontSize: '0.68rem', color: 'var(--text-subtle)', fontWeight: 600 }}>
            DESKTOP V1.0
          </span>
        </div>
      </div>

      {/* Nav List */}
      <nav
        ref={navRef}
        onDragOver={handleNavDragOver}
        style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', flex: 1, minHeight: 0, overflowY: 'auto' }}
      >
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '0.7rem 0.9rem',
                borderRadius: 'var(--radius-md)',
                backgroundColor: isActive ? 'var(--bg-card-hover)' : 'transparent',
                color: isActive ? '#fff' : 'var(--text-muted)',
                border: '1px solid',
                borderColor: isActive ? 'rgba(59, 130, 246, 0.3)' : 'transparent',
                fontWeight: isActive ? 600 : 500,
                fontSize: '0.875rem',
                cursor: 'pointer',
                transition: 'var(--transition)'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', minWidth: 0 }}>
                <Icon size={18} style={{ color: isActive ? 'var(--accent-light)' : 'inherit', flexShrink: 0 }} />
                <span>{item.label}</span>
              </div>
              {item.id === 'search' && hasSearchResults && onClearResults && (
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => {
                    e.stopPropagation();
                    onClearResults();
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.stopPropagation();
                      e.preventDefault();
                      onClearResults();
                    }
                  }}
                  title="Clear search results"
                  aria-label="Clear search results"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '3px 5px',
                    borderRadius: 'var(--radius-sm)',
                    color: 'var(--text-subtle)',
                    cursor: 'pointer',
                    transition: 'color 0.15s ease, background 0.15s ease',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.color = '#ef4444';
                    e.currentTarget.style.background = 'rgba(239, 68, 68, 0.12)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color = 'var(--text-subtle)';
                    e.currentTarget.style.background = 'transparent';
                  }}
                >
                  <Trash2 size={13} />
                </span>
              )}
              {item.badge !== undefined && item.badge > 0 && (
                <span style={{
                  background: 'var(--accent-primary)',
                  color: '#fff',
                  fontSize: '0.7rem',
                  fontWeight: 700,
                  padding: '2px 7px',
                  borderRadius: 'var(--radius-full)'
                }}>
                  {item.badge}
                </span>
              )}
              {item.activity !== undefined && item.activity > 0 && (
                <span
                  title={`${item.activity} extension task${item.activity === 1 ? '' : 's'} running or waiting`}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.25rem',
                    color: 'var(--accent-light)',
                    fontSize: '0.7rem',
                    fontWeight: 700,
                  }}
                >
                  <Loader2 size={12} className="spin" /> {item.activity}
                </span>
              )}
              {item.warnBadge && (
                <span style={{
                  background: 'rgba(245, 158, 11, 0.2)',
                  color: '#f59e0b',
                  border: '1px solid rgba(245, 158, 11, 0.4)',
                  fontSize: '0.68rem',
                  fontWeight: 700,
                  padding: '1px 6px',
                  borderRadius: 'var(--radius-full)'
                }} title={`${item.warnBadge} component(s) need setup`}>
                  {item.warnBadge}
                </span>
              )}
            </button>
          );
        })}

        {ottPlatforms.length > 0 && (
          <>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              margin: '1.1rem 0 0.35rem',
              paddingLeft: '0.9rem',
              fontSize: '0.66rem',
              fontWeight: 700,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: 'var(--text-subtle)',
            }}>
              <button
                onClick={() => {
                  setSearchOpen((open) => !open);
                  setServiceQuery('');
                }}
                title="Find a streaming service"
                aria-label="Find a streaming service"
                aria-expanded={searchOpen}
                style={{
                  background: 'none',
                  border: 'none',
                  color: searchOpen ? 'var(--accent-light)' : 'var(--text-subtle)',
                  cursor: 'pointer',
                  padding: 0,
                  display: 'inline-flex',
                }}
              >
                <Search size={13} />
              </button>
              <span style={{ flex: 1 }}>Streaming services</span>
              {onOttPlatformsChanged && (
                <button
                  onClick={() => setPickerOpen(true)}
                  title="Choose which services appear here"
                  aria-label="Choose streaming services"
                  style={{ background: 'none', border: 'none', color: 'var(--text-subtle)', cursor: 'pointer', padding: '0 0.4rem' }}
                >
                  <SlidersHorizontal size={13} />
                </button>
              )}
            </div>

            {searchOpen && (
              <input
                autoFocus
                value={serviceQuery}
                onChange={(event) => setServiceQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.stopPropagation();
                    setSearchOpen(false);
                    setServiceQuery('');
                  } else if (event.key === 'Enter') {
                    const first = shownMatches[0] ?? extraMatches[0];
                    if (first) void openService(first);
                  }
                }}
                placeholder="Type to find… e.g. net"
                aria-label="Find a streaming service"
                style={{
                  margin: '0 0.4rem 0.35rem',
                  padding: '0.4rem 0.6rem',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border-color)',
                  background: 'var(--bg-card)',
                  color: '#fff',
                  fontSize: '0.8rem',
                }}
              />
            )}

            {(searching ? shownMatches : orderedRows).map((platform, index, list) => {
              const id: ActiveTab = `ott:${platform.id}`;
              const isActive = activeTab === id;
              const isPinned = pinnedIds.includes(platform.id);
              // A hairline under the last pinned row — the only mark the pinned
              // group gets, so the list stays as plain as it was.
              const lastPinned = isPinned && !pinnedIds.includes(list[index + 1]?.id ?? '');
              return (
                <div
                  key={platform.id}
                  className={[
                    'ott-side-row',
                    dropTarget === platform.id ? 'ott-side-row--drop' : '',
                    lastPinned && !searching ? 'ott-side-row--last-pinned' : '',
                    dragging === platform.id ? 'ott-side-row--dragging' : '',
                  ].join(' ')}
                  // Only pinned rows reorder, and only among themselves.
                  draggable={isPinned && !searching}
                  onDragStart={(event) => {
                    event.stopPropagation();
                    event.dataTransfer.setData('application/x-ott-platform', platform.id);
                    event.dataTransfer.effectAllowed = 'move';
                    setDragging(platform.id);
                  }}
                  onDragOver={(event) => {
                    if (!dragging || !isPinned || dragging === platform.id) return;
                    event.preventDefault();
                    event.stopPropagation();
                    setDropTarget(platform.id);
                  }}
                  onDragLeave={(event) => {
                    event.stopPropagation();
                    setDropTarget((t) => (t === platform.id ? null : t));
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    stopAutoScroll();
                    if (dragging) movePinned(dragging, platform.id);
                    setDragging(null);
                    setDropTarget(null);
                  }}
                  onDragEnd={(event) => {
                    event.stopPropagation();
                    stopAutoScroll();
                    setDragging(null);
                    setDropTarget(null);
                  }}
                >
                <button
                  onClick={() => setActiveTab(id)}
                  title={
                    platform.adult
                      ? `${platform.name} — adult content (18+)`
                      : platform.availability === 'ready'
                      ? platform.name
                      : platform.availability === 'disabled'
                        ? `${platform.name} — installed but switched off`
                        : `${platform.name} — not installed yet`
                  }
                  style={{
                    flex: 1,
                    minWidth: 0,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.75rem',
                    padding: '0.55rem 0.9rem',
                    paddingRight: '1.9rem',
                    borderRadius: 'var(--radius-md)',
                    backgroundColor: isActive ? 'var(--bg-card-hover)' : 'transparent',
                    color: isActive ? '#fff' : 'var(--text-muted)',
                    border: '1px solid',
                    borderColor: isActive ? 'rgba(59, 130, 246, 0.3)' : 'transparent',
                    fontWeight: isActive ? 600 : 500,
                    fontSize: '0.83rem',
                    cursor: 'pointer',
                    transition: 'var(--transition)',
                    // Dimmed rather than hidden: the row still says the service
                    // exists and is one click from working, which is the whole
                    // reason unavailable platforms are listed at all.
                    opacity: platform.availability === 'ready' ? 1 : 0.6,
                  }}
                >
                  <span
                    aria-hidden
                    style={{
                      width: '8px',
                      height: '8px',
                      borderRadius: '50%',
                      flexShrink: 0,
                      background: platform.accent,
                      boxShadow: isActive ? `0 0 6px ${platform.accent}` : 'none',
                    }}
                  />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, textAlign: 'left' }}>
                    {platform.name}
                  </span>
                  {platform.adult ? <AdultFlag /> : platform.mixedAdult ? <AdultFlag partial /> : null}
                </button>
                {onOttPlatformsChanged && (
                  <button
                    type="button"
                    className={`ott-side-pin${isPinned ? ' ott-side-pin--on' : ''}`}
                    onClick={() => togglePin(platform.id)}
                    title={isPinned ? `Unpin ${platform.name}` : `Pin ${platform.name} to the top`}
                    aria-label={isPinned ? `Unpin ${platform.name}` : `Pin ${platform.name} to the top`}
                    aria-pressed={isPinned}
                  >
                    {isPinned ? <PinOff size={12} /> : <Pin size={12} />}
                  </button>
                )}
                </div>
              );
            })}

            {/* Enabled services that are not in the sidebar yet: one click adds
                and opens, so finding one never means a trip to the picker. */}
            {searching && extraMatches.length > 0 && (
              <>
                <div style={{ padding: '0.4rem 0.9rem 0.15rem', fontSize: '0.66rem', color: 'var(--text-subtle)' }}>
                  Not in sidebar — click to add
                </div>
                {extraMatches.map((platform) => (
                  <button
                    key={platform.id}
                    onClick={() => void openService(platform)}
                    title={`Add ${platform.name} to the sidebar and open it`}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.75rem',
                      padding: '0.45rem 0.9rem',
                      borderRadius: 'var(--radius-md)',
                      background: 'transparent',
                      border: '1px dashed var(--border-color)',
                      color: 'var(--text-muted)',
                      fontSize: '0.8rem',
                      cursor: 'pointer',
                    }}
                  >
                    <span aria-hidden style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: platform.accent }} />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, textAlign: 'left' }}>
                      {platform.name}
                    </span>
                    {platform.adult ? <AdultFlag /> : platform.mixedAdult ? <AdultFlag partial /> : null}
                    <Plus size={13} aria-hidden />
                  </button>
                ))}
              </>
            )}

            {searching && shownMatches.length === 0 && extraMatches.length === 0 && (
              <div style={{ padding: '0.35rem 0.9rem', fontSize: '0.75rem', color: 'var(--text-subtle)' }}>
                {allPlatforms === null ? 'Looking…' : `No enabled service matches “${serviceQuery.trim()}”`}
              </div>
            )}

            {!searching && unavailable.length > 0 && (
              <button
                onClick={() => setShowUnavailable((on) => !on)}
                style={{
                  marginTop: '0.15rem',
                  padding: '0.35rem 0.9rem',
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-subtle)',
                  fontSize: '0.72rem',
                  fontWeight: 600,
                  textAlign: 'left',
                  cursor: 'pointer',
                }}
              >
                {showUnavailable
                  ? 'Hide services you have not added'
                  : `${unavailable.length} more available to add`}
              </button>
            )}
          </>
        )}
      </nav>

      {pickerOpen && onOttPlatformsChanged && (
        <StreamingServicePicker
          onClose={() => setPickerOpen(false)}
          onChanged={onOttPlatformsChanged}
        />
      )}

      {/* Status Footer */}
      <div style={{
        padding: '0.75rem',
        borderRadius: 'var(--radius-md)',
        background: 'var(--bg-card)',
        border: '1px solid var(--border-color)',
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem',
        fontSize: '0.72rem',
        color: 'var(--text-muted)'
      }}>
        <ShieldCheck size={16} style={{ color: 'var(--status-success)' }} />
        <span>V8 Sandbox Active</span>
      </div>
    </aside>
  );
};
