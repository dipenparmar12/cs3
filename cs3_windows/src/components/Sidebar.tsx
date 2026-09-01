import { useEffect, useState } from 'react';
import {
  Home,
  Search,
  Film,
  History,
  Download,
  Puzzle,
  Settings,
  ShieldCheck,
  Tv,
} from 'lucide-react';

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
  availability: 'ready' | 'disabled' | 'aggregate' | 'missing';
}

interface SidebarProps {
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;
  downloadCount: number;
  missingComponentCount?: number;
  /**
   * The streaming services, newest inventory first.
   *
   * Passed in rather than fetched here so the list refreshes when an install
   * changes it — the sidebar is mounted for the life of the app and would
   * otherwise show the state it saw at launch forever.
   */
  ottPlatforms?: SidebarOttPlatform[];
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  setActiveTab,
  downloadCount,
  missingComponentCount = 0,
  ottPlatforms = [],
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
  const available = ottPlatforms.filter((p) => p.availability !== 'missing');
  const unavailable = ottPlatforms.filter((p) => p.availability === 'missing');

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
    { id: 'extensions' as ActiveTab, label: 'Extensions', icon: Puzzle },
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
      <nav style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', flex: 1 }}>
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
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <Icon size={18} style={{ color: isActive ? 'var(--accent-light)' : 'inherit' }} />
                <span>{item.label}</span>
              </div>
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
              <Tv size={13} aria-hidden />
              <span>Streaming services</span>
            </div>

            {[...available, ...(showUnavailable ? unavailable : [])].map((platform) => {
              const id: ActiveTab = `ott:${platform.id}`;
              const isActive = activeTab === id;
              return (
                <button
                  key={platform.id}
                  onClick={() => setActiveTab(id)}
                  title={
                    platform.availability === 'ready'
                      ? platform.name
                      : platform.availability === 'disabled'
                        ? `${platform.name} — installed but switched off`
                        : platform.availability === 'aggregate'
                          ? `${platform.name} — carried by another extension`
                          : `${platform.name} — not installed yet`
                  }
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.75rem',
                    padding: '0.55rem 0.9rem',
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
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {platform.name}
                  </span>
                </button>
              );
            })}

            {unavailable.length > 0 && (
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
