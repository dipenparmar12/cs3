import React, { useEffect, useState } from 'react';
import type { SitePlugin, PluginCompatibilityReport, ProviderTreeRepository } from '../types/plugin';
import type { OfficialRepository } from '../../electron/officialRepositories';
import {
  Puzzle, Plus, Download, ShieldCheck, Globe, CheckCircle2, Layers,
  Loader2, RefreshCw, RotateCcw, Trash2, Square, CheckSquare, Bookmark, Sparkles,
  Search, ChevronDown, ChevronRight, ToggleLeft, ToggleRight
} from 'lucide-react';
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
  const [activeTab, setActiveTab] = useState<'hierarchy' | 'catalog' | 'extensions'>('hierarchy');
  const [searchQuery, setSearchQuery] = useState('');
  const [installedRepoUrls, setInstalledRepoUrls] = useState<Set<string>>(new Set());
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const [plugins, setPlugins] = useState<SitePlugin[]>([]);
  const [installedPluginNames, setInstalledPluginNames] = useState<Set<string>>(new Set());
  const [activeReport, setActiveReport] = useState<PluginCompatibilityReport | null>(null);

  // Hierarchy Tree State
  const [providerTree, setProviderTree] = useState<ProviderTreeRepository[]>([]);
  const [disabledProviders, setDisabledProviders] = useState<Set<string>>(new Set());
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set(['repo_all', 'ext_all']));

  const [busy, setBusy] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [confirmRemoveRepo, setConfirmRemoveRepo] = useState<string | null>(null);

  // Multi-selection state for Repositories & Extensions
  const [selectedRepoIds, setSelectedRepoIds] = useState<Set<string>>(new Set());
  const [selectedPluginNames, setSelectedPluginNames] = useState<Set<string>>(new Set());
  const [selectedProviderNames, setSelectedProviderNames] = useState<Set<string>>(new Set());
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

  const loadHierarchyData = async () => {
    if (window.cloudstream) {
      try {
        const res = await window.cloudstream.getProviderTree();
        if (res?.ok && Array.isArray(res.tree)) {
          setProviderTree(res.tree);
        }
      } catch (err) {
        console.warn('Could not load provider tree:', err);
      }

      try {
        const pRes = await window.cloudstream.getExtensionProviders();
        if (pRes?.ok && Array.isArray(pRes.disabled)) {
          setDisabledProviders(new Set(pRes.disabled));
        }
      } catch (err) {
        console.warn('Could not load disabled providers:', err);
      }
    }
  };

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

      loadHierarchyData();
    }
  }, []);

  const safeOfficialRepos = Array.isArray(officialRepos) ? officialRepos.filter(Boolean) : [];
  const filteredOfficialRepos = safeOfficialRepos.filter((r) => {
    const matchesCategory = activeCategory === 'All' || r.category === activeCategory;
    const matchesSearch = !searchQuery || r.name.toLowerCase().includes(searchQuery.toLowerCase()) || r.description.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  const safePlugins = Array.isArray(plugins) ? plugins.filter(Boolean) : [];
  const filteredPlugins = safePlugins.filter((p) => {
    if (!searchQuery) return true;
    return (
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.internalName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (p.description && p.description.toLowerCase().includes(searchQuery.toLowerCase()))
    );
  });

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

        await loadHierarchyData();

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
      await loadHierarchyData();
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
        await loadHierarchyData();
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
      await loadHierarchyData();
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
      await loadHierarchyData();
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
        await loadHierarchyData();
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

  const handleToggleProvider = async (providerName: string, enabled: boolean) => {
    if (!window.cloudstream) return;
    try {
      const nextDisabled = await window.cloudstream.setProviderEnabled(providerName, enabled);
      setDisabledProviders(new Set(nextDisabled));
    } catch (err) {
      console.error('Failed to toggle provider:', err);
    }
  };

  const handleToggleProvidersBulk = async (providerNames: string[], enabled: boolean) => {
    if (!window.cloudstream || providerNames.length === 0) return;
    try {
      const nextDisabled = await window.cloudstream.setProvidersEnabled(providerNames, enabled);
      setDisabledProviders(new Set(nextDisabled));
      setToastMessage(`✓ ${enabled ? 'Enabled' : 'Disabled'} ${providerNames.length} provider(s)`);
      setTimeout(() => setToastMessage(null), 3000);
    } catch (err) {
      console.error('Failed bulk toggle providers:', err);
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
    await loadHierarchyData();
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
    await loadHierarchyData();
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
    await loadHierarchyData();
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
    await loadHierarchyData();
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
    await loadHierarchyData();
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
      await loadHierarchyData();
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
    await loadHierarchyData();
    setToastMessage(`✓ Applied preset "${presetName}" (${count} repositories synced)!`);
    setBulkBusy(null);
    setTimeout(() => setToastMessage(null), 5000);
  };

  const toggleExpandNode = (id: string) => {
    setExpandedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const totalSelectionCount = selectedRepoIds.size + selectedPluginNames.size + selectedProviderNames.size;

  const clearAllSelections = () => {
    setSelectedRepoIds(new Set());
    setSelectedPluginNames(new Set());
    setSelectedProviderNames(new Set());
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', paddingBottom: totalSelectionCount > 0 ? '5rem' : '1.5rem' }}>
      {/* Top Header & Preset Toolbar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h2 style={{ fontSize: '1.3rem', fontWeight: 700, color: '#fff', display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <Layers size={22} style={{ color: 'var(--accent-light)' }} />
            <span>Extension & Repository Manager</span>
          </h2>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            Complete lineage: Repositories ➔ Extensions ➔ Individual Scraper Providers
          </p>
        </div>

        {/* Presets & Custom Preset Controls */}
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

          {totalSelectionCount > 0 && (
            <button
              onClick={() => setShowPresetModal(true)}
              className="btn btn-secondary"
              style={{ fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}
            >
              <Bookmark size={14} />
              <span>Save Preset</span>
            </button>
          )}
        </div>
      </div>

      {/* Main View Mode Selector Tabs & Global Search Bar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '0.75rem',
        background: 'var(--bg-card)',
        padding: '0.6rem 1rem',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--border-color)'
      }}>
        {/* Navigation Tabs */}
        <div style={{ display: 'flex', gap: '0.4rem' }}>
          <button
            onClick={() => setActiveTab('hierarchy')}
            className={`btn ${activeTab === 'hierarchy' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ fontSize: '0.8rem', padding: '0.4rem 0.85rem', display: 'flex', alignItems: 'center', gap: '0.45rem' }}
          >
            <Layers size={15} />
            <span>Hierarchy Tree View</span>
          </button>

          <button
            onClick={() => setActiveTab('catalog')}
            className={`btn ${activeTab === 'catalog' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ fontSize: '0.8rem', padding: '0.4rem 0.85rem', display: 'flex', alignItems: 'center', gap: '0.45rem' }}
          >
            <Globe size={15} />
            <span>Repositories Catalogue ({safeOfficialRepos.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('extensions')}
            className={`btn ${activeTab === 'extensions' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ fontSize: '0.8rem', padding: '0.4rem 0.85rem', display: 'flex', alignItems: 'center', gap: '0.45rem' }}
          >
            <Puzzle size={15} />
            <span>All Extensions Grid ({safePlugins.length})</span>
          </button>
        </div>

        {/* Global Search Bar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 1, maxWidth: '320px', minWidth: '200px' }}>
          <div style={{
            position: 'relative',
            width: '100%',
            display: 'flex',
            alignItems: 'center'
          }}>
            <Search size={14} style={{ position: 'absolute', left: '0.75rem', color: 'var(--text-subtle)' }} />
            <input
              type="text"
              placeholder="Search repos, extensions, providers..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                width: '100%',
                padding: '0.4rem 0.75rem 0.4rem 2.1rem',
                backgroundColor: 'var(--bg-input)',
                border: '1px solid var(--border-color)',
                borderRadius: 'var(--radius-md)',
                color: '#fff',
                fontSize: '0.8rem'
              }}
            />
          </div>
        </div>
      </div>

      <ExtensionUpdates
        onUpdated={() => {
          loadHierarchyData();
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

      {/* Toast Notification Banner */}
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

      {/* Save Preset Profile Modal */}
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
            <h3 style={{ fontSize: '1rem', fontWeight: 700 }}>Save Custom Preset Profile</h3>
          </div>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            Save current selection ({selectedRepoIds.size} repos, {selectedPluginNames.size} extensions, {selectedProviderNames.size} providers) as a reusable preset.
          </p>
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <input
              type="text"
              placeholder="Preset Profile Name..."
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
              Save Profile
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

      {/* ========================================================================= */}
      {/* VIEW MODE 1: HIERARCHY TREE VIEW (Repository ➔ Extension ➔ Provider)     */}
      {/* ========================================================================= */}
      {activeTab === 'hierarchy' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'var(--bg-card)',
            padding: '0.85rem 1.25rem',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border-color)',
            flexWrap: 'wrap',
            gap: '0.75rem'
          }}>
            <div>
              <h3 style={{ fontSize: '1rem', fontWeight: 700, color: '#fff' }}>
                Provider Lineage Tree ({providerTree.length} Active Repositories)
              </h3>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                Inspect exactly which scraper provider originated from which .cs3 extension archive
              </p>
            </div>

            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                onClick={() => {
                  const ids = new Set<string>();
                  providerTree.forEach((repo, rIdx) => {
                    ids.add(`repo_${rIdx}`);
                    repo.extensions.forEach((ext) => ids.add(`ext_${ext.internalName}`));
                  });
                  setExpandedNodes(ids);
                }}
                className="btn btn-secondary"
                style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem' }}
              >
                Expand All
              </button>
              <button
                onClick={() => setExpandedNodes(new Set())}
                className="btn btn-secondary"
                style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem' }}
              >
                Collapse All
              </button>
            </div>
          </div>

          {providerTree.length === 0 ? (
            <div style={{
              background: 'var(--bg-card)',
              padding: '2.5rem',
              textAlign: 'center',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-color)',
              color: 'var(--text-muted)'
            }}>
              <Layers size={36} style={{ color: 'var(--accent-light)', marginBottom: '0.75rem' }} />
              <p style={{ fontSize: '0.95rem', fontWeight: 600, color: '#fff' }}>No Active Repositories Loaded Yet</p>
              <p style={{ fontSize: '0.8rem', marginTop: '0.25rem' }}>
                Activate a repository from the <strong>Repositories Catalogue</strong> tab to see its extension & provider tree.
              </p>
              <button
                onClick={() => setActiveTab('catalog')}
                className="btn btn-primary"
                style={{ marginTop: '1rem', fontSize: '0.82rem' }}
              >
                Browse Repositories Catalogue
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {providerTree.map((repoTree, repoIdx) => {
                const repoNodeId = `repo_${repoIdx}`;
                const isRepoExpanded = expandedNodes.has(repoNodeId);

                const allRepoProviders = repoTree.extensions.flatMap((e) => e.providers.map((p) => p.name));
                const allRepoEnabled = allRepoProviders.every((p) => !disabledProviders.has(p));

                return (
                  <div
                    key={repoNodeId}
                    style={{
                      background: 'var(--bg-card)',
                      borderRadius: 'var(--radius-md)',
                      border: '1px solid var(--border-color)',
                      overflow: 'hidden'
                    }}
                  >
                    {/* Repository Level Node Row */}
                    <div style={{
                      padding: '0.85rem 1.25rem',
                      background: 'rgba(255, 255, 255, 0.02)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      borderBottom: isRepoExpanded ? '1px solid var(--border-color)' : 'none'
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flex: 1 }}>
                        <button
                          onClick={() => toggleExpandNode(repoNodeId)}
                          style={{ background: 'transparent', border: 'none', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                        >
                          {isRepoExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                        </button>

                        <Globe size={18} style={{ color: 'var(--accent-light)' }} />
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <h4 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#fff' }}>{repoTree.name}</h4>
                            <span className="poster-badge" style={{ position: 'static' }}>
                              {repoTree.extensions.length} extension(s) • {allRepoProviders.length} provider(s)
                            </span>
                          </div>
                          <span style={{ fontSize: '0.72rem', color: 'var(--text-subtle)', wordBreak: 'break-all' }}>{repoTree.url}</span>
                        </div>
                      </div>

                      {/* Repository Actions */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        {allRepoProviders.length > 0 && (
                          <button
                            onClick={() => handleToggleProvidersBulk(allRepoProviders, !allRepoEnabled)}
                            className="btn btn-secondary"
                            style={{ fontSize: '0.72rem', padding: '0.25rem 0.55rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}
                            title={allRepoEnabled ? 'Disable all providers in this repo' : 'Enable all providers in this repo'}
                          >
                            {allRepoEnabled ? <ToggleRight size={14} style={{ color: 'var(--status-success)' }} /> : <ToggleLeft size={14} />}
                            <span>{allRepoEnabled ? 'All ON' : 'Toggle ON'}</span>
                          </button>
                        )}

                        <button
                          onClick={() => handleFetchRepo(repoTree.url, repoTree.name)}
                          className="btn btn-secondary"
                          style={{ fontSize: '0.72rem', padding: '0.25rem 0.55rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}
                        >
                          <RefreshCw size={13} />
                          <span>Sync</span>
                        </button>

                        <button
                          onClick={() => handleRemoveRepo(repoTree.url, repoTree.name)}
                          className="btn btn-secondary"
                          style={{ fontSize: '0.72rem', padding: '0.25rem 0.55rem', color: '#ff6b6b', display: 'flex', alignItems: 'center', gap: '0.3rem' }}
                        >
                          <Trash2 size={13} />
                          <span>Deactivate</span>
                        </button>
                      </div>
                    </div>

                    {/* Extension Archive Level Children */}
                    {isRepoExpanded && (
                      <div style={{ padding: '0.75rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '0.75rem', backgroundColor: 'rgba(0, 0, 0, 0.15)' }}>
                        {repoTree.extensions.map((ext) => {
                          const extNodeId = `ext_${ext.internalName}`;
                          const isExtExpanded = expandedNodes.has(extNodeId);
                          const extProviders = ext.providers.map((p) => p.name);
                          const extAllEnabled = extProviders.length > 0 && extProviders.every((p) => !disabledProviders.has(p));
                          const pluginMeta = safePlugins.find((p) => p.internalName === ext.internalName);

                          return (
                            <div
                              key={ext.internalName}
                              style={{
                                background: 'var(--bg-card)',
                                border: '1px solid var(--border-color)',
                                borderRadius: 'var(--radius-sm)',
                                overflow: 'hidden'
                              }}
                            >
                              {/* Extension Row */}
                              <div style={{
                                padding: '0.65rem 1rem',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                background: 'rgba(255, 255, 255, 0.015)'
                              }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flex: 1 }}>
                                  <button
                                    onClick={() => toggleExpandNode(extNodeId)}
                                    style={{ background: 'transparent', border: 'none', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                                  >
                                    {isExtExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                                  </button>

                                  <div
                                    onClick={() => toggleSelectPlugin(ext.internalName)}
                                    style={{ cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                                  >
                                    {selectedPluginNames.has(ext.internalName) ? (
                                      <CheckSquare size={16} style={{ color: 'var(--accent-light)' }} />
                                    ) : (
                                      <Square size={16} style={{ color: 'var(--text-subtle)' }} />
                                    )}
                                  </div>

                                  <Puzzle size={16} style={{ color: 'var(--status-success)' }} />

                                  <div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                      <h5 style={{ fontSize: '0.88rem', fontWeight: 600, color: '#fff' }}>{ext.name}</h5>
                                      <span style={{ fontSize: '0.7rem', color: 'var(--text-subtle)' }}>({ext.internalName})</span>
                                      {ext.language && <span className="poster-badge" style={{ position: 'static', fontSize: '0.65rem' }}>{ext.language}</span>}
                                    </div>
                                  </div>
                                </div>

                                {/* Extension Actions */}
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                  {extProviders.length > 0 && (
                                    <button
                                      onClick={() => handleToggleProvidersBulk(extProviders, !extAllEnabled)}
                                      className="btn btn-secondary"
                                      style={{ fontSize: '0.7rem', padding: '0.2rem 0.5rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}
                                    >
                                      {extAllEnabled ? <ToggleRight size={13} style={{ color: 'var(--status-success)' }} /> : <ToggleLeft size={13} />}
                                      <span>{extProviders.length} Providers</span>
                                    </button>
                                  )}

                                  {pluginMeta && (
                                    <>
                                      <button
                                        onClick={() => handleUpdate(pluginMeta)}
                                        className="btn btn-secondary"
                                        style={{ fontSize: '0.7rem', padding: '0.2rem 0.4rem' }}
                                        title="Update extension"
                                      >
                                        <RefreshCw size={12} />
                                      </button>

                                      <button
                                        onClick={() => handleUninstall(pluginMeta)}
                                        className="btn btn-secondary"
                                        style={{ fontSize: '0.7rem', padding: '0.2rem 0.4rem', color: '#ff6b6b' }}
                                        title="Uninstall extension"
                                      >
                                        <Trash2 size={12} />
                                      </button>
                                    </>
                                  )}
                                </div>
                              </div>

                              {/* Individual Registered Scraper Providers Sub-Level */}
                              {isExtExpanded && (
                                <div style={{ padding: '0.5rem 1rem 0.75rem 2.5rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '0.5rem', background: 'rgba(0,0,0,0.2)' }}>
                                  {ext.providers.length === 0 ? (
                                    <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>No providers registered yet (archive loading...)</p>
                                  ) : (
                                    ext.providers.map((p) => {
                                      const isDisabled = disabledProviders.has(p.name);
                                      const isProvSelected = selectedProviderNames.has(p.name);

                                      return (
                                        <div
                                          key={p.name}
                                          style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'space-between',
                                            padding: '0.4rem 0.6rem',
                                            borderRadius: 'var(--radius-sm)',
                                            background: 'var(--bg-input)',
                                            border: '1px solid',
                                            borderColor: isDisabled ? 'var(--border-color)' : 'rgba(16, 185, 129, 0.3)'
                                          }}
                                        >
                                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                            <div
                                              onClick={() => {
                                                setSelectedProviderNames((prev) => {
                                                  const next = new Set(prev);
                                                  if (next.has(p.name)) next.delete(p.name);
                                                  else next.add(p.name);
                                                  return next;
                                                });
                                              }}
                                              style={{ cursor: 'pointer' }}
                                            >
                                              {isProvSelected ? <CheckSquare size={14} style={{ color: 'var(--accent-light)' }} /> : <Square size={14} style={{ color: 'var(--text-subtle)' }} />}
                                            </div>
                                            <span style={{ fontSize: '0.8rem', fontWeight: 600, color: isDisabled ? 'var(--text-muted)' : '#fff' }}>
                                              {p.name}
                                            </span>
                                          </div>

                                          <button
                                            onClick={() => handleToggleProvider(p.name, isDisabled)}
                                            style={{ background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                                            title={isDisabled ? 'Enable Provider' : 'Disable Provider'}
                                          >
                                            {isDisabled ? (
                                              <ToggleLeft size={18} style={{ color: 'var(--text-subtle)' }} />
                                            ) : (
                                              <ToggleRight size={18} style={{ color: 'var(--status-success)' }} />
                                            )}
                                          </button>
                                        </div>
                                      );
                                    })
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* VIEW MODE 2: REPOSITORIES CATALOGUE GRID                                 */}
      {/* ========================================================================= */}
      {activeTab === 'catalog' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
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

          {/* Repository Controls Bar */}
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
      )}

      {/* ========================================================================= */}
      {/* VIEW MODE 3: ALL EXTENSIONS GRID                                          */}
      {/* ========================================================================= */}
      {activeTab === 'extensions' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {/* Extension Quick Selection Controls */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem' }}>
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

          {/* Extension Cards Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1rem' }}>
            {filteredPlugins.map((plugin, idx) => {
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
      )}

      {/* Active Compatibility Report Modal / Drawer */}
      {activeReport && (
        <div style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--accent-primary)',
          borderRadius: 'var(--radius-md)',
          padding: '1.25rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.75rem',
          marginTop: '1rem'
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

      {/* ========================================================================= */}
      {/* STICKY FLOATING BOTTOM BULK TOOLBAR (Always accessible on scroll!)       */}
      {/* ========================================================================= */}
      {totalSelectionCount > 0 && (
        <div style={{
          position: 'fixed',
          bottom: '1.25rem',
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 999,
          background: 'var(--bg-card)',
          border: '1px solid var(--accent-primary)',
          boxShadow: '0 10px 30px rgba(0, 0, 0, 0.5)',
          borderRadius: 'var(--radius-md)',
          padding: '0.75rem 1.25rem',
          display: 'flex',
          alignItems: 'center',
          gap: '1rem',
          flexWrap: 'wrap',
          maxWidth: '90vw'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#fff', fontSize: '0.82rem', fontWeight: 600 }}>
            <Sparkles size={16} style={{ color: 'var(--accent-light)' }} />
            <span>
              Selected: {selectedRepoIds.size > 0 && `${selectedRepoIds.size} repo(s) `}
              {selectedPluginNames.size > 0 && `${selectedPluginNames.size} extension(s) `}
              {selectedProviderNames.size > 0 && `${selectedProviderNames.size} provider(s)`}
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
            {selectedRepoIds.size > 0 && (
              <>
                <button
                  onClick={handleBulkAddRepos}
                  disabled={Boolean(bulkBusy)}
                  className="btn btn-primary"
                  style={{ fontSize: '0.75rem', padding: '0.35rem 0.7rem' }}
                >
                  <Plus size={13} />
                  <span>Activate Repos</span>
                </button>

                <button
                  onClick={handleBulkDeactivateRepos}
                  disabled={Boolean(bulkBusy)}
                  className="btn btn-danger"
                  style={{ fontSize: '0.75rem', padding: '0.35rem 0.7rem' }}
                >
                  <Trash2 size={13} />
                  <span>Deactivate Repos</span>
                </button>
              </>
            )}

            {selectedPluginNames.size > 0 && (
              <>
                <button
                  onClick={handleBulkInstallPlugins}
                  disabled={Boolean(bulkBusy)}
                  className="btn btn-primary"
                  style={{ fontSize: '0.75rem', padding: '0.35rem 0.7rem' }}
                >
                  <Download size={13} />
                  <span>Install Exts</span>
                </button>

                <button
                  onClick={handleBulkUpdatePlugins}
                  disabled={Boolean(bulkBusy)}
                  className="btn btn-secondary"
                  style={{ fontSize: '0.75rem', padding: '0.35rem 0.7rem' }}
                >
                  <RefreshCw size={13} />
                  <span>Update Exts</span>
                </button>

                <button
                  onClick={handleBulkUninstallPlugins}
                  disabled={Boolean(bulkBusy)}
                  className="btn btn-danger"
                  style={{ fontSize: '0.75rem', padding: '0.35rem 0.7rem' }}
                >
                  <Trash2 size={13} />
                  <span>Uninstall Exts</span>
                </button>
              </>
            )}

            {selectedProviderNames.size > 0 && (
              <>
                <button
                  onClick={() => handleToggleProvidersBulk(Array.from(selectedProviderNames), true)}
                  disabled={Boolean(bulkBusy)}
                  className="btn btn-secondary"
                  style={{ fontSize: '0.75rem', padding: '0.35rem 0.7rem' }}
                >
                  <ToggleRight size={13} style={{ color: 'var(--status-success)' }} />
                  <span>Enable Providers</span>
                </button>

                <button
                  onClick={() => handleToggleProvidersBulk(Array.from(selectedProviderNames), false)}
                  disabled={Boolean(bulkBusy)}
                  className="btn btn-secondary"
                  style={{ fontSize: '0.75rem', padding: '0.35rem 0.7rem' }}
                >
                  <ToggleLeft size={13} />
                  <span>Disable Providers</span>
                </button>
              </>
            )}

            <button
              onClick={() => setShowPresetModal(true)}
              className="btn btn-secondary"
              style={{ fontSize: '0.75rem', padding: '0.35rem 0.7rem' }}
            >
              <Bookmark size={13} />
              <span>Save Preset</span>
            </button>

            <button
              onClick={clearAllSelections}
              className="btn btn-secondary"
              style={{ fontSize: '0.75rem', padding: '0.35rem 0.6rem' }}
            >
              Clear
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
