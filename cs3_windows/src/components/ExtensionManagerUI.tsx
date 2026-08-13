import React, { useEffect, useState } from 'react';
import type { SitePlugin, PluginCompatibilityReport } from '../types/plugin';
import type { OfficialRepository } from '../../electron/officialRepositories';
import { Puzzle, Plus, Download, ShieldCheck, Globe, CheckCircle2, Layers } from 'lucide-react';
import { ExtensionUpdates } from './ExtensionUpdates';

export const ExtensionManagerUI: React.FC = () => {
  const [repoUrlInput, setRepoUrlInput] = useState('');
  const [officialRepos, setOfficialRepos] = useState<OfficialRepository[]>([]);
  const [activeCategory, setActiveCategory] = useState<string>('All');
  const [installedRepoUrls, setInstalledRepoUrls] = useState<Set<string>>(new Set());
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Starts empty. This list previously opened with three hardcoded entries
  // (SuperStream, Sflix, GogoAnime) whose download URLs pointed at a repository
  // that does not exist, so the manager showed installable extensions that could
  // never install. Real entries arrive from fetchRepository below.
  const [plugins, setPlugins] = useState<SitePlugin[]>([]);

  const [installedPluginNames, setInstalledPluginNames] = useState<Set<string>>(new Set());
  const [activeReport, setActiveReport] = useState<PluginCompatibilityReport | null>(null);

  useEffect(() => {
    if (window.cloudstream) {
      window.cloudstream
        .getOfficialRepositories()
        .then((repos) => {
          if (Array.isArray(repos)) setOfficialRepos(repos);
        })
        .catch(() => {});

      window.cloudstream
        .getInstalledRepositories()
        .then((urls) => {
          if (Array.isArray(urls)) setInstalledRepoUrls(new Set(urls));
        })
        .catch(() => {});

      window.cloudstream
        .getInstalledPlugins()
        .then((list) => {
          if (Array.isArray(list) && list.length > 0) {
            setPlugins((prev) => [...prev, ...list]);
            setInstalledPluginNames(
              new Set(list.filter((p) => p && p.internalName).map((p) => p.internalName))
            );
          }
        })
        .catch(() => {});
    }
  }, []);

  const handleFetchRepo = async (urlToFetch?: string, repoName?: string) => {
    const targetUrl = urlToFetch || repoUrlInput;
    if (!targetUrl) return;

    if (window.cloudstream) {
      try {
        const response = await window.cloudstream.fetchRepository(targetUrl);

        if (!response.ok || !response.repository) {
          setToastMessage(`✗ ${repoName || 'Repository'} failed: ${response.error ?? 'unknown error'}`);
          setTimeout(() => setToastMessage(null), 6000);
          return;
        }

        const { repository } = response;
        if (Array.isArray(repository?.plugins) && repository.plugins.length > 0) {
          setPlugins((prev) => [...prev, ...repository.plugins]);
        }

        const updatedUrls = await window.cloudstream.getInstalledRepositories().catch(() => []);
        if (Array.isArray(updatedUrls)) {
          setInstalledRepoUrls(new Set(updatedUrls));
        }

        const warningCount = Array.isArray(repository?.warnings) ? repository.warnings.length : 0;
        const warning = warningCount > 0 ? ` (${warningCount} list(s) unreadable)` : '';
        const count = Array.isArray(repository?.plugins) ? repository.plugins.length : 0;
        setToastMessage(
          `✓ ${repository.name ?? 'Repository'}: ${count} extension(s) found${warning}`
        );
        setTimeout(() => setToastMessage(null), 5000);
      } catch (err) {
        setToastMessage(`✗ Fetch failed: ${err instanceof Error ? err.message : String(err)}`);
        setTimeout(() => setToastMessage(null), 6000);
      }
    }

    if (!urlToFetch) {
      setRepoUrlInput('');
    }
  };

  const handleInstallPlugin = async (plugin: SitePlugin) => {
    if (!plugin?.internalName) return;
    if (window.cloudstream) {
      try {
        await window.cloudstream.installPlugin(plugin);
        setInstalledPluginNames((prev) => new Set(prev).add(plugin.internalName));
        setToastMessage(`✓ ${plugin.name} installed & active!`);
        setTimeout(() => setToastMessage(null), 3500);
      } catch (err) {
        setToastMessage(`✗ Install failed: ${err instanceof Error ? err.message : String(err)}`);
        setTimeout(() => setToastMessage(null), 5000);
      }
    }
  };

  const handleAnalyze = async (plugin: SitePlugin) => {
    if (!plugin) return;
    if (window.cloudstream) {
      try {
        const report = await window.cloudstream.analyzePlugin(plugin);
        if (report) setActiveReport(report);
      } catch (err) {
        console.error('Failed to analyze plugin:', err);
      }
    }
  };

  const safeOfficialRepos = Array.isArray(officialRepos) ? officialRepos.filter(Boolean) : [];
  const filteredOfficialRepos = safeOfficialRepos.filter((r) => {
    if (activeCategory === 'All') return true;
    return r.category === activeCategory;
  });

  const safePlugins = Array.isArray(plugins) ? plugins.filter(Boolean) : [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Header */}
      <div>
        <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#fff' }}>Official Extension Library & Repositories</h2>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
          Browse {safeOfficialRepos.length} community repositories or add a custom repository URL
        </p>
      </div>

      <ExtensionUpdates
        onUpdated={() => {
          window.cloudstream
            ?.getInstalledPlugins()
            .then((list) => {
              if (Array.isArray(list)) {
                setInstalledPluginNames(
                  new Set(list.filter((p) => p && p.internalName).map((p) => p.internalName))
                );
              }
            })
            .catch(() => {});
        }}
      />

      {/* Success Toast */}
      {toastMessage && (
        <div style={{
          background: 'rgba(16, 185, 129, 0.15)',
          border: '1px solid var(--status-success)',
          padding: '0.75rem 1.25rem',
          borderRadius: 'var(--radius-md)',
          color: '#fff',
          fontSize: '0.85rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem'
        }}>
          <CheckCircle2 size={18} style={{ color: 'var(--status-success)' }} />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Add Custom Repository URL Bar */}
      <div style={{
        display: 'flex',
        gap: '0.75rem',
        background: 'var(--bg-card)',
        padding: '1rem',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--border-color)'
      }}>
        <input
          type="text"
          placeholder="Enter custom repo.json URL (e.g. https://raw.githubusercontent.com/user/repo/master/repo.json)..."
          value={repoUrlInput}
          onChange={(e) => setRepoUrlInput(e.target.value)}
          style={{
            flex: 1,
            padding: '0.55rem 1rem',
            backgroundColor: 'var(--bg-input)',
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-md)',
            color: '#fff',
            fontSize: '0.85rem'
          }}
        />
        <button onClick={() => handleFetchRepo()} className="btn btn-primary">
          <Plus size={16} />
          <span>Add Custom Repo</span>
        </button>
      </div>

      {/* Official 26 Repositories Catalog Section */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#fff' }}>
            <Layers size={18} style={{ color: 'var(--accent-light)' }} />
            <h3 style={{ fontSize: '1.05rem', fontWeight: 700 }}>26 Community Repositories Catalog</h3>
          </div>

          {/* Category Filter Chips */}
          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
            {['All', 'Official', 'Regional', 'Anime', 'Movies & Shows', 'Community', 'Compatibility'].map((cat) => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={`chip ${activeCategory === cat ? 'active' : ''}`}
                style={{ fontSize: '0.72rem', padding: '0.25rem 0.65rem' }}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* Repository Cards Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '1rem' }}>
          {filteredOfficialRepos.map((repo) => {
            const isAdded =
              repo &&
              (installedRepoUrls.has(repo.rawRepoUrl) ||
                installedRepoUrls.has(repo.url) ||
                repo.id === 'megarepo' ||
                repo.id === 'extensions');

            return (
              <div
                key={repo.id}
                style={{
                  background: 'var(--bg-card)',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid',
                  borderColor: isAdded ? 'rgba(59, 130, 246, 0.4)' : 'var(--border-color)',
                  padding: '1.25rem',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  gap: '1rem'
                }}
              >
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <Globe size={16} style={{ color: 'var(--accent-light)' }} />
                      <h4 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#fff' }}>{repo.name}</h4>
                    </div>
                    <span className="poster-badge" style={{ position: 'static' }}>{repo.category}</span>
                  </div>

                  <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', lineHeight: 1.4 }}>
                    {repo.description}
                  </p>

                  <div style={{ display: 'flex', gap: '1rem', marginTop: '0.75rem', fontSize: '0.72rem', color: 'var(--text-subtle)' }}>
                    <span>Language: <strong>{repo.language}</strong></span>
                    {/* The provider count shown here used to be a fixed number in
                        the catalogue that matched no repository. The real count is
                        only known after fetching, so state whether the URL is
                        known-good instead of inventing a total. */}
                    <span title={repo.rawRepoUrl}>
                      {repo.verified ? (
                        <strong style={{ color: 'var(--status-success)' }}>Reachable</strong>
                      ) : (
                        <strong style={{ color: 'var(--status-warning, #d19a2f)' }}>Unverified link</strong>
                      )}
                    </span>
                  </div>
                </div>

                <button
                  onClick={() => handleFetchRepo(repo.rawRepoUrl, repo.name)}
                  className={`btn ${isAdded ? 'btn-secondary' : 'btn-primary'}`}
                  style={{ fontSize: '0.8rem', width: '100%', cursor: 'pointer' }}
                >
                  {isAdded ? (
                    <>
                      <CheckCircle2 size={15} style={{ color: 'var(--status-success)' }} />
                      <span>Active & Persisted</span>
                    </>
                  ) : (
                    <>
                      <Plus size={15} />
                      <span>Add Repository</span>
                    </>
                  )}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Active Compatibility Report Modal / Drawer */}
      {activeReport && (
        <div style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--accent-primary)',
          borderRadius: 'var(--radius-md)',
          padding: '1.25rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.75rem'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--accent-light)' }}>
              <ShieldCheck size={20} />
              <h3 style={{ fontSize: '1rem', fontWeight: 700 }}>
                Plugin Compatibility Analysis: {activeReport.pluginName}
              </h3>
            </div>
            <button onClick={() => setActiveReport(null)} className="btn btn-secondary btn-icon" style={{ height: '28px', width: '28px' }}>
              ✕
            </button>
          </div>

          <div style={{ display: 'flex', gap: '1rem', fontSize: '0.82rem', color: 'var(--text-main)' }}>
            <span>Score: <strong>{activeReport.compatibilityScore}%</strong></span>
            <span>Recommended Tier: <strong>{activeReport.recommendedTier}</strong></span>
            <span>Confidence: <strong>{activeReport.confidence}</strong></span>
          </div>

          {Array.isArray(activeReport.details) && (
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              {activeReport.details.map((d, i) => (
                <p key={i}>• {d}</p>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Plugin Cards List */}
      <div>
        <h3 style={{ fontSize: '1.05rem', fontWeight: 700, color: '#fff', marginBottom: '1rem' }}>
          Available Extensions ({safePlugins.length})
        </h3>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1rem' }}>
          {safePlugins.map((plugin, idx) => {
            const isInstalled = plugin.internalName ? installedPluginNames.has(plugin.internalName) : false;

            return (
              <div
                key={idx}
                style={{
                  background: 'var(--bg-card)',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid',
                  borderColor: isInstalled ? 'rgba(16, 185, 129, 0.4)' : 'var(--border-color)',
                  padding: '1.25rem',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  gap: '1rem'
                }}
              >
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
                    <div style={{
                      width: '36px',
                      height: '36px',
                      borderRadius: 'var(--radius-sm)',
                      background: 'var(--bg-input)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: isInstalled ? 'var(--status-success)' : 'var(--accent-light)'
                    }}>
                      <Puzzle size={20} />
                    </div>
                    <div>
                      <h4 style={{ fontSize: '0.95rem', fontWeight: 600, color: '#fff' }}>{plugin.name}</h4>
                      <span style={{ fontSize: '0.72rem', color: 'var(--text-subtle)' }}>v{plugin.version} • {plugin.internalName}</span>
                    </div>
                  </div>

                  <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                    {plugin.description || 'Community media provider extension'}
                  </p>
                </div>

                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button onClick={() => handleAnalyze(plugin)} className="btn btn-secondary" style={{ flex: 1, fontSize: '0.78rem' }}>
                    <ShieldCheck size={14} />
                    <span>Analyze</span>
                  </button>
                  <button
                    onClick={() => handleInstallPlugin(plugin)}
                    className={`btn ${isInstalled ? 'btn-secondary' : 'btn-primary'}`}
                    style={{ flex: 1, fontSize: '0.78rem' }}
                  >
                    {isInstalled ? <CheckCircle2 size={14} style={{ color: 'var(--status-success)' }} /> : <Download size={14} />}
                    <span>{isInstalled ? 'Active' : 'Install'}</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};


