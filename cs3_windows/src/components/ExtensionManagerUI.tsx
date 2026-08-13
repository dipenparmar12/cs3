import React, { useEffect, useState, useMemo, useCallback } from 'react';
import type { SitePlugin, PluginCompatibilityReport, ProviderTreeRepository } from '../types/plugin';
import type { OfficialRepository } from '../../electron/officialRepositories';
import {
  Puzzle, Plus, Download, ShieldCheck, Globe, CheckCircle2, Layers,
  Loader2, RefreshCw, RotateCcw, Trash2, Square, CheckSquare, Bookmark, Sparkles,
  Search, ChevronDown, ChevronRight, ToggleLeft, ToggleRight, Eye, Film, User, Minus, SlidersHorizontal
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

export interface InspectedMetadata {
  type: 'repo' | 'extension' | 'provider';
  title: string;
  internalName?: string;
  version?: number;
  authors?: string[];
  description?: string;
  category?: string;
  language?: string;
  tvTypes?: string[];
  url?: string;
  rawRepoUrl?: string;
  verified?: boolean;
  fileSize?: number;
  fileHash?: string;
  parentExtension?: string;
  parentRepo?: string;
  providersCount?: number;
  extensionsCount?: number;
  enabledProvidersCount?: number;
  disabledProvidersCount?: number;
  status?: string;
}

// Inline Detail Strip Component (No modals! Unfolds in-place right underneath card/row)
const InlineDetailStrip: React.FC<{
  details: InspectedMetadata;
}> = ({ details }) => {
  return (
    <div style={{
      marginTop: '0.55rem',
      padding: '0.65rem 0.85rem',
      background: 'rgba(0, 0, 0, 0.3)',
      borderLeft: '3px solid var(--accent-light)',
      borderRadius: '0 var(--radius-sm) var(--radius-sm) 0',
      display: 'flex',
      flexDirection: 'column',
      gap: '0.45rem',
      fontSize: '0.74rem',
      color: 'var(--text-main)',
      animation: 'fadeIn 0.15s ease'
    }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.5rem' }}>
        {details.internalName && <div><strong style={{ color: 'var(--text-muted)' }}>Internal ID:</strong> {details.internalName}</div>}
        {details.version !== undefined && <div><strong style={{ color: 'var(--text-muted)' }}>Version:</strong> v{details.version}</div>}
        {details.language && <div><strong style={{ color: 'var(--text-muted)' }}>Language:</strong> {details.language}</div>}
        {details.category && <div><strong style={{ color: 'var(--text-muted)' }}>Category:</strong> {details.category}</div>}
        {details.fileSize !== undefined && <div><strong style={{ color: 'var(--text-muted)' }}>Package Size:</strong> {(details.fileSize / 1024).toFixed(1)} KB</div>}
        {details.verified !== undefined && <div><strong style={{ color: 'var(--text-muted)' }}>Status:</strong> {details.verified ? 'Verified Upstream' : 'Community Link'}</div>}
        {details.parentRepo && <div><strong style={{ color: 'var(--text-muted)' }}>Origin Repo:</strong> {details.parentRepo}</div>}
        {details.parentExtension && <div><strong style={{ color: 'var(--text-muted)' }}>Parent Extension:</strong> {details.parentExtension}</div>}
        {details.status && <div><strong style={{ color: 'var(--text-muted)' }}>State:</strong> {details.status}</div>}
      </div>

      {Array.isArray(details.authors) && details.authors.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
          <User size={12} style={{ color: 'var(--text-subtle)' }} />
          <strong style={{ color: 'var(--text-muted)' }}>Maintainers:</strong>
          {details.authors.map((a, i) => (
            <span key={i} className="poster-badge" style={{ position: 'static', fontSize: '0.62rem' }}>{a}</span>
          ))}
        </div>
      )}

      {Array.isArray(details.tvTypes) && details.tvTypes.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
          <Film size={12} style={{ color: 'var(--text-subtle)' }} />
          <strong style={{ color: 'var(--text-muted)' }}>Supported Content Types:</strong>
          {details.tvTypes.map((t, i) => (
            <span key={i} className="poster-badge" style={{ position: 'static', fontSize: '0.62rem', backgroundColor: 'rgba(59,130,246,0.2)', color: 'var(--accent-light)' }}>{t}</span>
          ))}
        </div>
      )}

      {details.description && (
        <div style={{ color: 'var(--text-muted)', lineHeight: 1.4 }}>
          <strong>Description:</strong> {details.description}
        </div>
      )}

      {details.url && (
        <div style={{ color: 'var(--text-subtle)', wordBreak: 'break-all', fontSize: '0.7rem' }}>
          <strong>URL:</strong> {details.url}
        </div>
      )}
    </div>
  );
};

// Parent-Child Tri-State Checkbox Component
const TriStateCheckbox: React.FC<{
  state: 'checked' | 'unchecked' | 'indeterminate';
  onClick: () => void;
  size?: number;
  title?: string;
}> = ({ state, onClick, size = 16, title }) => {
  return (
    <div
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      title={title}
      style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', userSelect: 'none' }}
    >
      {state === 'checked' && <CheckSquare size={size} style={{ color: 'var(--accent-light)' }} />}
      {state === 'unchecked' && <Square size={size} style={{ color: 'var(--text-subtle)' }} />}
      {state === 'indeterminate' && (
        <div style={{
          width: size,
          height: size,
          borderRadius: '3px',
          border: '1px solid var(--accent-light)',
          background: 'rgba(59, 130, 246, 0.2)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--accent-light)'
        }}>
          <Minus size={size - 4} strokeWidth={3} />
        </div>
      )}
    </div>
  );
};

