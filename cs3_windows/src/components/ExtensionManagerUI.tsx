import React, { useEffect, useState } from 'react';
import type { SitePlugin, PluginCompatibilityReport } from '../types/plugin';
import type { OfficialRepository } from '../../electron/officialRepositories';
import {
  Puzzle, Plus, Download, ShieldCheck, Globe, CheckCircle2, Layers,
  Loader2, RefreshCw, RotateCcw, Trash2, Square, CheckSquare, Bookmark, Sparkles,
} from 'lucide-react';
import { ProviderSelector } from './ProviderSelector';
import { ExtensionUpdates } from './ExtensionUpdates';

function mergePlugins(current: SitePlugin[], incoming: SitePlugin[]): SitePlugin[] {
  const byName = new Map<string, SitePlugin>();
  for (const plugin of [...current, ...incoming]) {
    if (plugin?.internalName) byName.set(plugin.internalName, plugin);
  }
  return [...byName.values()];
}

export interface SavedPreset {
  id: string;
  name: string;
  repoIds: string[];
  pluginNames: string[];
}

export const ExtensionManagerUI: React.FC = () => {
  const [repoUrlInput, setRepoUrlInput] = useState('');
  const [officialRepos, setOfficialRepos] = useState<OfficialRepository[]>([]);
  const [activeCategory, setActiveCategory] = useState<string>('All');
  const [installedRepoUrls, setInstalledRepoUrls] = useState<Set<string>>(new Set());
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const [plugins, setPlugins] = useState<SitePlugin[]>([]);
  const [installedPluginNames, setInstalledPluginNames] = useState<Set<string>>(new Set());
  const [activeReport, setActiveReport] = useState<PluginCompatibilityReport | null>(null);

  const [busy, setBusy] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [confirmRemoveRepo, setConfirmRemoveRepo] = useState<string | null>(null);

  // Multi-selection state for Repositories & Extensions
  const [selectedRepoIds, setSelectedRepoIds] = useState<Set<string>>(new Set());
  const [selectedPluginNames, setSelectedPluginNames] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState<string | null>(null);

  // Preset profiles state
  const [showPresetModal, setShowPresetModal] = useState(false);
  const [newPresetName, setNewPresetName] = useState('');
  const [savedPresets, setSavedPresets] = useState<SavedPreset[]>(() => {
    try {
      const stored = localStorage.getItem('cs3_extension_presets');
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

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
            setPlugins((prev) => mergePlugins(prev, list));
            setInstalledPluginNames(
              new Set(list.filter((p) => p && p.internalName).map((p) => p.internalName))
            );
          }
        })
        .catch(() => {});
    }
  }, []);

  const safeOfficialRepos = Array.isArray(officialRepos) ? officialRepos.filter(Boolean) : [];
  const filteredOfficialRepos = safeOfficialRepos.filter((r) => {
    if (activeCategory === 'All') return true;
    return r.category === activeCategory;
  });
  const safePlugins = Array.isArray(plugins) ? plugins.filter(Boolean) : [];

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
          setPlugins((prev) => mergePlugins(prev, repository.plugins));
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

  const handleRemoveRepo = async (repoUrl: string, repoName?: string) => {
    if (!repoUrl || !window.cloudstream) return;
    try {
      const remainingUrls = await window.cloudstream.removeRepository(repoUrl);
      if (Array.isArray(remainingUrls)) {
        setInstalledRepoUrls(new Set(remainingUrls));
      } else {
        setInstalledRepoUrls((prev) => {
          const next = new Set(prev);
          next.delete(repoUrl);
          return next;
        });
      }
      setToastMessage(`✓ Repository deactivated: ${repoName || repoUrl}`);
      setTimeout(() => setToastMessage(null), 4000);
    } catch (err) {
      setToastMessage(`✗ Failed to remove repository: ${err instanceof Error ? err.message : String(err)}`);
      setTimeout(() => setToastMessage(null), 5000);
    } finally {
      setConfirmRemoveRepo(null);
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

  const handleReinstall = async (plugin: SitePlugin) => {
    if (!plugin?.internalName || !window.cloudstream) return;
    setBusy(plugin.internalName);
    try {
      await window.cloudstream.installPlugin(plugin);
      setToastMessage(`✓ ${plugin.name} reinstalled`);
    } catch (err) {
      setToastMessage(`✗ Reinstall failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(null);
      setTimeout(() => setToastMessage(null), 4000);
    }
  };

  const handleUpdate = async (plugin: SitePlugin) => {
    if (!plugin?.internalName || !window.cloudstream) return;
    setBusy(plugin.internalName);
    try {
      const outcome = await window.cloudstream.updateExtension(plugin.internalName);
      setToastMessage(`${outcome.ok ? '✓' : '✗'} ${plugin.name}: ${outcome.message}`);
    } catch (err) {
      setToastMessage(`✗ Update failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(null);
      setTimeout(() => setToastMessage(null), 5000);
    }
  };

  const handleUninstall = async (plugin: SitePlugin) => {
    if (!plugin?.internalName || !window.cloudstream) return;
    setBusy(plugin.internalName);
    try {
      const removed = await window.cloudstream.uninstallPlugin(plugin.internalName);
      if (removed) {
        setInstalledPluginNames((prev) => {
          const next = new Set(prev);
          next.delete(plugin.internalName);
          return next;
        });
        setToastMessage(`✓ ${plugin.name} uninstalled`);
      } else {
        setToastMessage(`✗ ${plugin.name} could not be uninstalled`);
      }
    } catch (err) {
      setToastMessage(`✗ Uninstall failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(null);
      setConfirmRemove(null);
      setTimeout(() => setToastMessage(null), 4000);
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

  // --- Multi-Selection & Bulk Operation Handlers ---

  const toggleSelectRepo = (id: string) => {
    setSelectedRepoIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllRepos = (mode: 'all' | 'active' | 'inactive' | 'none') => {
    if (mode === 'none') {
      setSelectedRepoIds(new Set());
      return;
    }
    const next = new Set<string>();
    filteredOfficialRepos.forEach((r) => {
      const isAdded = installedRepoUrls.has(r.rawRepoUrl) || installedRepoUrls.has(r.url);
      if (mode === 'all') next.add(r.id);
      else if (mode === 'active' && isAdded) next.add(r.id);
      else if (mode === 'inactive' && !isAdded) next.add(r.id);
    });
    setSelectedRepoIds(next);
  };

  const handleBulkAddRepos = async () => {
    const reposToFetch = safeOfficialRepos.filter((r) => selectedRepoIds.has(r.id));
    if (reposToFetch.length === 0) return;
    setBulkBusy(`Activating ${reposToFetch.length} repositories...`);
    let success = 0;
    for (let i = 0; i < reposToFetch.length; i++) {
      const r = reposToFetch[i];
      setToastMessage(`Adding repo ${i + 1}/${reposToFetch.length}: ${r.name}...`);
      try {
        const res = await window.cloudstream?.fetchRepository(r.rawRepoUrl);
        if (res?.ok && res.repository && Array.isArray(res.repository.plugins)) {
          const pluginsToMerge = res.repository.plugins;
          setPlugins((prev) => mergePlugins(prev, pluginsToMerge));
          success++;
        }
      } catch {}
    }
    const updatedUrls = await window.cloudstream?.getInstalledRepositories().catch(() => []);
    if (Array.isArray(updatedUrls)) setInstalledRepoUrls(new Set(updatedUrls));
    setToastMessage(`✓ Activated ${success} of ${reposToFetch.length} repository(ies)!`);
    setBulkBusy(null);
    setSelectedRepoIds(new Set());
    setTimeout(() => setToastMessage(null), 5000);
  };

  const handleBulkSyncRepos = async () => {
    const selectedRepos = safeOfficialRepos.filter((r) => selectedRepoIds.has(r.id));
    const urlsToSync = selectedRepos.length > 0 ? selectedRepos.map((r) => r.rawRepoUrl) : Array.from(installedRepoUrls);
    if (urlsToSync.length === 0) return;
    setBulkBusy(`Syncing ${urlsToSync.length} repositories...`);
    let success = 0;
    for (let i = 0; i < urlsToSync.length; i++) {
      const url = urlsToSync[i];
      const repoName = safeOfficialRepos.find((r) => r.rawRepoUrl === url || r.url === url)?.name || url;
      setToastMessage(`Syncing repo ${i + 1}/${urlsToSync.length}: ${repoName}...`);
      try {
        const res = await window.cloudstream?.fetchRepository(url);
        if (res?.ok && res.repository && Array.isArray(res.repository.plugins)) {
          const pluginsToMerge = res.repository.plugins;
          setPlugins((prev) => mergePlugins(prev, pluginsToMerge));
          success++;
        }
      } catch {}
    }
    setToastMessage(`✓ Synced ${success} repository(ies)!`);
    setBulkBusy(null);
    setSelectedRepoIds(new Set());
    setTimeout(() => setToastMessage(null), 5000);
  };

  const handleBulkDeactivateRepos = async () => {
    const selectedRepos = safeOfficialRepos.filter((r) => selectedRepoIds.has(r.id));
    if (selectedRepos.length === 0) return;
    setBulkBusy(`Deactivating ${selectedRepos.length} repositories...`);
    let count = 0;
    for (let i = 0; i < selectedRepos.length; i++) {
      const r = selectedRepos[i];
      setToastMessage(`Deactivating repo ${i + 1}/${selectedRepos.length}: ${r.name}...`);
      try {
        await window.cloudstream?.removeRepository(r.rawRepoUrl);
        if (r.url) await window.cloudstream?.removeRepository(r.url);
        count++;
      } catch {}
    }
    const updatedUrls = await window.cloudstream?.getInstalledRepositories().catch(() => []);
    if (Array.isArray(updatedUrls)) setInstalledRepoUrls(new Set(updatedUrls));
    setToastMessage(`✓ Deactivated ${count} repository(ies)!`);
    setBulkBusy(null);
    setSelectedRepoIds(new Set());
    setTimeout(() => setToastMessage(null), 5000);
  };

  const toggleSelectPlugin = (internalName: string) => {
    setSelectedPluginNames((prev) => {
      const next = new Set(prev);
      if (next.has(internalName)) next.delete(internalName);
      else next.add(internalName);
      return next;
    });
  };

  const selectAllPlugins = (mode: 'all' | 'installed' | 'uninstalled' | 'none') => {
    if (mode === 'none') {
      setSelectedPluginNames(new Set());
      return;
    }
    const next = new Set<string>();
    safePlugins.forEach((p) => {
      if (!p?.internalName) return;
      const isInstalled = installedPluginNames.has(p.internalName);
      if (mode === 'all') next.add(p.internalName);
      else if (mode === 'installed' && isInstalled) next.add(p.internalName);
      else if (mode === 'uninstalled' && !isInstalled) next.add(p.internalName);
    });
    setSelectedPluginNames(next);
  };

  const handleBulkInstallPlugins = async () => {
    const targets = safePlugins.filter(
      (p) => p?.internalName && selectedPluginNames.has(p.internalName) && !installedPluginNames.has(p.internalName)
    );
    if (targets.length === 0) return;
    setBulkBusy(`Installing ${targets.length} extensions...`);
    let success = 0;
    for (let i = 0; i < targets.length; i++) {
      const plugin = targets[i];
      setToastMessage(`Installing ${i + 1}/${targets.length}: ${plugin.name}...`);
      try {
        const res = await window.cloudstream?.installPlugin(plugin);
        if (res?.ok) {
          setInstalledPluginNames((prev) => new Set(prev).add(plugin.internalName));
          success++;
        }
      } catch {}
    }
    setToastMessage(`✓ Bulk installed ${success} of ${targets.length} extension(s)!`);
    setBulkBusy(null);
    setSelectedPluginNames(new Set());
    setTimeout(() => setToastMessage(null), 5000);
  };

  const handleBulkUninstallPlugins = async () => {
    const targets = Array.from(selectedPluginNames).filter((name) => installedPluginNames.has(name));
    if (targets.length === 0) return;
    setBulkBusy(`Uninstalling ${targets.length} extensions...`);
    let success = 0;
    for (let i = 0; i < targets.length; i++) {
      const name = targets[i];
      const pluginName = safePlugins.find((p) => p.internalName === name)?.name || name;
      setToastMessage(`Uninstalling ${i + 1}/${targets.length}: ${pluginName}...`);
      try {
        const removed = await window.cloudstream?.uninstallPlugin(name);
        if (removed) {
          setInstalledPluginNames((prev) => {
            const next = new Set(prev);
            next.delete(name);
            return next;
          });
          success++;
        }
      } catch {}
    }
    setToastMessage(`✓ Bulk uninstalled ${success} extension(s)!`);
    setBulkBusy(null);
    setSelectedPluginNames(new Set());
    setTimeout(() => setToastMessage(null), 5000);
  };

  const handleBulkUpdatePlugins = async () => {
    const targets = Array.from(selectedPluginNames).filter((name) => installedPluginNames.has(name));
    if (targets.length === 0) return;
    setBulkBusy(`Updating ${targets.length} extensions...`);
    try {
      const outcomes = await window.cloudstream?.updateAllExtensions(targets);
      const installed = outcomes?.filter((o) => o.ok).length || 0;
      setToastMessage(`✓ Bulk updated ${installed} extension(s)!`);
    } catch (err) {
      setToastMessage(`✗ Bulk update failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBulkBusy(null);
      setSelectedPluginNames(new Set());
      setTimeout(() => setToastMessage(null), 5000);
    }
  };

  // --- Presets / Saved Collections ---

  const handleSavePreset = () => {
    if (!newPresetName.trim()) return;
    const preset: SavedPreset = {
      id: `preset_${Date.now()}`,
      name: newPresetName.trim(),
      repoIds: Array.from(selectedRepoIds),
      pluginNames: Array.from(selectedPluginNames),
    };
    const next = [...savedPresets, preset];
    setSavedPresets(next);
    try {
      localStorage.setItem('cs3_extension_presets', JSON.stringify(next));
    } catch {}
    setToastMessage(`✓ Saved preset profile: "${newPresetName.trim()}"`);
    setShowPresetModal(false);
    setNewPresetName('');
    setTimeout(() => setToastMessage(null), 4000);
  };

  const handleDeletePreset = (id: string, name: string) => {
    const next = savedPresets.filter((p) => p.id !== id);
    setSavedPresets(next);
    try {
      localStorage.setItem('cs3_extension_presets', JSON.stringify(next));
    } catch {}
    setToastMessage(`✓ Deleted preset: "${name}"`);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const handleApplyPreset = async (presetId: string) => {
    if (!presetId) return;
    let repoIdsToActivate: string[] = [];
    let presetName = '';

    if (presetId === 'preset_all_official') {
      presetName = 'All 26 Official Repositories';
      repoIdsToActivate = safeOfficialRepos.map((r) => r.id);
    } else if (presetId === 'preset_starter') {
      presetName = 'Recommended Starter Pack';
      repoIdsToActivate = ['megarepo', 'extensions', 'aniyomi_compat'];
    } else if (presetId === 'preset_anime') {
      presetName = 'Anime & Asian Media Pack';
      repoIdsToActivate = ['aniyomi_compat', 'luna712', 'indostream'];
    } else if (presetId === 'preset_regional') {
      presetName = 'European & Regional Pack';
      repoIdsToActivate = ['german_providers', 'italia_in_streaming', 'fstream', 'uk_extensions'];
    } else {
      const found = savedPresets.find((p) => p.id === presetId);
      if (found) {
        presetName = found.name;
        repoIdsToActivate = found.repoIds;
      }
    }

    if (repoIdsToActivate.length === 0) return;

    setBulkBusy(`Applying preset "${presetName}"...`);
    const targetRepos = safeOfficialRepos.filter((r) => repoIdsToActivate.includes(r.id));
    let count = 0;

    for (let i = 0; i < targetRepos.length; i++) {
      const r = targetRepos[i];
      setToastMessage(`Preset syncing ${i + 1}/${targetRepos.length}: ${r.name}...`);
      try {
        const res = await window.cloudstream?.fetchRepository(r.rawRepoUrl);
        if (res?.ok && res.repository && Array.isArray(res.repository.plugins)) {
          const pluginsToMerge = res.repository.plugins;
          setPlugins((prev) => mergePlugins(prev, pluginsToMerge));
          count++;
        }
      } catch {}
    }

    const updatedUrls = await window.cloudstream?.getInstalledRepositories().catch(() => []);
    if (Array.isArray(updatedUrls)) setInstalledRepoUrls(new Set(updatedUrls));
    setToastMessage(`✓ Applied preset "${presetName}" (${count} repositories synced)!`);
    setBulkBusy(null);
    setTimeout(() => setToastMessage(null), 5000);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Header & Presets Bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#fff' }}>Official Extension Library & Repositories</h2>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            Browse {safeOfficialRepos.length} community repositories, manage custom sources, or run bulk operations
          </p>
        </div>

        {/* Presets & Collections Dropdown Bar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', background: 'var(--bg-card)', padding: '0.4rem 0.75rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}>
            <Sparkles size={15} style={{ color: 'var(--accent-light)' }} />
            <select
              onChange={(e) => handleApplyPreset(e.target.value)}
              defaultValue=""
              disabled={Boolean(bulkBusy)}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#fff',
                fontSize: '0.8rem',
                outline: 'none',
                cursor: 'pointer'
              }}
            >
              <option value="" disabled>Load Preset / Profile...</option>
              <optgroup label="Built-in Presets">
                <option value="preset_starter">🌟 Recommended Starter Pack (3 repos)</option>
                <option value="preset_all_official">🔥 All 26 Official Repositories</option>
                <option value="preset_anime">⛩️ Anime & Asian Media Pack</option>
                <option value="preset_regional">🌍 European & Regional Pack</option>
              </optgroup>
              {savedPresets.length > 0 && (
                <optgroup label="My Saved Presets">
                  {savedPresets.map((p) => (
                    <option key={p.id} value={p.id}>⭐ {p.name}</option>
                  ))}
                </optgroup>
              )}
            </select>
          </div>

          {(selectedRepoIds.size > 0 || selectedPluginNames.size > 0) && (
            <button
              onClick={() => setShowPresetModal(true)}
              className="btn btn-secondary"
              style={{ fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}
            >
              <Bookmark size={14} />
              <span>Save Selection as Preset</span>
            </button>
          )}
        </div>
      </div>

      <ProviderSelector />

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

      {/* Progress / Toast Banner */}
      {(toastMessage || bulkBusy) && (
        <div style={{
          background: bulkBusy ? 'rgba(59, 130, 246, 0.15)' : 'rgba(16, 185, 129, 0.15)',
          border: '1px solid',
          borderColor: bulkBusy ? 'var(--accent-primary)' : 'var(--status-success)',
          padding: '0.75rem 1.25rem',
          borderRadius: 'var(--radius-md)',
          color: '#fff',
          fontSize: '0.85rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem'
        }}>
          {bulkBusy ? <Loader2 size={18} className="spin" style={{ color: 'var(--accent-light)' }} /> : <CheckCircle2 size={18} style={{ color: 'var(--status-success)' }} />}
          <span>{bulkBusy || toastMessage}</span>
        </div>
      )}

      {/* Save Preset Modal */}
      {showPresetModal && (
        <div style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--accent-primary)',
          borderRadius: 'var(--radius-md)',
          padding: '1.25rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '1rem'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#fff' }}>
            <Bookmark size={18} style={{ color: 'var(--accent-light)' }} />
            <h3 style={{ fontSize: '1rem', fontWeight: 700 }}>Save Preset Profile</h3>
          </div>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            Save current selection ({selectedRepoIds.size} repos, {selectedPluginNames.size} extensions) as a reusable preset profile.
          </p>
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <input
              type="text"
              placeholder="Preset Name (e.g. My Favorite Scrapers)..."
              value={newPresetName}
              onChange={(e) => setNewPresetName(e.target.value)}
              style={{
                flex: 1,
                padding: '0.5rem 0.8rem',
                backgroundColor: 'var(--bg-input)',
                border: '1px solid var(--border-color)',
                borderRadius: 'var(--radius-md)',
                color: '#fff',
                fontSize: '0.85rem'
              }}
            />
            <button onClick={handleSavePreset} className="btn btn-primary" style={{ fontSize: '0.8rem' }}>
              Save Preset
            </button>
            <button onClick={() => setShowPresetModal(false)} className="btn btn-secondary" style={{ fontSize: '0.8rem' }}>
              Cancel
            </button>
          </div>

          {savedPresets.length > 0 && (
            <div style={{ marginTop: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 600 }}>Your Saved Presets:</span>
              {savedPresets.map((p) => (
                <div key={p.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.4rem 0.6rem', background: 'var(--bg-input)', borderRadius: 'var(--radius-sm)' }}>
                  <span style={{ fontSize: '0.8rem', color: '#fff' }}>⭐ {p.name} ({p.repoIds.length} repos)</span>
                  <button
                    onClick={() => handleDeletePreset(p.id, p.name)}
                    className="btn btn-danger"
                    style={{ padding: '0.2rem 0.5rem', fontSize: '0.72rem' }}
                  >
                    <Trash2 size={12} />
                    <span>Delete</span>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Custom Repository URL Input Bar */}
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
          disabled={Boolean(bulkBusy)}
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
        <button onClick={() => handleFetchRepo()} disabled={Boolean(bulkBusy)} className="btn btn-primary">
          <Plus size={16} />
          <span>Add Custom Repo</span>
        </button>
      </div>

      {/* Official 26 Repositories Catalog Section */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#fff' }}>
            <Layers size={18} style={{ color: 'var(--accent-light)' }} />
            <h3 style={{ fontSize: '1.05rem', fontWeight: 700 }}>
              Repositories Catalogue ({safeOfficialRepos.length})
            </h3>
            {selectedRepoIds.size > 0 && (
              <span className="poster-badge" style={{ position: 'static', background: 'rgba(59, 130, 246, 0.2)', color: 'var(--accent-light)' }}>
                {selectedRepoIds.size} selected
              </span>
            )}
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

        {/* Repository Selection & Bulk Operations Control Bar */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '0.75rem',
          background: 'var(--bg-card)',
          padding: '0.75rem 1rem',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--border-color)'
        }}>
          {/* Select Quick Buttons */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', fontSize: '0.78rem' }}>
            <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>Select Repos:</span>
            <button onClick={() => selectAllRepos('all')} className="btn btn-secondary" style={{ padding: '0.25rem 0.5rem', fontSize: '0.72rem' }}>
              Select All
            </button>
            <button onClick={() => selectAllRepos('active')} className="btn btn-secondary" style={{ padding: '0.25rem 0.5rem', fontSize: '0.72rem' }}>
              Active Only
            </button>
            <button onClick={() => selectAllRepos('inactive')} className="btn btn-secondary" style={{ padding: '0.25rem 0.5rem', fontSize: '0.72rem' }}>
              Inactive Only
            </button>
            {selectedRepoIds.size > 0 && (
              <button onClick={() => selectAllRepos('none')} className="btn btn-secondary" style={{ padding: '0.25rem 0.5rem', fontSize: '0.72rem' }}>
                Clear
              </button>
            )}
          </div>

          {/* Bulk Action Buttons for Selected Repos */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            {selectedRepoIds.size > 0 ? (
              <>
                <button
                  onClick={handleBulkAddRepos}
                  disabled={Boolean(bulkBusy)}
                  className="btn btn-primary"
                  style={{ fontSize: '0.78rem', padding: '0.4rem 0.8rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}
                >
                  <Plus size={14} />
                  <span>Activate Selected ({selectedRepoIds.size})</span>
                </button>

                <button
                  onClick={handleBulkSyncRepos}
                  disabled={Boolean(bulkBusy)}
                  className="btn btn-secondary"
                  style={{ fontSize: '0.78rem', padding: '0.4rem 0.8rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}
                >
                  <RefreshCw size={14} />
                  <span>Sync Selected ({selectedRepoIds.size})</span>
                </button>

                <button
                  onClick={handleBulkDeactivateRepos}
                  disabled={Boolean(bulkBusy)}
                  className="btn btn-danger"
                  style={{ fontSize: '0.78rem', padding: '0.4rem 0.8rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}
                >
                  <Trash2 size={14} />
                  <span>Deactivate Selected ({selectedRepoIds.size})</span>
                </button>
              </>
            ) : (
              <button
                onClick={handleBulkSyncRepos}
                disabled={Boolean(bulkBusy)}
                className="btn btn-secondary"
                style={{ fontSize: '0.78rem', padding: '0.4rem 0.8rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}
              >
                <RefreshCw size={14} />
                <span>Sync All Active Repos</span>
              </button>
            )}
          </div>
        </div>

        {/* Repository Cards Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '1rem' }}>
          {filteredOfficialRepos.map((repo) => {
            const isAdded =
              repo &&
              (installedRepoUrls.has(repo.rawRepoUrl) || installedRepoUrls.has(repo.url));
            const isSelected = selectedRepoIds.has(repo.id);
            const isConfirmingRepo =
              repo && (confirmRemoveRepo === repo.rawRepoUrl || confirmRemoveRepo === repo.url);

            return (
              <div
                key={repo.id}
                style={{
                  background: 'var(--bg-card)',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid',
                  borderColor: isSelected
                    ? 'var(--accent-primary)'
                    : isAdded
                    ? 'rgba(59, 130, 246, 0.4)'
                    : 'var(--border-color)',
                  padding: '1.25rem',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  gap: '1rem',
                  position: 'relative'
                }}
              >
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                    <div
                      onClick={() => toggleSelectRepo(repo.id)}
                      style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}
                    >
                      {isSelected ? (
                        <CheckSquare size={18} style={{ color: 'var(--accent-light)' }} />
                      ) : (
                        <Square size={18} style={{ color: 'var(--text-subtle)' }} />
                      )}
                      <h4 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#fff' }}>{repo.name}</h4>
                    </div>
                    <span className="poster-badge" style={{ position: 'static' }}>{repo.category}</span>
                  </div>

                  <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', lineHeight: 1.4 }}>
                    {repo.description}
                  </p>

                  <div style={{ display: 'flex', gap: '1rem', marginTop: '0.75rem', fontSize: '0.72rem', color: 'var(--text-subtle)' }}>
                    <span>Language: <strong>{repo.language}</strong></span>
                    <span title={repo.rawRepoUrl}>
                      {repo.verified ? (
                        <strong style={{ color: 'var(--status-success)' }}>Reachable</strong>
                      ) : (
                        <strong style={{ color: 'var(--status-warning, #d19a2f)' }}>Unverified link</strong>
                      )}
                    </span>
                    {isAdded && (
                      <span style={{ color: 'var(--status-success)', fontWeight: 600 }}>Active</span>
                    )}
                  </div>
                </div>

                {isConfirmingRepo ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', width: '100%' }}>
                    <span style={{ fontSize: '0.75rem', color: '#ff6b6b', flex: 1, fontWeight: 600 }}>Deactivate repo?</span>
                    <button
                      onClick={() => handleRemoveRepo(repo.rawRepoUrl, repo.name)}
                      className="btn btn-danger"
                      style={{ fontSize: '0.75rem', padding: '0.35rem 0.65rem', cursor: 'pointer' }}
                    >
                      <Trash2 size={13} />
                      <span>Deactivate</span>
                    </button>
                    <button
                      onClick={() => setConfirmRemoveRepo(null)}
                      className="btn btn-secondary"
                      style={{ fontSize: '0.75rem', padding: '0.35rem 0.65rem', cursor: 'pointer' }}
                    >
                      <span>Cancel</span>
                    </button>
                  </div>
                ) : isAdded ? (
                  <div style={{ display: 'flex', gap: '0.5rem', width: '100%' }}>
                    <button
                      onClick={() => handleFetchRepo(repo.rawRepoUrl, repo.name)}
                      className="btn btn-secondary"
                      style={{ flex: 1, fontSize: '0.78rem', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem' }}
                      title="Fetch & update extension list from this repository"
                    >
                      <RefreshCw size={14} />
                      <span>Sync</span>
                    </button>
                    <button
                      onClick={() => setConfirmRemoveRepo(repo.rawRepoUrl)}
                      className="btn btn-secondary"
                      style={{
                        flex: 1,
                        fontSize: '0.78rem',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '0.4rem',
                        color: '#ff6b6b',
                        borderColor: 'rgba(255,107,107,0.3)'
                      }}
                      title="Deactivate and uninstall this repository"
                    >
                      <Trash2 size={14} />
                      <span>Deactivate</span>
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => handleFetchRepo(repo.rawRepoUrl, repo.name)}
                    className="btn btn-primary"
                    style={{ fontSize: '0.8rem', width: '100%', cursor: 'pointer' }}
                  >
                    <Plus size={15} />
                    <span>Add Repository</span>
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Custom Installed Repositories Section */}
      {(() => {
        const customRepoUrls = Array.from(installedRepoUrls).filter(
          (url) => !safeOfficialRepos.some((r) => r.rawRepoUrl === url || r.url === url)
        );
        if (customRepoUrls.length === 0) return null;

        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#fff' }}>
              <Globe size={18} style={{ color: 'var(--accent-light)' }} />
              <h3 style={{ fontSize: '1.05rem', fontWeight: 700 }}>Custom Added Repositories ({customRepoUrls.length})</h3>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '1rem' }}>
              {customRepoUrls.map((url) => {
                const isConfirming = confirmRemoveRepo === url;

                return (
                  <div
                    key={url}
                    style={{
                      background: 'var(--bg-card)',
                      borderRadius: 'var(--radius-md)',
                      border: '1px solid rgba(59, 130, 246, 0.4)',
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
                          <h4 style={{ fontSize: '0.88rem', fontWeight: 600, color: '#fff', wordBreak: 'break-all' }}>{url}</h4>
                        </div>
                        <span className="poster-badge" style={{ position: 'static' }}>Custom</span>
                      </div>
                    </div>

                    {isConfirming ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', width: '100%' }}>
                        <span style={{ fontSize: '0.75rem', color: '#ff6b6b', flex: 1, fontWeight: 600 }}>Deactivate custom repo?</span>
                        <button
                          onClick={() => handleRemoveRepo(url, 'Custom Repository')}
                          className="btn btn-danger"
                          style={{ fontSize: '0.75rem', padding: '0.35rem 0.65rem', cursor: 'pointer' }}
                        >
                          <Trash2 size={13} />
                          <span>Deactivate</span>
                        </button>
                        <button
                          onClick={() => setConfirmRemoveRepo(null)}
                          className="btn btn-secondary"
                          style={{ fontSize: '0.75rem', padding: '0.35rem 0.65rem', cursor: 'pointer' }}
                        >
                          <span>Cancel</span>
                        </button>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: '0.5rem', width: '100%' }}>
                        <button
                          onClick={() => handleFetchRepo(url, 'Custom Repo')}
                          className="btn btn-secondary"
                          style={{ flex: 1, fontSize: '0.78rem', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem' }}
                        >
                          <RefreshCw size={14} />
                          <span>Sync</span>
                        </button>
                        <button
                          onClick={() => setConfirmRemoveRepo(url)}
                          className="btn btn-secondary"
                          style={{
                            flex: 1,
                            fontSize: '0.78rem',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '0.4rem',
                            color: '#ff6b6b',
                            borderColor: 'rgba(255,107,107,0.3)'
                          }}
                        >
                          <Trash2 size={14} />
                          <span>Deactivate</span>
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

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

      {/* Extension Cards Section & Bulk Actions Toolbar */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#fff' }}>
            <Puzzle size={18} style={{ color: 'var(--accent-light)' }} />
            <h3 style={{ fontSize: '1.05rem', fontWeight: 700 }}>
              Available Extensions ({safePlugins.length})
            </h3>
            {selectedPluginNames.size > 0 && (
              <span className="poster-badge" style={{ position: 'static', background: 'rgba(59, 130, 246, 0.2)', color: 'var(--accent-light)' }}>
                {selectedPluginNames.size} selected
              </span>
            )}
          </div>

          {/* Extension Quick Selection Controls */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', fontSize: '0.78rem' }}>
            <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>Select Extensions:</span>
            <button onClick={() => selectAllPlugins('all')} className="btn btn-secondary" style={{ padding: '0.25rem 0.5rem', fontSize: '0.72rem' }}>
              Select All
            </button>
            <button onClick={() => selectAllPlugins('installed')} className="btn btn-secondary" style={{ padding: '0.25rem 0.5rem', fontSize: '0.72rem' }}>
              Installed Only
            </button>
            <button onClick={() => selectAllPlugins('uninstalled')} className="btn btn-secondary" style={{ padding: '0.25rem 0.5rem', fontSize: '0.72rem' }}>
              Uninstalled Only
            </button>
            {selectedPluginNames.size > 0 && (
              <button onClick={() => selectAllPlugins('none')} className="btn btn-secondary" style={{ padding: '0.25rem 0.5rem', fontSize: '0.72rem' }}>
                Clear
              </button>
            )}
          </div>
        </div>

        {/* Extension Bulk Operations Action Bar */}
        {selectedPluginNames.size > 0 && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.6rem',
            flexWrap: 'wrap',
            background: 'var(--bg-card)',
            padding: '0.75rem 1rem',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--accent-primary)',
            marginBottom: '1rem'
          }}>
            <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#fff' }}>
              Bulk Actions ({selectedPluginNames.size} items):
            </span>

            <button
              onClick={handleBulkInstallPlugins}
              disabled={Boolean(bulkBusy)}
              className="btn btn-primary"
              style={{ fontSize: '0.78rem', padding: '0.4rem 0.8rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}
            >
              <Download size={14} />
              <span>Install Selected</span>
            </button>

            <button
              onClick={handleBulkUpdatePlugins}
              disabled={Boolean(bulkBusy)}
              className="btn btn-secondary"
              style={{ fontSize: '0.78rem', padding: '0.4rem 0.8rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}
            >
              <RefreshCw size={14} />
              <span>Update Selected</span>
            </button>

            <button
              onClick={handleBulkUninstallPlugins}
              disabled={Boolean(bulkBusy)}
              className="btn btn-danger"
              style={{ fontSize: '0.78rem', padding: '0.4rem 0.8rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}
            >
              <Trash2 size={14} />
              <span>Uninstall Selected</span>
            </button>
          </div>
        )}

        {/* Extension Cards Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1rem' }}>
          {safePlugins.map((plugin, idx) => {
            const isInstalled = plugin.internalName ? installedPluginNames.has(plugin.internalName) : false;
            const isSelected = plugin.internalName ? selectedPluginNames.has(plugin.internalName) : false;
            const isBusy = busy === plugin.internalName;
            const isConfirming = confirmRemove === plugin.internalName;

            return (
              <div
                key={plugin.internalName || idx}
                style={{
                  background: 'var(--bg-card)',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid',
                  borderColor: isSelected
                    ? 'var(--accent-primary)'
                    : isInstalled
                    ? 'rgba(16, 185, 129, 0.4)'
                    : 'var(--border-color)',
                  padding: '1.25rem',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  gap: '1rem',
                  position: 'relative'
                }}
              >
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
                    <div
                      onClick={() => plugin.internalName && toggleSelectPlugin(plugin.internalName)}
                      style={{ cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                    >
                      {isSelected ? (
                        <CheckSquare size={18} style={{ color: 'var(--accent-light)' }} />
                      ) : (
                        <Square size={18} style={{ color: 'var(--text-subtle)' }} />
                      )}
                    </div>
                    <div style={{
                      width: '32px',
                      height: '32px',
                      borderRadius: 'var(--radius-sm)',
                      background: 'var(--bg-input)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: isInstalled ? 'var(--status-success)' : 'var(--accent-light)'
                    }}>
                      <Puzzle size={18} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <h4 style={{ fontSize: '0.95rem', fontWeight: 600, color: '#fff' }}>{plugin.name}</h4>
                      <span style={{ fontSize: '0.72rem', color: 'var(--text-subtle)' }}>v{plugin.version} • {plugin.internalName}</span>
                    </div>
                  </div>

                  <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                    {plugin.description || 'Community media provider extension'}
                  </p>
                </div>

                {isBusy ? (
                  <div className="ext-actions ext-actions--busy">
                    <Loader2 size={14} className="spin" />
                    <span>Working…</span>
                  </div>
                ) : isConfirming ? (
                  <div className="ext-actions">
                    <span className="ext-actions__ask">Remove {plugin.name}?</span>
                    <button
                      onClick={() => handleUninstall(plugin)}
                      className="btn btn-danger ext-actions__btn"
                    >
                      <Trash2 size={14} />
                      <span>Remove</span>
                    </button>
                    <button
                      onClick={() => setConfirmRemove(null)}
                      className="btn btn-secondary ext-actions__btn"
                    >
                      <span>Cancel</span>
                    </button>
                  </div>
                ) : isInstalled ? (
                  <div className="ext-actions">
                    <span className="ext-actions__state">
                      <CheckCircle2 size={13} /> Installed
                    </span>
                    <button
                      onClick={() => handleUpdate(plugin)}
                      className="btn btn-secondary ext-actions__btn"
                      title="Check the repository for a newer version"
                    >
                      <RefreshCw size={13} />
                      <span>Update</span>
                    </button>
                    <button
                      onClick={() => handleReinstall(plugin)}
                      className="btn btn-secondary ext-actions__btn"
                      title="Download and translate this version again"
                    >
                      <RotateCcw size={13} />
                      <span>Reinstall</span>
                    </button>
                    <button
                      onClick={() => setConfirmRemove(plugin.internalName)}
                      className="btn btn-secondary ext-actions__btn ext-actions__btn--danger"
                      title="Uninstall this extension"
                    >
                      <Trash2 size={13} />
                    </button>
                    <button
                      onClick={() => handleAnalyze(plugin)}
                      className="btn btn-secondary ext-actions__btn"
                      title="Compatibility report"
                    >
                      <ShieldCheck size={13} />
                    </button>
                  </div>
                ) : (
                  <div className="ext-actions">
                    <button
                      onClick={() => handleAnalyze(plugin)}
                      className="btn btn-secondary ext-actions__btn"
                      style={{ flex: 1 }}
                    >
                      <ShieldCheck size={14} />
                      <span>Analyze</span>
                    </button>
                    <button
                      onClick={() => handleInstallPlugin(plugin)}
                      className="btn btn-primary ext-actions__btn"
                      style={{ flex: 1 }}
                    >
                      <Download size={14} />
                      <span>Install</span>
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
