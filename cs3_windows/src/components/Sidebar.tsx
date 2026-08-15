import React from 'react';
import { Home, Search, Film, Download, Puzzle, Settings, ShieldCheck } from 'lucide-react';

export type ActiveTab = 'home' | 'search' | 'library' | 'downloads' | 'extensions' | 'settings';

interface SidebarProps {
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;
  downloadCount: number;
}

export const Sidebar: React.FC<SidebarProps> = ({ activeTab, setActiveTab, downloadCount }) => {
  const navItems = [
    { id: 'home' as ActiveTab, label: 'Home', icon: Home },
    { id: 'search' as ActiveTab, label: 'Search', icon: Search },
    { id: 'library' as ActiveTab, label: 'Library', icon: Film },
    { id: 'downloads' as ActiveTab, label: 'Downloads', icon: Download, badge: downloadCount },
    { id: 'extensions' as ActiveTab, label: 'Extensions', icon: Puzzle },
    { id: 'settings' as ActiveTab, label: 'Settings', icon: Settings },
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
            </button>
          );
        })}
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