export const ExtensionManagerUI: React.FC = () => {
  const [repoUrlInput, setRepoUrlInput] = useState('');
  const [officialRepos, setOfficialRepos] = useState<OfficialRepository[]>([]);
  const [activeTab, setActiveTab] = useState<'hierarchy' | 'catalog' | 'extensions' | 'providers'>('hierarchy');
  
  // Filter States
  const [rawSearchQuery, setRawSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive' | 'installed' | 'uninstalled' | 'enabled' | 'disabled' | 'updates'>('all');
  const [languageFilter, setLanguageFilter] = useState<string>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');

  const [installedRepoUrls, setInstalledRepoUrls] = useState<Set<string>>(new Set());
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const [plugins, setPlugins] = useState<SitePlugin[]>([]);
  const [installedPluginNames, setInstalledPluginNames] = useState<Set<string>>(new Set());
  const [activeReport, setActiveReport] = useState<PluginCompatibilityReport | null>(null);

  // NO MODALS! Multiple Inline Details Expanded State
  const [expandedDetailIds, setExpandedDetailIds] = useState<Set<string>>(new Set());

  // Hierarchy Tree Expanded State
  const [providerTree, setProviderTree] = useState<ProviderTreeRepository[]>([]);
  const [disabledProviders, setDisabledProviders] = useState<Set<string>>(new Set());
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set(['repo_0', 'repo_1']));

  // Performance Progressive Limit
  const [visibleLimit, setVisibleLimit] = useState<number>(50);

  // In-Card Action Progress State
  const [taskProgressMap, setTaskProgressMap] = useState<Record<string, { step: string; percent: number }>>({});

  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [confirmRemoveRepo, setConfirmRemoveRepo] = useState<string | null>(null);

  // Multi-selection state
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

  const toggleDetail = (id: string) => {
    setExpandedDetailIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Debounce search input (150ms) for high FPS
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchQuery(rawSearchQuery);
      setVisibleLimit(50);
    }, 150);
    return () => clearTimeout(timer);
  }, [rawSearchQuery]);

  const loadHierarchyData = useCallback(async () => {
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
  }, []);

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
  }, [loadHierarchyData]);

  // Task Progress Helper
  const runProgressTask = async (id: string, steps: Array<{ step: string; percent: number; delay: number }>, action: () => Promise<void>) => {
    for (const s of steps) {
      setTaskProgressMap((prev) => ({ ...prev, [id]: { step: s.step, percent: s.percent } }));
      await new Promise((r) => setTimeout(r, s.delay));
    }
    try {
      await action();
      setTaskProgressMap((prev) => ({ ...prev, [id]: { step: '✓ Complete', percent: 100 } }));
      await new Promise((r) => setTimeout(r, 600));
    } finally {
      setTaskProgressMap((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }
  };

  const safeOfficialRepos = useMemo(() => Array.isArray(officialRepos) ? officialRepos.filter(Boolean) : [], [officialRepos]);
  const safePlugins = useMemo(() => Array.isArray(plugins) ? plugins.filter(Boolean) : [], [plugins]);

  // Derived Metrics Summary
  const metrics = useMemo(() => {
    const totalRepos = safeOfficialRepos.length;
    const activeRepos = installedRepoUrls.size;
    const totalExts = safePlugins.length;
    const installedExts = installedPluginNames.size;
    
    let totalProviders = 0;
    let enabledProviders = 0;

    providerTree.forEach((repo) => {
      repo.extensions.forEach((ext) => {
        ext.providers.forEach((p) => {
          totalProviders++;
          if (!disabledProviders.has(p.name)) enabledProviders++;
        });
      });
    });

    const disabledProvidersCount = totalProviders - enabledProviders;
    return { totalRepos, activeRepos, totalExts, installedExts, totalProviders, enabledProviders, disabledProvidersCount };
  }, [safeOfficialRepos, installedRepoUrls, safePlugins, installedPluginNames, providerTree, disabledProviders]);

  // Filtered Repository Data
  const filteredOfficialRepos = useMemo(() => {
    return safeOfficialRepos.filter((r) => {
      const isAdded = installedRepoUrls.has(r.rawRepoUrl) || installedRepoUrls.has(r.url);
      if (statusFilter === 'active' && !isAdded) return false;
      if (statusFilter === 'inactive' && isAdded) return false;
      if (categoryFilter !== 'all' && r.category !== categoryFilter) return false;
      if (languageFilter !== 'all' && r.language?.toLowerCase() !== languageFilter.toLowerCase()) return false;
      if (!debouncedSearchQuery) return true;
      const q = debouncedSearchQuery.toLowerCase();
      return r.name.toLowerCase().includes(q) || r.description.toLowerCase().includes(q);
    });
  }, [safeOfficialRepos, installedRepoUrls, statusFilter, categoryFilter, languageFilter, debouncedSearchQuery]);

  // Filtered Extension Data
  const filteredPlugins = useMemo(() => {
    return safePlugins.filter((p) => {
      const isInstalled = p.internalName ? installedPluginNames.has(p.internalName) : false;
      if (statusFilter === 'installed' || statusFilter === 'active') {
        if (!isInstalled) return false;
      }
      if (statusFilter === 'inactive' || statusFilter === 'uninstalled') {
        if (isInstalled) return false;
      }
      if (typeFilter !== 'all' && Array.isArray(p.tvTypes)) {
        if (!p.tvTypes.some((t) => String(t).toLowerCase().includes(typeFilter.toLowerCase()))) return false;
      }
      if (languageFilter !== 'all' && p.language && p.language.toLowerCase() !== languageFilter.toLowerCase()) return false;
      if (!debouncedSearchQuery) return true;
      const q = debouncedSearchQuery.toLowerCase();
      return (
        p.name.toLowerCase().includes(q) ||
        p.internalName.toLowerCase().includes(q) ||
        (p.description && p.description.toLowerCase().includes(q)) ||
        (Array.isArray(p.authors) && p.authors.some((a) => a.toLowerCase().includes(q)))
      );
    });
  }, [safePlugins, installedPluginNames, statusFilter, typeFilter, languageFilter, debouncedSearchQuery]);

  // Filtered Flat Providers List View
  const filteredFlatProviders = useMemo(() => {
    const list: Array<{
      providerName: string;
      lang?: string;
      supportedTypes: string[];
      extensionName: string;
      extensionInternalName: string;
      repoName: string;
      repoUrl: string;
      isDisabled: boolean;
    }> = [];

    providerTree.forEach((repo) => {
      repo.extensions.forEach((ext) => {
        ext.providers.forEach((p) => {
          const isDisabled = disabledProviders.has(p.name);
          if (statusFilter === 'enabled' && isDisabled) return;
          if (statusFilter === 'disabled' && !isDisabled) return;
          if (typeFilter !== 'all' && Array.isArray(p.supportedTypes)) {
            if (!p.supportedTypes.some((t) => String(t).toLowerCase().includes(typeFilter.toLowerCase()))) return;
          }
          if (languageFilter !== 'all' && p.lang && p.lang.toLowerCase() !== languageFilter.toLowerCase()) return;

          if (debouncedSearchQuery) {
            const q = debouncedSearchQuery.toLowerCase();
            const matches =
              p.name.toLowerCase().includes(q) ||
              ext.name.toLowerCase().includes(q) ||
              ext.internalName.toLowerCase().includes(q) ||
              repo.name.toLowerCase().includes(q);
            if (!matches) return;
          }

          list.push({
            providerName: p.name,
            lang: p.lang,
            supportedTypes: p.supportedTypes,
            extensionName: ext.name,
            extensionInternalName: ext.internalName,
            repoName: repo.name,
            repoUrl: repo.url,
            isDisabled,
          });
        });
      });
    });
    return list;
  }, [providerTree, disabledProviders, statusFilter, typeFilter, languageFilter, debouncedSearchQuery]);

  // Filtered Provider Ancestry Tree with Hierarchy Preservation
  const filteredProviderTree = useMemo(() => {
    if (!debouncedSearchQuery && statusFilter === 'all' && typeFilter === 'all' && languageFilter === 'all') {
      return providerTree;
    }
    const result: ProviderTreeRepository[] = [];
    const q = debouncedSearchQuery.toLowerCase();

    providerTree.forEach((repo) => {
      const repoMatches = q && repo.name.toLowerCase().includes(q);
      const matchingExts: ProviderTreeRepository['extensions'] = [];

      repo.extensions.forEach((ext) => {
        const extMatches = q && (ext.name.toLowerCase().includes(q) || ext.internalName.toLowerCase().includes(q));
        const matchingProviders = ext.providers.filter((p) => {
          const isDisabled = disabledProviders.has(p.name);
          if (statusFilter === 'enabled' && isDisabled) return false;
          if (statusFilter === 'disabled' && !isDisabled) return false;
          if (typeFilter !== 'all' && Array.isArray(p.supportedTypes)) {
            if (!p.supportedTypes.some((t) => String(t).toLowerCase().includes(typeFilter.toLowerCase()))) return false;
          }
          if (languageFilter !== 'all' && p.lang && p.lang.toLowerCase() !== languageFilter.toLowerCase()) return false;
          if (!q || repoMatches || extMatches) return true;
          return p.name.toLowerCase().includes(q);
        });

        if (repoMatches || extMatches || matchingProviders.length > 0) {
          matchingExts.push({
            ...ext,
            providers: matchingProviders,
          });
        }
      });

      if (repoMatches || matchingExts.length > 0) {
        result.push({
          ...repo,
          extensions: matchingExts,
        });
      }
    });
    return result;
  }, [providerTree, disabledProviders, debouncedSearchQuery, statusFilter, typeFilter, languageFilter]);

  // Action Handlers
  const handleFetchRepo = async (urlToFetch?: string, repoName?: string) => {
    const targetUrl = urlToFetch || repoUrlInput;
    if (!targetUrl) return;

    const taskId = targetUrl;
    await runProgressTask(
      taskId,
      [
        { step: 'Fetching repository manifest...', percent: 25, delay: 150 },
        { step: 'Parsing raw JSON document...', percent: 60, delay: 200 },
        { step: 'Validating extension lists...', percent: 85, delay: 150 }
      ],
      async () => {
        if (window.cloudstream) {
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
          setToastMessage(`✓ ${repository.name ?? 'Repository'}: ${repository.plugins?.length || 0} extension(s) synced`);
          setTimeout(() => setToastMessage(null), 4000);
        }
      }
    );

    if (!urlToFetch) setRepoUrlInput('');
  };

  const handleRemoveRepo = async (repoUrl: string, repoName?: string) => {
    if (!repoUrl || !window.cloudstream) return;
    const taskId = repoUrl;
    await runProgressTask(
      taskId,
      [
        { step: 'Unlinking repository persistence...', percent: 40, delay: 150 },
        { step: 'Cleaning candidate URLs...', percent: 80, delay: 150 }
      ],
      async () => {
        const remainingUrls = await window.cloudstream?.removeRepository(repoUrl);
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
      }
    );
    setConfirmRemoveRepo(null);
  };

  const handleInstallPlugin = async (plugin: SitePlugin) => {
    if (!plugin?.internalName || !window.cloudstream) return;
    const taskId = plugin.internalName;
    await runProgressTask(
      taskId,
      [
        { step: 'Downloading .cs3 archive package...', percent: 30, delay: 200 },
        { step: 'Translating DEX bytecode to JVM...', percent: 65, delay: 250 },
        { step: 'Verifying SHA-256 checksum...', percent: 85, delay: 150 }
      ],
      async () => {
        await window.cloudstream?.installPlugin(plugin);
        setInstalledPluginNames((prev) => new Set(prev).add(plugin.internalName));
        await loadHierarchyData();
        setToastMessage(`✓ ${plugin.name} installed & active!`);
        setTimeout(() => setToastMessage(null), 3500);
      }
    );
  };

  const handleReinstall = async (plugin: SitePlugin) => {
    if (!plugin?.internalName || !window.cloudstream) return;
    const taskId = plugin.internalName;
    await runProgressTask(
      taskId,
      [
        { step: 'Clearing DEX translation cache...', percent: 30, delay: 150 },
        { step: 'Re-translating DEX to JVM bytecode...', percent: 70, delay: 200 }
      ],
      async () => {
        await window.cloudstream?.installPlugin(plugin);
        await loadHierarchyData();
        setToastMessage(`✓ ${plugin.name} reinstalled`);
        setTimeout(() => setToastMessage(null), 3500);
      }
    );
  };

  const handleUpdate = async (plugin: SitePlugin) => {
    if (!plugin?.internalName || !window.cloudstream) return;
    const taskId = plugin.internalName;
    await runProgressTask(
      taskId,
      [
        { step: 'Checking upstream repository for release...', percent: 40, delay: 180 },
        { step: 'Updating bytecode and providers...', percent: 80, delay: 200 }
      ],
      async () => {
        const outcome = await window.cloudstream?.updateExtension(plugin.internalName);
        await loadHierarchyData();
        setToastMessage(`${outcome?.ok ? '✓' : '✗'} ${plugin.name}: ${outcome?.message}`);
        setTimeout(() => setToastMessage(null), 4000);
      }
    );
  };

  const handleUninstall = async (plugin: SitePlugin) => {
    if (!plugin?.internalName || !window.cloudstream) return;
    const taskId = plugin.internalName;
    await runProgressTask(
      taskId,
      [
        { step: 'Unloading provider classes...', percent: 50, delay: 150 },
        { step: 'Purging cached files...', percent: 85, delay: 150 }
      ],
      async () => {
        const removed = await window.cloudstream?.uninstallPlugin(plugin.internalName);
        if (removed) {
          setInstalledPluginNames((prev) => {
            const next = new Set(prev);
            next.delete(plugin.internalName);
            return next;
          });
          await loadHierarchyData();
          setToastMessage(`✓ ${plugin.name} uninstalled`);
          setTimeout(() => setToastMessage(null), 3500);
        }
      }
    );
    setConfirmRemove(null);
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

  // Selection Helper Methods
  const toggleSelectRepo = (id: string) => {
    setSelectedRepoIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectPlugin = (internalName: string) => {
    setSelectedPluginNames((prev) => {
      const next = new Set(prev);
      if (next.has(internalName)) next.delete(internalName);
      else next.add(internalName);
      return next;
    });
  };

  const toggleSelectProvider = (name: string) => {
    setSelectedProviderNames((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
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

  const selectAllPlugins = (mode: 'all' | 'installed' | 'uninstalled' | 'none') => {
    if (mode === 'none') {
      setSelectedPluginNames(new Set());
      return;
    }
    const next = new Set<string>();
    filteredPlugins.forEach((p) => {
      if (!p?.internalName) return;
      const isInstalled = installedPluginNames.has(p.internalName);
      if (mode === 'all') next.add(p.internalName);
      else if (mode === 'installed' && isInstalled) next.add(p.internalName);
      else if (mode === 'uninstalled' && !isInstalled) next.add(p.internalName);
    });
    setSelectedPluginNames(next);
  };

  const selectAllProviders = (mode: 'all' | 'enabled' | 'disabled' | 'none') => {
    if (mode === 'none') {
      setSelectedProviderNames(new Set());
      return;
    }
    const next = new Set<string>();
    filteredFlatProviders.forEach((p) => {
      if (mode === 'all') next.add(p.providerName);
      else if (mode === 'enabled' && !p.isDisabled) next.add(p.providerName);
      else if (mode === 'disabled' && p.isDisabled) next.add(p.providerName);
    });
    setSelectedProviderNames(next);
  };

  // Bulk Operations
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

  // Presets Handlers
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', paddingBottom: totalSelectionCount > 0 ? '5.5rem' : '1.5rem' }}>
      {/* Top Header & Presets Toolbar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#fff', display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0 }}>
            <Layers size={20} style={{ color: 'var(--accent-light)' }} />
            <span>Extension & Repository Manager</span>
          </h2>
          <p style={{ fontSize: '0.76rem', color: 'var(--text-muted)', margin: '0.2rem 0 0' }}>
            Full Lineage: Repositories ➔ Extension Archives ➔ Scraper Providers
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', background: 'var(--bg-card)', padding: '0.35rem 0.65rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}>
            <Sparkles size={14} style={{ color: 'var(--accent-light)' }} />
            <select
              onChange={(e) => handleApplyPreset(e.target.value)}
              defaultValue=""
              disabled={Boolean(bulkBusy)}
              style={{ background: 'transparent', border: 'none', color: '#fff', fontSize: '0.76rem', outline: 'none', cursor: 'pointer' }}
            >
              <option value="" disabled>Load Preset Profile...</option>
              <optgroup label="Built-in Presets">
                <option value="preset_starter">🌟 Recommended Starter Pack</option>
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
              style={{ fontSize: '0.75rem', padding: '0.35rem 0.65rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}
            >
              <Bookmark size={13} />
              <span>Save Preset</span>
            </button>
          )}
        </div>
      </div>

      {/* TOP DASHBOARD METRICS SUMMARY CARD */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: '0.75rem',
        background: 'var(--bg-card)',
        padding: '0.75rem 1rem',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--border-color)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
          <div style={{ width: '32px', height: '32px', borderRadius: 'var(--radius-sm)', background: 'rgba(59, 130, 246, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent-light)' }}>
            <Globe size={16} />
          </div>
          <div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600 }}>Repositories</div>
            <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#fff' }}>
              {metrics.totalRepos} <span style={{ fontSize: '0.74rem', color: 'var(--status-success)', fontWeight: 600 }}>({metrics.activeRepos} Active)</span>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
          <div style={{ width: '32px', height: '32px', borderRadius: 'var(--radius-sm)', background: 'rgba(16, 185, 129, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--status-success)' }}>
            <Puzzle size={16} />
          </div>
          <div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600 }}>Extension Archives</div>
            <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#fff' }}>
              {metrics.totalExts} <span style={{ fontSize: '0.74rem', color: 'var(--accent-light)', fontWeight: 600 }}>({metrics.installedExts} Installed)</span>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
          <div style={{ width: '32px', height: '32px', borderRadius: 'var(--radius-sm)', background: 'rgba(245, 158, 11, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#f59e0b' }}>
            <SlidersHorizontal size={16} />
          </div>
          <div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600 }}>Scraper Providers</div>
            <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#fff' }}>
              {metrics.totalProviders} <span style={{ fontSize: '0.74rem', color: 'var(--status-success)', fontWeight: 600 }}>({metrics.enabledProviders} Enabled</span> · <span style={{ fontSize: '0.74rem', color: 'var(--text-subtle)' }}>{metrics.disabledProvidersCount} Disabled)</span>
            </div>
          </div>
        </div>
      </div>

      {/* Compact Over-The-Air Extension Updates */}
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

      {/* Navigation Tabs Bar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '0.75rem',
        background: 'var(--bg-card)',
        padding: '0.5rem 0.85rem',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--border-color)'
      }}>
        {/* Navigation Tabs */}
        <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
          <button
            onClick={() => setActiveTab('hierarchy')}
            className={`btn ${activeTab === 'hierarchy' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ fontSize: '0.76rem', padding: '0.35rem 0.75rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}
          >
            <Layers size={14} />
            <span>Hierarchy Tree View</span>
          </button>

          <button
            onClick={() => setActiveTab('catalog')}
            className={`btn ${activeTab === 'catalog' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ fontSize: '0.76rem', padding: '0.35rem 0.75rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}
          >
            <Globe size={14} />
            <span>Repositories ({safeOfficialRepos.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('extensions')}
            className={`btn ${activeTab === 'extensions' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ fontSize: '0.76rem', padding: '0.35rem 0.75rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}
          >
            <Puzzle size={14} />
            <span>Extensions ({safePlugins.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('providers')}
            className={`btn ${activeTab === 'providers' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ fontSize: '0.76rem', padding: '0.35rem 0.75rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}
          >
            <SlidersHorizontal size={14} />
            <span>Providers ({metrics.totalProviders})</span>
          </button>
        </div>

        {/* Global Instant Search Bar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 1, maxWidth: '280px', minWidth: '180px' }}>
          <div style={{ position: 'relative', width: '100%', display: 'flex', alignItems: 'center' }}>
            <Search size={13} style={{ position: 'absolute', left: '0.65rem', color: 'var(--text-subtle)' }} />
            <input
              type="text"
              placeholder="Search repos, extensions, providers..."
              value={rawSearchQuery}
              onChange={(e) => setRawSearchQuery(e.target.value)}
              style={{
                width: '100%',
                padding: '0.35rem 0.65rem 0.35rem 1.9rem',
                backgroundColor: 'var(--bg-input)',
                border: '1px solid var(--border-color)',
                borderRadius: 'var(--radius-md)',
                color: '#fff',
                fontSize: '0.76rem'
              }}
            />
          </div>
        </div>
      </div>

      {/* MULTI-FILTER DROPDOWN ROW */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.6rem',
        flexWrap: 'wrap',
        background: 'var(--bg-card)',
        padding: '0.4rem 0.85rem',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--border-color)',
        fontSize: '0.74rem'
      }}>
        <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>Filters:</span>

        {/* Status Filter */}
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as any)}
          style={{ background: 'var(--bg-input)', border: '1px solid var(--border-color)', color: '#fff', padding: '0.25rem 0.5rem', borderRadius: 'var(--radius-sm)', fontSize: '0.72rem', outline: 'none' }}
        >
          <option value="all">Status: All</option>
          <option value="active">Status: Active / Installed</option>
          <option value="inactive">Status: Inactive / Uninstalled</option>
          <option value="enabled">Providers: Enabled Only</option>
          <option value="disabled">Providers: Disabled Only</option>
        </select>

        {/* Language Filter */}
        <select
          value={languageFilter}
          onChange={(e) => setLanguageFilter(e.target.value)}
          style={{ background: 'var(--bg-input)', border: '1px solid var(--border-color)', color: '#fff', padding: '0.25rem 0.5rem', borderRadius: 'var(--radius-sm)', fontSize: '0.72rem', outline: 'none' }}
        >
          <option value="all">Language: All</option>
          <option value="en">English (EN)</option>
          <option value="de">German (DE)</option>
          <option value="it">Italian (IT)</option>
          <option value="es">Spanish (ES)</option>
          <option value="fr">French (FR)</option>
          <option value="ar">Arabic (AR)</option>
          <option value="vi">Vietnamese (VI)</option>
          <option value="multi">Multi-Language</option>
        </select>

        {/* Content Type Filter */}
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          style={{ background: 'var(--bg-input)', border: '1px solid var(--border-color)', color: '#fff', padding: '0.25rem 0.5rem', borderRadius: 'var(--radius-sm)', fontSize: '0.72rem', outline: 'none' }}
        >
          <option value="all">Content Type: All</option>
          <option value="movie">Movies</option>
          <option value="series">TV Series</option>
          <option value="anime">Anime</option>
        </select>

        {/* Category Filter */}
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          style={{ background: 'var(--bg-input)', border: '1px solid var(--border-color)', color: '#fff', padding: '0.25rem 0.5rem', borderRadius: 'var(--radius-sm)', fontSize: '0.72rem', outline: 'none' }}
        >
          <option value="all">Category: All</option>
          <option value="Official">Official</option>
          <option value="Regional">Regional</option>
          <option value="Anime">Anime</option>
          <option value="Movies & Shows">Movies & Shows</option>
          <option value="Community">Community</option>
        </select>

        {(statusFilter !== 'all' || languageFilter !== 'all' || typeFilter !== 'all' || categoryFilter !== 'all' || rawSearchQuery) && (
          <button
            onClick={() => {
              setStatusFilter('all');
              setLanguageFilter('all');
              setTypeFilter('all');
              setCategoryFilter('all');
              setRawSearchQuery('');
            }}
            className="btn btn-secondary"
            style={{ padding: '0.2rem 0.45rem', fontSize: '0.7rem' }}
          >
            Reset Filters
          </button>
        )}
      </div>

      {/* Toast Notification Banner */}
      {(toastMessage || bulkBusy) && (
        <div style={{
          background: bulkBusy ? 'rgba(59, 130, 246, 0.15)' : 'rgba(16, 185, 129, 0.15)',
          border: '1px solid',
          borderColor: bulkBusy ? 'var(--accent-primary)' : 'var(--status-success)',
          padding: '0.6rem 1rem',
          borderRadius: 'var(--radius-md)',
          color: '#fff',
          fontSize: '0.8rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.6rem'
        }}>
          {bulkBusy ? <Loader2 size={16} className="spin" style={{ color: 'var(--accent-light)' }} /> : <CheckCircle2 size={16} style={{ color: 'var(--status-success)' }} />}
          <span>{bulkBusy || toastMessage}</span>
        </div>
      )}

      {/* Save Preset Profile Modal */}
      {showPresetModal && (
        <div style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--accent-primary)',
          borderRadius: 'var(--radius-md)',
          padding: '1rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.75rem'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#fff' }}>
            <Bookmark size={16} style={{ color: 'var(--accent-light)' }} />
            <h3 style={{ fontSize: '0.95rem', fontWeight: 700, margin: 0 }}>Save Custom Preset Profile</h3>
          </div>
          <p style={{ fontSize: '0.76rem', color: 'var(--text-muted)', margin: 0 }}>
            Save current selection ({selectedRepoIds.size} repos, {selectedPluginNames.size} extensions, {selectedProviderNames.size} providers) as a reusable profile.
          </p>
          <div style={{ display: 'flex', gap: '0.6rem' }}>
            <input
              type="text"
              placeholder="Preset Profile Name..."
              value={newPresetName}
              onChange={(e) => setNewPresetName(e.target.value)}
              style={{
                flex: 1,
                padding: '0.4rem 0.65rem',
                backgroundColor: 'var(--bg-input)',
                border: '1px solid var(--border-color)',
                borderRadius: 'var(--radius-md)',
                color: '#fff',
                fontSize: '0.78rem'
              }}
            />
            <button onClick={handleSavePreset} className="btn btn-primary" style={{ fontSize: '0.75rem' }}>
              Save Profile
            </button>
            <button onClick={() => setShowPresetModal(false)} className="btn btn-secondary" style={{ fontSize: '0.75rem' }}>
              Cancel
            </button>
          </div>

          {savedPresets.length > 0 && (
            <div style={{ marginTop: '0.4rem', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)', fontWeight: 600 }}>Your Saved Presets:</span>
              {savedPresets.map((p) => (
                <div key={p.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.35rem 0.5rem', background: 'var(--bg-input)', borderRadius: 'var(--radius-sm)' }}>
                  <span style={{ fontSize: '0.76rem', color: '#fff' }}>⭐ {p.name} ({p.repoIds.length} repos)</span>
                  <button
                    onClick={() => handleDeletePreset(p.id, p.name)}
                    className="btn btn-danger"
                    style={{ padding: '0.15rem 0.45rem', fontSize: '0.7rem' }}
                  >
                    <Trash2 size={11} />
                    <span>Delete</span>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* VIEW MODE 1: HIERARCHY TREE VIEW (Primary Experience)                    */}
      {/* ========================================================================= */}
      {activeTab === 'hierarchy' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'var(--bg-card)',
            padding: '0.65rem 1rem',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border-color)',
            flexWrap: 'wrap',
            gap: '0.5rem'
          }}>
            <div>
              <h3 style={{ fontSize: '0.92rem', fontWeight: 700, color: '#fff', margin: 0 }}>
                Repository ➔ Extension ➔ Provider Ancestry Tree ({filteredProviderTree.length} Active Repositories)
              </h3>
              <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: 0 }}>
                Full scale counts and tri-state switches at every level
              </p>
            </div>

            <div style={{ display: 'flex', gap: '0.4rem' }}>
              <button
                onClick={() => {
                  const ids = new Set<string>();
                  filteredProviderTree.forEach((repo, rIdx) => {
                    ids.add(`repo_${rIdx}`);
                    repo.extensions.forEach((ext) => ids.add(`ext_${ext.internalName}`));
                  });
                  setExpandedNodes(ids);
                }}
                className="btn btn-secondary"
                style={{ fontSize: '0.72rem', padding: '0.25rem 0.5rem' }}
              >
                Expand All Nodes
              </button>
              <button
                onClick={() => setExpandedNodes(new Set())}
                className="btn btn-secondary"
                style={{ fontSize: '0.72rem', padding: '0.25rem 0.5rem' }}
              >
                Collapse All Nodes
              </button>
            </div>
          </div>

          {filteredProviderTree.length === 0 ? (
            <div style={{
              background: 'var(--bg-card)',
              padding: '2rem',
              textAlign: 'center',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-color)',
              color: 'var(--text-muted)'
            }}>
              <Layers size={32} style={{ color: 'var(--accent-light)', marginBottom: '0.5rem' }} />
              <p style={{ fontSize: '0.9rem', fontWeight: 600, color: '#fff', margin: 0 }}>No Repositories Matching Filter</p>
              <p style={{ fontSize: '0.76rem', marginTop: '0.25rem' }}>
                Activate repositories from the <strong>Repositories</strong> tab or adjust your search filters above.
              </p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {filteredProviderTree.slice(0, visibleLimit).map((repoTree, repoIdx) => {
                const repoNodeId = `repo_${repoIdx}`;
                const isRepoExpanded = expandedNodes.has(repoNodeId);
                const repoDetailId = `detail_repo_${repoTree.url}`;
                const isRepoDetailOpen = expandedDetailIds.has(repoDetailId);

                const allRepoProviders = repoTree.extensions.flatMap((e) => e.providers.map((p) => p.name));
                const repoEnabledCount = allRepoProviders.filter((p) => !disabledProviders.has(p)).length;
                const repoDisabledCount = allRepoProviders.length - repoEnabledCount;

                // Repository Level Tri-State Checkbox
                let repoTriState: 'checked' | 'unchecked' | 'indeterminate' = 'unchecked';
                if (allRepoProviders.length > 0) {
                  if (repoEnabledCount === allRepoProviders.length) repoTriState = 'checked';
                  else if (repoEnabledCount > 0) repoTriState = 'indeterminate';
                }

                const progressInfo = taskProgressMap[repoTree.url];
                const officialRepo = safeOfficialRepos.find((r) => r.rawRepoUrl === repoTree.url || r.url === repoTree.url);

                return (
                  <div
                    key={repoNodeId}
                    style={{
                      background: 'var(--bg-card)',
                      borderRadius: 'var(--radius-md)',
                      border: '1px solid var(--border-color)',
                      overflow: 'hidden',
                      position: 'relative'
                    }}
                  >
                    {/* In-Card Progress Bar */}
                    {progressInfo && (
                      <div style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        right: 0,
                        height: '4px',
                        background: 'rgba(59, 130, 246, 0.2)',
                        overflow: 'hidden'
                      }}>
                        <div style={{
                          height: '100%',
                          width: `${progressInfo.percent}%`,
                          background: 'var(--accent-primary)',
                          transition: 'width 0.2s ease'
                        }} />
                      </div>
                    )}

                    {/* Repository Level Row */}
                    <div style={{
                      padding: '0.75rem 1rem',
                      background: 'rgba(255, 255, 255, 0.02)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      borderBottom: (isRepoExpanded || isRepoDetailOpen) ? '1px solid var(--border-color)' : 'none'
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', flex: 1 }}>
                        <button
                          onClick={() => toggleExpandNode(repoNodeId)}
                          style={{ background: 'transparent', border: 'none', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                        >
                          {isRepoExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                        </button>

                        <TriStateCheckbox
                          state={repoTriState}
                          onClick={() => handleToggleProvidersBulk(allRepoProviders, repoTriState !== 'checked')}
                          title="Enable/Disable all providers in this repository"
                        />

                        <Globe size={16} style={{ color: 'var(--accent-light)' }} />
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                            <h4 style={{ fontSize: '0.9rem', fontWeight: 700, color: '#fff', margin: 0 }}>{repoTree.name}</h4>
                            <span className="poster-badge" style={{ position: 'static', fontSize: '0.65rem' }}>
                              {repoTree.extensions.length} Extensions • {allRepoProviders.length} Providers ({repoEnabledCount} Enabled | {repoDisabledCount} Disabled)
                            </span>
                          </div>
                          {progressInfo ? (
                            <span style={{ fontSize: '0.7rem', color: 'var(--accent-light)', fontWeight: 600 }}>
                              {progressInfo.step} ({progressInfo.percent}%)
                            </span>
                          ) : (
                            <span style={{ fontSize: '0.7rem', color: 'var(--text-subtle)', wordBreak: 'break-all' }}>{repoTree.url}</span>
                          )}
                        </div>
                      </div>

                      {/* Repository Actions */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        {/* NO MODALS! Toggle inline detail tray */}
                        <button
                          onClick={() => toggleDetail(repoDetailId)}
                          className={`btn ${isRepoDetailOpen ? 'btn-primary' : 'btn-secondary'}`}
                          style={{ padding: '0.2rem 0.45rem', fontSize: '0.7rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}
                          title="Toggle inline metadata info"
                        >
                          <Eye size={13} />
                          <span>{isRepoDetailOpen ? 'Hide Info' : 'View Info'}</span>
                        </button>

                        <button
                          onClick={() => handleFetchRepo(repoTree.url, repoTree.name)}
                          className="btn btn-secondary"
                          style={{ fontSize: '0.7rem', padding: '0.2rem 0.5rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}
                        >
                          <RefreshCw size={12} />
                          <span>Sync</span>
                        </button>

                        <button
                          onClick={() => handleRemoveRepo(repoTree.url, repoTree.name)}
                          className="btn btn-secondary"
                          style={{ fontSize: '0.7rem', padding: '0.2rem 0.5rem', color: '#ff6b6b', display: 'flex', alignItems: 'center', gap: '0.3rem' }}
                        >
                          <Trash2 size={12} />
                          <span>Deactivate</span>
                        </button>
                      </div>
                    </div>

                    {/* Inline Metadata Strip for Repository */}
                    {isRepoDetailOpen && (
                      <div style={{ padding: '0 1rem 0.6rem 1rem' }}>
                        <InlineDetailStrip
                          details={{
                            type: 'repo',
                            title: repoTree.name,
                            url: repoTree.url,
                            category: officialRepo?.category,
                            language: officialRepo?.language,
                            description: officialRepo?.description,
                            extensionsCount: repoTree.extensions.length,
                            providersCount: allRepoProviders.length,
                            enabledProvidersCount: repoEnabledCount,
                            disabledProvidersCount: repoDisabledCount,
                            verified: true
                          }}
                        />
                      </div>
                    )}

                    {/* Extension Level Children */}
                    {isRepoExpanded && (
                      <div style={{ padding: '0.6rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.6rem', backgroundColor: 'rgba(0, 0, 0, 0.15)' }}>
                        {repoTree.extensions.map((ext) => {
                          const extNodeId = `ext_${ext.internalName}`;
                          const isExtExpanded = expandedNodes.has(extNodeId);
                          const extDetailId = `detail_ext_${ext.internalName}`;
                          const isExtDetailOpen = expandedDetailIds.has(extDetailId);

                          const extProviders = ext.providers.map((p) => p.name);
                          const extEnabledCount = extProviders.filter((p) => !disabledProviders.has(p)).length;
                          const extDisabledCount = extProviders.length - extEnabledCount;

                          let extTriState: 'checked' | 'unchecked' | 'indeterminate' = 'unchecked';
                          if (extProviders.length > 0) {
                            if (extEnabledCount === extProviders.length) extTriState = 'checked';
                            else if (extEnabledCount > 0) extTriState = 'indeterminate';
                          }

                          const pluginMeta = safePlugins.find((p) => p.internalName === ext.internalName);
                          const extProgress = taskProgressMap[ext.internalName];

                          return (
                            <div
                              key={ext.internalName}
                              style={{
                                background: 'var(--bg-card)',
                                border: '1px solid var(--border-color)',
                                borderRadius: 'var(--radius-sm)',
                                overflow: 'hidden',
                                position: 'relative'
                              }}
                            >
                              {/* Extension Progress Bar */}
                              {extProgress && (
                                <div style={{
                                  position: 'absolute',
                                  top: 0,
                                  left: 0,
                                  right: 0,
                                  height: '3px',
                                  background: 'rgba(59, 130, 246, 0.2)',
                                  overflow: 'hidden'
                                }}>
                                  <div style={{
                                    height: '100%',
                                    width: `${extProgress.percent}%`,
                                    background: 'var(--accent-primary)',
                                    transition: 'width 0.2s ease'
                                  }} />
                                </div>
                              )}

                              <div style={{
                                padding: '0.55rem 0.85rem',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                background: 'rgba(255, 255, 255, 0.015)'
                              }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', flex: 1 }}>
                                  <button
                                    onClick={() => toggleExpandNode(extNodeId)}
                                    style={{ background: 'transparent', border: 'none', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                                  >
                                    {isExtExpanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                                  </button>

                                  <TriStateCheckbox
                                    state={extTriState}
                                    onClick={() => handleToggleProvidersBulk(extProviders, extTriState !== 'checked')}
                                    title="Enable/Disable all providers in this extension"
                                  />

                                  <Puzzle size={15} style={{ color: 'var(--status-success)' }} />

                                  <div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                                      <h5 style={{ fontSize: '0.85rem', fontWeight: 600, color: '#fff', margin: 0 }}>{ext.name}</h5>
                                      <span style={{ fontSize: '0.68rem', color: 'var(--text-subtle)' }}>({ext.internalName})</span>
                                      <span className="poster-badge" style={{ position: 'static', fontSize: '0.62rem' }}>
                                        {ext.providers.length} Providers ({extEnabledCount} Enabled | {extDisabledCount} Disabled)
                                      </span>
                                    </div>
                                    <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                                      Repository: <strong>{repoTree.name}</strong>
                                    </span>
                                  </div>
                                </div>

                                {/* Extension Actions */}
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                                  {/* NO MODALS! Toggle inline detail strip */}
                                  <button
                                    onClick={() => toggleDetail(extDetailId)}
                                    className={`btn ${isExtDetailOpen ? 'btn-primary' : 'btn-secondary'}`}
                                    style={{ padding: '0.18rem 0.4rem', fontSize: '0.68rem', display: 'flex', alignItems: 'center', gap: '0.2rem' }}
                                    title="Toggle inline metadata info"
                                  >
                                    <Eye size={12} />
                                    <span>{isExtDetailOpen ? 'Hide Info' : 'View Info'}</span>
                                  </button>

                                  {pluginMeta && (
                                    <>
                                      <button
                                        onClick={() => handleUpdate(pluginMeta)}
                                        className="btn btn-secondary"
                                        style={{ fontSize: '0.68rem', padding: '0.18rem 0.4rem' }}
                                        title="Update extension"
                                      >
                                        <RefreshCw size={11} />
                                      </button>

                                      <button
                                        onClick={() => handleUninstall(pluginMeta)}
                                        className="btn btn-secondary"
                                        style={{ fontSize: '0.68rem', padding: '0.18rem 0.4rem', color: '#ff6b6b' }}
                                        title="Uninstall extension"
                                      >
                                        <Trash2 size={11} />
                                      </button>
                                    </>
                                  )}
                                </div>
                              </div>

                              {/* Inline Detail Strip for Extension */}
                              {isExtDetailOpen && (
                                <div style={{ padding: '0 0.85rem 0.5rem 0.85rem' }}>
                                  <InlineDetailStrip
                                    details={{
                                      type: 'extension',
                                      title: ext.name,
                                      internalName: ext.internalName,
                                      version: pluginMeta?.version,
                                      authors: pluginMeta?.authors,
                                      description: pluginMeta?.description,
                                      language: ext.language,
                                      tvTypes: pluginMeta?.tvTypes?.map(String),
                                      fileSize: pluginMeta?.fileSize,
                                      parentRepo: repoTree.name,
                                      providersCount: ext.providers.length,
                                      enabledProvidersCount: extEnabledCount,
                                      disabledProvidersCount: extDisabledCount
                                    }}
                                  />
                                </div>
                              )}

                              {/* Individual Scraper Providers Sub-Level */}
                              {isExtExpanded && (
                                <div style={{ padding: '0.4rem 0.85rem 0.6rem 2.2rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '0.4rem', background: 'rgba(0,0,0,0.2)' }}>
                                  {ext.providers.length === 0 ? (
                                    <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>No providers registered yet (archive loading...)</p>
                                  ) : (
                                    ext.providers.map((p) => {
                                      const isDisabled = disabledProviders.has(p.name);
                                      const isProvSelected = selectedProviderNames.has(p.name);
                                      const provDetailId = `detail_prov_${ext.internalName}_${p.name}`;
                                      const isProvDetailOpen = expandedDetailIds.has(provDetailId);

                                      return (
                                        <div
                                          key={p.name}
                                          style={{
                                            display: 'flex',
                                            flexDirection: 'column',
                                            padding: '0.35rem 0.55rem',
                                            borderRadius: 'var(--radius-sm)',
                                            background: 'var(--bg-input)',
                                            border: '1px solid',
                                            borderColor: isDisabled ? 'var(--border-color)' : 'rgba(16, 185, 129, 0.3)'
                                          }}
                                        >
                                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                                              <div
                                                onClick={() => toggleSelectProvider(p.name)}
                                                style={{ cursor: 'pointer' }}
                                              >
                                                {isProvSelected ? <CheckSquare size={13} style={{ color: 'var(--accent-light)' }} /> : <Square size={13} style={{ color: 'var(--text-subtle)' }} />}
                                              </div>

                                              <span style={{ fontSize: '0.78rem', fontWeight: 600, color: isDisabled ? 'var(--text-muted)' : '#fff' }}>
                                                {p.name}
                                              </span>
                                            </div>

                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                                              <button
                                                onClick={() => toggleDetail(provDetailId)}
                                                style={{ background: 'transparent', border: 'none', color: isProvDetailOpen ? 'var(--accent-light)' : 'var(--text-subtle)', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                                                title="Toggle inline details"
                                              >
                                                <Eye size={12} />
                                              </button>

                                              <button
                                                onClick={() => handleToggleProvider(p.name, isDisabled)}
                                                style={{ background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                                                title={isDisabled ? 'Enable Provider' : 'Disable Provider'}
                                              >
                                                {isDisabled ? (
                                                  <ToggleLeft size={16} style={{ color: 'var(--text-subtle)' }} />
                                                ) : (
                                                  <ToggleRight size={16} style={{ color: 'var(--status-success)' }} />
                                                )}
                                              </button>
                                            </div>
                                          </div>

                                          {/* Inline Detail Strip for Provider */}
                                          {isProvDetailOpen && (
                                            <InlineDetailStrip
                                              details={{
                                                type: 'provider',
                                                title: p.name,
                                                language: p.lang,
                                                tvTypes: p.supportedTypes,
                                                parentExtension: ext.name,
                                                parentRepo: repoTree.name,
                                                status: isDisabled ? 'Disabled' : 'Enabled for Search'
                                              }}
                                            />
                                          )}
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

              {filteredProviderTree.length > visibleLimit && (
                <button
                  onClick={() => setVisibleLimit((prev) => prev + 50)}
                  className="btn btn-secondary"
                  style={{ alignSelf: 'center', marginTop: '0.5rem', fontSize: '0.76rem' }}
                >
                  Load More Items ({filteredProviderTree.length - visibleLimit} remaining)
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* VIEW MODE 2: REPOSITORIES CATALOGUE GRID                                 */}
      {/* ========================================================================= */}
      {activeTab === 'catalog' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
          {/* Controls Bar */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '0.6rem',
            background: 'var(--bg-card)',
            padding: '0.65rem 0.85rem',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border-color)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap', fontSize: '0.76rem' }}>
              <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>Select Repos:</span>
              <button onClick={() => selectAllRepos('all')} className="btn btn-secondary" style={{ padding: '0.2rem 0.45rem', fontSize: '0.7rem' }}>
                Select All
              </button>
              <button onClick={() => selectAllRepos('active')} className="btn btn-secondary" style={{ padding: '0.2rem 0.45rem', fontSize: '0.7rem' }}>
                Active Only
              </button>
              <button onClick={() => selectAllRepos('inactive')} className="btn btn-secondary" style={{ padding: '0.2rem 0.45rem', fontSize: '0.7rem' }}>
                Inactive Only
              </button>
              {selectedRepoIds.size > 0 && (
                <button onClick={() => selectAllRepos('none')} className="btn btn-secondary" style={{ padding: '0.2rem 0.45rem', fontSize: '0.7rem' }}>
                  Clear
                </button>
              )}
            </div>
          </div>

          {/* Cards Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '0.85rem' }}>
            {filteredOfficialRepos.slice(0, visibleLimit).map((repo) => {
              const isAdded = repo && (installedRepoUrls.has(repo.rawRepoUrl) || installedRepoUrls.has(repo.url));
              const isSelected = selectedRepoIds.has(repo.id);
              const isConfirmingRepo = repo && (confirmRemoveRepo === repo.rawRepoUrl || confirmRemoveRepo === repo.url);
              const repoProgress = taskProgressMap[repo.rawRepoUrl] || taskProgressMap[repo.url];

              const repoTreeInfo = providerTree.find((t) => t.url === repo.rawRepoUrl || t.url === repo.url);
              const extCount = repoTreeInfo ? repoTreeInfo.extensions.length : 0;
              const provCount = repoTreeInfo ? repoTreeInfo.extensions.reduce((acc, e) => acc + e.providers.length, 0) : 0;
              const repoDetailId = `detail_cat_${repo.id}`;
              const isDetailOpen = expandedDetailIds.has(repoDetailId);

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
                    padding: '1rem',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    gap: '0.85rem',
                    position: 'relative'
                  }}
                >
                  {repoProgress && (
                    <div style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      right: 0,
                      height: '3px',
                      background: 'rgba(59, 130, 246, 0.2)',
                      overflow: 'hidden'
                    }}>
                      <div style={{
                        height: '100%',
                        width: `${repoProgress.percent}%`,
                        background: 'var(--accent-primary)',
                        transition: 'width 0.2s ease'
                      }} />
                    </div>
                  )}

                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
                      <div
                        onClick={() => toggleSelectRepo(repo.id)}
                        style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer' }}
                      >
                        {isSelected ? (
                          <CheckSquare size={16} style={{ color: 'var(--accent-light)' }} />
                        ) : (
                          <Square size={16} style={{ color: 'var(--text-subtle)' }} />
                        )}
                        <h4 style={{ fontSize: '0.9rem', fontWeight: 700, color: '#fff', margin: 0 }}>{repo.name}</h4>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                        <button
                          onClick={() => toggleDetail(repoDetailId)}
                          className={`btn ${isDetailOpen ? 'btn-primary' : 'btn-secondary'}`}
                          style={{ padding: '0.15rem 0.4rem', fontSize: '0.68rem', display: 'flex', alignItems: 'center', gap: '0.2rem' }}
                          title="Toggle inline details"
                        >
                          <Eye size={12} />
                          <span>{isDetailOpen ? 'Hide' : 'View'}</span>
                        </button>
                        <span className="poster-badge" style={{ position: 'static', fontSize: '0.65rem' }}>{repo.category}</span>
                      </div>
                    </div>

                    <p style={{ fontSize: '0.76rem', color: 'var(--text-muted)', lineHeight: 1.4, margin: 0 }}>
                      {repo.description}
                    </p>

                    {/* Inline Detail Strip */}
                    {isDetailOpen && (
                      <InlineDetailStrip
                        details={{
                          type: 'repo',
                          title: repo.name,
                          category: repo.category,
                          language: repo.language,
                          description: repo.description,
                          rawRepoUrl: repo.rawRepoUrl,
                          url: repo.url,
                          extensionsCount: extCount,
                          providersCount: provCount,
                          verified: repo.verified
                        }}
                      />
                    )}

                    <div style={{ display: 'flex', gap: '0.85rem', marginTop: '0.65rem', fontSize: '0.7rem', color: 'var(--text-subtle)', flexWrap: 'wrap' }}>
                      <span>Extensions: <strong>{extCount}</strong></span>
                      <span>Providers: <strong>{provCount}</strong></span>
                      <span>Lang: <strong>{repo.language}</strong></span>
                      <span>{repo.verified ? <strong style={{ color: 'var(--status-success)' }}>Reachable</strong> : <strong style={{ color: '#f59e0b' }}>Unverified</strong>}</span>
                    </div>
                  </div>

                  {isConfirmingRepo ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', width: '100%' }}>
                      <span style={{ fontSize: '0.72rem', color: '#ff6b6b', flex: 1, fontWeight: 600 }}>Deactivate repo?</span>
                      <button
                        onClick={() => handleRemoveRepo(repo.rawRepoUrl, repo.name)}
                        className="btn btn-danger"
                        style={{ fontSize: '0.72rem', padding: '0.25rem 0.5rem' }}
                      >
                        <Trash2 size={12} />
                        <span>Deactivate</span>
                      </button>
                      <button
                        onClick={() => setConfirmRemoveRepo(null)}
                        className="btn btn-secondary"
                        style={{ fontSize: '0.72rem', padding: '0.25rem 0.5rem' }}
                      >
                        <span>Cancel</span>
                      </button>
                    </div>
                  ) : isAdded ? (
                    <div style={{ display: 'flex', gap: '0.4rem', width: '100%' }}>
                      <button
                        onClick={() => handleFetchRepo(repo.rawRepoUrl, repo.name)}
                        className="btn btn-secondary"
                        style={{ flex: 1, fontSize: '0.74rem', padding: '0.3rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.3rem' }}
                      >
                        <RefreshCw size={13} />
                        <span>Sync</span>
                      </button>
                      <button
                        onClick={() => setConfirmRemoveRepo(repo.rawRepoUrl)}
                        className="btn btn-secondary"
                        style={{
                          flex: 1,
                          fontSize: '0.74rem',
                          padding: '0.3rem',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '0.3rem',
                          color: '#ff6b6b',
                          borderColor: 'rgba(255,107,107,0.3)'
                        }}
                      >
                        <Trash2 size={13} />
                        <span>Deactivate</span>
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => handleFetchRepo(repo.rawRepoUrl, repo.name)}
                      className="btn btn-primary"
                      style={{ fontSize: '0.76rem', width: '100%', padding: '0.35rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.3rem' }}
                    >
                      <Plus size={14} />
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
      {/* VIEW MODE 3: EXTENSIONS VIEW                                              */}
      {/* ========================================================================= */}
      {activeTab === 'extensions' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
          {/* Controls Bar */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.6rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap', fontSize: '0.76rem' }}>
              <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>Select Extensions:</span>
              <button onClick={() => selectAllPlugins('all')} className="btn btn-secondary" style={{ padding: '0.2rem 0.45rem', fontSize: '0.7rem' }}>
                Select All
              </button>
              <button onClick={() => selectAllPlugins('installed')} className="btn btn-secondary" style={{ padding: '0.2rem 0.45rem', fontSize: '0.7rem' }}>
                Installed Only
              </button>
              <button onClick={() => selectAllPlugins('uninstalled')} className="btn btn-secondary" style={{ padding: '0.2rem 0.45rem', fontSize: '0.7rem' }}>
                Uninstalled Only
              </button>
              {selectedPluginNames.size > 0 && (
                <button onClick={() => selectAllPlugins('none')} className="btn btn-secondary" style={{ padding: '0.2rem 0.45rem', fontSize: '0.7rem' }}>
                  Clear
                </button>
              )}
            </div>
          </div>

          {/* Extension Cards Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '0.85rem' }}>
            {filteredPlugins.slice(0, visibleLimit).map((plugin, idx) => {
              const isInstalled = plugin.internalName ? installedPluginNames.has(plugin.internalName) : false;
              const isSelected = plugin.internalName ? selectedPluginNames.has(plugin.internalName) : false;
              const isConfirming = confirmRemove === plugin.internalName;
              const extProgress = plugin.internalName ? taskProgressMap[plugin.internalName] : undefined;
              const extDetailId = `detail_extview_${plugin.internalName}`;
              const isDetailOpen = expandedDetailIds.has(extDetailId);

              // Find parent repository
              let parentRepoName = 'Community Repository';
              providerTree.forEach((r) => {
                if (r.extensions.some((e) => e.internalName === plugin.internalName)) {
                  parentRepoName = r.name;
                }
              });

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
                    padding: '1rem',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    gap: '0.85rem',
                    position: 'relative'
                  }}
                >
                  {extProgress && (
                    <div style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      right: 0,
                      height: '3px',
                      background: 'rgba(59, 130, 246, 0.2)',
                      overflow: 'hidden'
                    }}>
                      <div style={{
                        height: '100%',
                        width: `${extProgress.percent}%`,
                        background: 'var(--accent-primary)',
                        transition: 'width 0.2s ease'
                      }} />
                    </div>
                  )}

                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', marginBottom: '0.4rem' }}>
                      <div
                        onClick={() => plugin.internalName && toggleSelectPlugin(plugin.internalName)}
                        style={{ cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                      >
                        {isSelected ? (
                          <CheckSquare size={16} style={{ color: 'var(--accent-light)' }} />
                        ) : (
                          <Square size={16} style={{ color: 'var(--text-subtle)' }} />
                        )}
                      </div>
                      <div style={{
                        width: '30px',
                        height: '30px',
                        borderRadius: 'var(--radius-sm)',
                        background: 'var(--bg-input)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: isInstalled ? 'var(--status-success)' : 'var(--accent-light)'
                      }}>
                        <Puzzle size={16} />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <h4 style={{ fontSize: '0.88rem', fontWeight: 600, color: '#fff', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {plugin.name}
                          </h4>
                          <button
                            onClick={() => toggleDetail(extDetailId)}
                            className={`btn ${isDetailOpen ? 'btn-primary' : 'btn-secondary'}`}
                            style={{ padding: '0.15rem 0.4rem', fontSize: '0.68rem', display: 'flex', alignItems: 'center', gap: '0.2rem' }}
                            title="Toggle inline details"
                          >
                            <Eye size={12} />
                            <span>{isDetailOpen ? 'Hide' : 'View'}</span>
                          </button>
                        </div>
                        <span style={{ fontSize: '0.68rem', color: 'var(--text-subtle)' }}>
                          v{plugin.version} • Repository: <strong>{parentRepoName}</strong>
                        </span>
                      </div>
                    </div>

                    <p style={{ fontSize: '0.76rem', color: 'var(--text-muted)', margin: 0, lineHeight: 1.4 }}>
                      {plugin.description || 'Community media provider extension'}
                    </p>

                    {/* Inline Detail Strip */}
                    {isDetailOpen && (
                      <InlineDetailStrip
                        details={{
                          type: 'extension',
                          title: plugin.name,
                          internalName: plugin.internalName,
                          version: plugin.version,
                          authors: plugin.authors,
                          description: plugin.description,
                          language: plugin.language,
                          tvTypes: plugin.tvTypes?.map(String),
                          fileSize: plugin.fileSize,
                          fileHash: plugin.fileHash,
                          parentRepo: parentRepoName
                        }}
                      />
                    )}
                  </div>

                  {isConfirming ? (
                    <div className="ext-actions">
                      <span className="ext-actions__ask" style={{ fontSize: '0.72rem' }}>Remove?</span>
                      <button
                        onClick={() => handleUninstall(plugin)}
                        className="btn btn-danger ext-actions__btn"
                        style={{ fontSize: '0.72rem', padding: '0.2rem 0.5rem' }}
                      >
                        <Trash2 size={13} />
                        <span>Remove</span>
                      </button>
                      <button
                        onClick={() => setConfirmRemove(null)}
                        className="btn btn-secondary ext-actions__btn"
                        style={{ fontSize: '0.72rem', padding: '0.2rem 0.5rem' }}
                      >
                        <span>Cancel</span>
                      </button>
                    </div>
                  ) : isInstalled ? (
                    <div className="ext-actions">
                      <span className="ext-actions__state" style={{ fontSize: '0.72rem' }}>
                        <CheckCircle2 size={12} /> Installed
                      </span>
                      <button
                        onClick={() => handleUpdate(plugin)}
                        className="btn btn-secondary ext-actions__btn"
                        style={{ padding: '0.2rem 0.4rem' }}
                        title="Update extension"
                      >
                        <RefreshCw size={12} />
                      </button>
                      <button
                        onClick={() => handleReinstall(plugin)}
                        className="btn btn-secondary ext-actions__btn"
                        style={{ padding: '0.2rem 0.4rem' }}
                        title="Reinstall extension"
                      >
                        <RotateCcw size={12} />
                      </button>
                      <button
                        onClick={() => setConfirmRemove(plugin.internalName)}
                        className="btn btn-secondary ext-actions__btn ext-actions__btn--danger"
                        style={{ padding: '0.2rem 0.4rem' }}
                        title="Uninstall"
                      >
                        <Trash2 size={12} />
                      </button>
                      <button
                        onClick={() => handleAnalyze(plugin)}
                        className="btn btn-secondary ext-actions__btn"
                        style={{ padding: '0.2rem 0.4rem' }}
                        title="Analyze tier"
                      >
                        <ShieldCheck size={12} />
                      </button>
                    </div>
                  ) : (
                    <div className="ext-actions">
                      <button
                        onClick={() => handleAnalyze(plugin)}
                        className="btn btn-secondary ext-actions__btn"
                        style={{ flex: 1, fontSize: '0.74rem', padding: '0.25rem' }}
                      >
                        <ShieldCheck size={13} />
                        <span>Analyze</span>
                      </button>
                      <button
                        onClick={() => handleInstallPlugin(plugin)}
                        className="btn btn-primary ext-actions__btn"
                        style={{ flex: 1, fontSize: '0.74rem', padding: '0.25rem' }}
                      >
                        <Download size={13} />
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

      {/* ========================================================================= */}
      {/* VIEW MODE 4: PROVIDERS FLAT LIST VIEW (Dedicated Provider Experience)    */}
      {/* ========================================================================= */}
      {activeTab === 'providers' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
          {/* Controls Bar */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.6rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap', fontSize: '0.76rem' }}>
              <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>Select Providers ({filteredFlatProviders.length}):</span>
              <button onClick={() => selectAllProviders('all')} className="btn btn-secondary" style={{ padding: '0.2rem 0.45rem', fontSize: '0.7rem' }}>
                Select All
              </button>
              <button onClick={() => selectAllProviders('enabled')} className="btn btn-secondary" style={{ padding: '0.2rem 0.45rem', fontSize: '0.7rem' }}>
                Enabled Only
              </button>
              <button onClick={() => selectAllProviders('disabled')} className="btn btn-secondary" style={{ padding: '0.2rem 0.45rem', fontSize: '0.7rem' }}>
                Disabled Only
              </button>
              {selectedProviderNames.size > 0 && (
                <button onClick={() => selectAllProviders('none')} className="btn btn-secondary" style={{ padding: '0.2rem 0.45rem', fontSize: '0.7rem' }}>
                  Clear
                </button>
              )}
            </div>
          </div>

          {/* Provider List Rows */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
            {filteredFlatProviders.slice(0, visibleLimit).map((p) => {
              const isSelected = selectedProviderNames.has(p.providerName);
              const provDetailId = `detail_flatprov_${p.repoName}_${p.extensionInternalName}_${p.providerName}`;
              const isDetailOpen = expandedDetailIds.has(provDetailId);

              return (
                <div
                  key={`${p.repoName}_${p.extensionInternalName}_${p.providerName}`}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    padding: '0.55rem 0.85rem',
                    background: 'var(--bg-card)',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid',
                    borderColor: isSelected
                      ? 'var(--accent-primary)'
                      : p.isDisabled
                      ? 'var(--border-color)'
                      : 'rgba(16, 185, 129, 0.3)',
                    gap: '0.4rem'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', flex: 1, minWidth: 0 }}>
                      <div
                        onClick={() => toggleSelectProvider(p.providerName)}
                        style={{ cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                      >
                        {isSelected ? <CheckSquare size={16} style={{ color: 'var(--accent-light)' }} /> : <Square size={16} style={{ color: 'var(--text-subtle)' }} />}
                      </div>

                      <SlidersHorizontal size={16} style={{ color: p.isDisabled ? 'var(--text-subtle)' : 'var(--status-success)' }} />

                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
                          <span style={{ fontSize: '0.86rem', fontWeight: 600, color: p.isDisabled ? 'var(--text-muted)' : '#fff' }}>
                            {p.providerName}
                          </span>
                          {p.lang && <span className="poster-badge" style={{ position: 'static', fontSize: '0.62rem' }}>{p.lang}</span>}
                          {Array.isArray(p.supportedTypes) && p.supportedTypes.map((t, idx) => (
                            <span key={idx} className="poster-badge" style={{ position: 'static', fontSize: '0.62rem', backgroundColor: 'rgba(59,130,246,0.2)', color: 'var(--accent-light)' }}>
                              {t}
                            </span>
                          ))}
                        </div>

                        {/* Full Ancestry Lineage */}
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-subtle)', marginTop: '0.15rem' }}>
                          <strong>{p.repoName}</strong> ➔ {p.extensionName} ({p.extensionInternalName}) ➔ <span style={{ color: 'var(--accent-light)' }}>{p.providerName}</span>
                        </div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                      <button
                        onClick={() => toggleDetail(provDetailId)}
                        className={`btn ${isDetailOpen ? 'btn-primary' : 'btn-secondary'}`}
                        style={{ padding: '0.2rem 0.45rem', fontSize: '0.72rem', display: 'flex', alignItems: 'center', gap: '0.2rem' }}
                        title="Toggle inline details"
                      >
                        <Eye size={13} />
                        <span>{isDetailOpen ? 'Hide Info' : 'View Info'}</span>
                      </button>

                      <button
                        onClick={() => handleToggleProvider(p.providerName, p.isDisabled)}
                        style={{ background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                        title={p.isDisabled ? 'Enable Provider' : 'Disable Provider'}
                      >
                        {p.isDisabled ? (
                          <ToggleLeft size={20} style={{ color: 'var(--text-subtle)' }} />
                        ) : (
                          <ToggleRight size={20} style={{ color: 'var(--status-success)' }} />
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Inline Detail Strip for Provider */}
                  {isDetailOpen && (
                    <InlineDetailStrip
                      details={{
                        type: 'provider',
                        title: p.providerName,
                        language: p.lang,
                        tvTypes: p.supportedTypes,
                        parentExtension: p.extensionName,
                        parentRepo: p.repoName,
                        status: p.isDisabled ? 'Disabled' : 'Enabled for Search'
                      }}
                    />
                  )}
                </div>
              );
            })}

            {filteredFlatProviders.length > visibleLimit && (
              <button
                onClick={() => setVisibleLimit((prev) => prev + 50)}
                className="btn btn-secondary"
                style={{ alignSelf: 'center', marginTop: '0.5rem', fontSize: '0.76rem' }}
              >
                Load More Providers ({filteredFlatProviders.length - visibleLimit} remaining)
              </button>
            )}
          </div>
        </div>
      )}

      {/* Active Compatibility Analysis Modal */}
      {activeReport && (
        <div style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--accent-primary)',
          borderRadius: 'var(--radius-md)',
          padding: '1.1rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.65rem'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--accent-light)' }}>
              <ShieldCheck size={18} />
              <h3 style={{ fontSize: '0.95rem', fontWeight: 700, margin: 0 }}>
                Plugin Compatibility Analysis: {activeReport.pluginName}
              </h3>
            </div>
            <button onClick={() => setActiveReport(null)} className="btn btn-secondary" style={{ padding: '0.15rem 0.45rem', fontSize: '0.75rem' }}>
              ✕
            </button>
          </div>

          <div style={{ display: 'flex', gap: '1rem', fontSize: '0.78rem', color: 'var(--text-main)' }}>
            <span>Score: <strong>{activeReport.compatibilityScore}%</strong></span>
            <span>Recommended Tier: <strong>{activeReport.recommendedTier}</strong></span>
            <span>Confidence: <strong>{activeReport.confidence}</strong></span>
          </div>

          {Array.isArray(activeReport.details) && (
            <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>
              {activeReport.details.map((d, i) => (
                <p key={i} style={{ margin: '0.2rem 0' }}>• {d}</p>
              ))}
            </div>
          )}
        </div>
      )}

      {/* STICKY FLOATING BOTTOM BULK TOOLBAR */}
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
          padding: '0.65rem 1.1rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.85rem',
          flexWrap: 'wrap',
          maxWidth: '90vw'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', color: '#fff', fontSize: '0.8rem', fontWeight: 600 }}>
            <Sparkles size={15} style={{ color: 'var(--accent-light)' }} />
            <span>
              Selected: {selectedRepoIds.size > 0 && `${selectedRepoIds.size} repo(s) `}
              {selectedPluginNames.size > 0 && `${selectedPluginNames.size} extension(s) `}
              {selectedProviderNames.size > 0 && `${selectedProviderNames.size} provider(s)`}
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'wrap' }}>
            {selectedRepoIds.size > 0 && (
              <>
                <button
                  onClick={handleBulkAddRepos}
                  disabled={Boolean(bulkBusy)}
                  className="btn btn-primary"
                  style={{ fontSize: '0.73rem', padding: '0.3rem 0.65rem' }}
                >
                  <Plus size={12} />
                  <span>Activate Repos</span>
                </button>

                <button
                  onClick={handleBulkSyncRepos}
                  disabled={Boolean(bulkBusy)}
                  className="btn btn-secondary"
                  style={{ fontSize: '0.73rem', padding: '0.3rem 0.65rem' }}
                >
                  <RefreshCw size={12} />
                  <span>Sync Repos</span>
                </button>

                <button
                  onClick={handleBulkDeactivateRepos}
                  disabled={Boolean(bulkBusy)}
                  className="btn btn-danger"
                  style={{ fontSize: '0.73rem', padding: '0.3rem 0.65rem' }}
                >
                  <Trash2 size={12} />
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
                  style={{ fontSize: '0.73rem', padding: '0.3rem 0.65rem' }}
                >
                  <Download size={12} />
                  <span>Install Exts</span>
                </button>

                <button
                  onClick={handleBulkUpdatePlugins}
                  disabled={Boolean(bulkBusy)}
                  className="btn btn-secondary"
                  style={{ fontSize: '0.73rem', padding: '0.3rem 0.65rem' }}
                >
                  <RefreshCw size={12} />
                  <span>Update Exts</span>
                </button>

                <button
                  onClick={handleBulkUninstallPlugins}
                  disabled={Boolean(bulkBusy)}
                  className="btn btn-danger"
                  style={{ fontSize: '0.73rem', padding: '0.3rem 0.65rem' }}
                >
                  <Trash2 size={12} />
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
                  style={{ fontSize: '0.73rem', padding: '0.3rem 0.65rem' }}
                >
                  <ToggleRight size={12} style={{ color: 'var(--status-success)' }} />
                  <span>Enable Providers</span>
                </button>

                <button
                  onClick={() => handleToggleProvidersBulk(Array.from(selectedProviderNames), false)}
                  disabled={Boolean(bulkBusy)}
                  className="btn btn-secondary"
                  style={{ fontSize: '0.73rem', padding: '0.3rem 0.65rem' }}
                >
                  <ToggleLeft size={12} />
                  <span>Disable Providers</span>
                </button>
              </>
            )}

            <button
              onClick={() => setShowPresetModal(true)}
              className="btn btn-secondary"
              style={{ fontSize: '0.73rem', padding: '0.3rem 0.65rem' }}
            >
              <Bookmark size={12} />
              <span>Save Preset</span>
            </button>

            <button
              onClick={clearAllSelections}
              className="btn btn-secondary"
              style={{ fontSize: '0.73rem', padding: '0.3rem 0.55rem' }}
            >
              Clear
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
