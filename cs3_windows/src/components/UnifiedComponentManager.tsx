import React, { useState, useEffect, useCallback } from 'react';
import {
  Cpu,
  Download,
  CheckCircle2,
  AlertCircle,
  Trash2,
  CheckSquare,
  Square,
  Loader2,
  ChevronDown,
  ChevronRight,
  ShieldCheck,
  Zap,
  Wrench,
  Activity,
} from 'lucide-react';
import type { SystemRuntimeStatus, RuntimeProgress } from '../../electron/cs3/runtimeProvisioner';

export interface ComponentSuiteState {
  runtime: SystemRuntimeStatus | null;
  binaries: {
    aria2: boolean;
    ytdlp: boolean;
    ffmpeg: boolean;
    ffprobe: boolean;
  } | null;
  tests: {
    runtime?: { ok: boolean; version?: string; error?: string };
    aria2?: { ok: boolean; version?: string; error?: string };
    ytdlp?: { ok: boolean; version?: string; error?: string };
    ffmpeg?: { ok: boolean; version?: string; error?: string };
    ffprobe?: { ok: boolean; version?: string; error?: string };
  };
}

export const UnifiedComponentManager: React.FC = () => {
  const [suiteState, setSuiteState] = useState<ComponentSuiteState>({
    runtime: null,
    binaries: null,
    tests: {},
  });

  const [selected, setSelected] = useState<Set<'runtime' | 'downloads' | 'media'>>(
    new Set(['runtime', 'downloads', 'media'])
  );

  const [activeProgress, setActiveProgress] = useState<{
    component: string;
    step: string;
    message: string;
    percent: number;
    error?: string;
  } | null>(null);

  const [busyMap, setBusyMap] = useState<Record<string, boolean>>({});
  const [openDisclosures, setOpenDisclosures] = useState<Record<string, boolean>>({});
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const flash = (msg: string) => {
    setStatusMessage(msg);
    setTimeout(() => setStatusMessage(null), 4000);
  };

  const refreshStatus = useCallback(async () => {
    try {
      const [runtimeRes, binariesRes] = await Promise.all([
        window.cloudstream?.getSystemRuntimeStatus?.(),
        window.cloudstream?.checkBinaries?.(),
      ]);

      setSuiteState((prev) => ({
        ...prev,
        runtime: (runtimeRes as unknown as SystemRuntimeStatus) || null,
        binaries: binariesRes || null,
      }));
    } catch (err) {
      console.warn('Failed to refresh component status:', err);
    }
  }, []);

  useEffect(() => {
    void refreshStatus();

    // Listen for runtime progress
    const unsubRuntime = window.cloudstream?.onSystemRuntimeProgress?.((p: RuntimeProgress) => {
      setActiveProgress({
        component: 'runtime',
        step: p.step,
        message: p.message,
        percent: p.progress,
        error: p.error,
      });

      if (p.step === 'completed' || p.step === 'error') {
        setBusyMap((prev) => ({ ...prev, runtime: false }));
        void refreshStatus();
        if (p.step === 'completed') {
          setTimeout(() => setActiveProgress(null), 3000);
        }
      } else {
        setBusyMap((prev) => ({ ...prev, runtime: true }));
      }
    });

    // Listen for binary setup progress
    const unsubBinaries = window.cloudstream?.onBinarySetupProgress?.(
      (p: { component?: string; status: string; percent: number }) => {
        const comp = p.component || 'downloads';
        setActiveProgress({
          component: comp,
          step: p.percent >= 100 ? 'completed' : 'downloading',
          message: p.status,
          percent: p.percent,
        });

        if (p.percent >= 100) {
          setBusyMap((prev) => ({ ...prev, [comp]: false }));
          void refreshStatus();
          setTimeout(() => setActiveProgress(null), 3000);
        } else {
          setBusyMap((prev) => ({ ...prev, [comp]: true }));
        }
      }
    );

    return () => {
      unsubRuntime?.();
      unsubBinaries?.();
    };
  }, [refreshStatus]);

  const toggleSelect = (key: 'runtime' | 'downloads' | 'media') => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selected.size === 3) {
      setSelected(new Set());
    } else {
      setSelected(new Set(['runtime', 'downloads', 'media']));
    }
  };

  const toggleDisclosure = (key: string) => {
    setOpenDisclosures((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  // --- Actions ---

  const handleTestComponent = async (key: 'runtime' | 'downloads' | 'media') => {
    setBusyMap((prev) => ({ ...prev, [key]: true }));
    try {
      if (key === 'runtime') {
        const res = await window.cloudstream?.testSystemRuntime?.();
        setSuiteState((prev) => ({
          ...prev,
          tests: { ...prev.tests, runtime: res },
        }));
        if (res?.ok) flash('Extension Runtime verified: ' + (res.version || 'Ready'));
        else flash('Extension Runtime verification issue: ' + (res?.error || 'Failed'));
      } else if (key === 'downloads') {
        const [aria2, ytdlp] = await Promise.all([
          window.cloudstream?.testBinary?.('aria2c'),
          window.cloudstream?.testBinary?.('yt-dlp'),
        ]);
        setSuiteState((prev) => ({
          ...prev,
          tests: { ...prev.tests, aria2, ytdlp },
        }));
        const ok = aria2?.ok && ytdlp?.ok;
        flash(ok ? 'Download engines verified and operational.' : 'Some download engines missing.');
      } else if (key === 'media') {
        const [ffmpeg, ffprobe] = await Promise.all([
          window.cloudstream?.testBinary?.('ffmpeg'),
          window.cloudstream?.testBinary?.('ffprobe'),
        ]);
        setSuiteState((prev) => ({
          ...prev,
          tests: { ...prev.tests, ffmpeg, ffprobe },
        }));
        const ok = ffmpeg?.ok && ffprobe?.ok;
        flash(ok ? 'Media components verified and operational.' : 'Some media components missing.');
      }
    } catch (err: any) {
      flash('Testing failed: ' + (err?.message || 'Unknown error'));
    } finally {
      setBusyMap((prev) => ({ ...prev, [key]: false }));
      await refreshStatus();
    }
  };

  const handleTestAll = async () => {
    await Promise.all([
      handleTestComponent('runtime'),
      handleTestComponent('downloads'),
      handleTestComponent('media'),
    ]);
  };

  const handleInstallComponent = async (key: 'runtime' | 'downloads' | 'media') => {
    if (busyMap[key]) return;
    setBusyMap((prev) => ({ ...prev, [key]: true }));

    try {
      if (key === 'runtime') {
        setActiveProgress({
          component: 'runtime',
          step: 'checking',
          message: 'Preparing CloudStream Runtime...',
          percent: 5,
        });
        const res = await window.cloudstream?.provisionSystemRuntime?.();
        if (res?.ready) flash('CloudStream Extension Runtime installed successfully.');
        else flash('Runtime installation could not be completed.');
      } else if (key === 'downloads') {
        setActiveProgress({
          component: 'downloads',
          step: 'checking',
          message: 'Installing aria2c and yt-dlp...',
          percent: 10,
        });
        await window.cloudstream?.setupAria2?.();
        await window.cloudstream?.setupYtDlp?.();
        flash('Download engines installed and ready.');
      } else if (key === 'media') {
        setActiveProgress({
          component: 'media',
          step: 'checking',
          message: 'Installing media components (ffmpeg & ffprobe)...',
          percent: 10,
        });
        const res = await window.cloudstream?.setupFfmpeg?.();
        flash(res?.ok ? 'Media components installed.' : (res?.message || 'Installation finished.'));
      }
    } catch (err: any) {
      flash('Installation failed: ' + (err?.message || 'Error occurred'));
    } finally {
      setBusyMap((prev) => ({ ...prev, [key]: false }));
      await refreshStatus();
    }
  };

  const handleInstallSelected = async () => {
    if (selected.size === 0) {
      flash('Please select at least one component to install.');
      return;
    }

    for (const key of selected) {
      await handleInstallComponent(key);
    }
  };

  const handleRemoveComponent = async (key: 'runtime' | 'downloads' | 'media') => {
    if (busyMap[key]) return;
    setBusyMap((prev) => ({ ...prev, [key]: true }));

    try {
      if (key === 'runtime') {
        const res = await window.cloudstream?.cleanSystemRuntime?.();
        flash(res?.ok ? 'Extension runtime removed.' : 'Could not remove runtime.');
      } else if (key === 'downloads') {
        await window.cloudstream?.removeBinary?.('downloads');
        flash('Download engine binaries removed.');
      } else if (key === 'media') {
        await window.cloudstream?.removeBinary?.('media');
        flash('Media component binaries removed.');
      }
    } catch (err: any) {
      flash('Removal failed: ' + (err?.message || 'Error'));
    } finally {
      setBusyMap((prev) => ({ ...prev, [key]: false }));
      await refreshStatus();
    }
  };

  // Status summaries
  const isRuntimeReady = Boolean(suiteState.runtime?.ready);
  const isDownloadsReady = Boolean(suiteState.binaries?.aria2 && suiteState.binaries?.ytdlp);
  const isMediaReady = Boolean(suiteState.binaries?.ffmpeg && suiteState.binaries?.ffprobe);

  const readyCount = (isRuntimeReady ? 1 : 0) + (isDownloadsReady ? 1 : 0) + (isMediaReady ? 1 : 0);
  const totalCount = 3;
  const anyMissing = readyCount < totalCount;
  const isAnyBusy = Object.values(busyMap).some(Boolean);

  return (
    <div className="component-manager" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {/* Top Health Overview & Action Banner */}
      <div
        style={{
          background: anyMissing
            ? 'linear-gradient(135deg, rgba(245, 158, 11, 0.12) 0%, rgba(17, 24, 39, 0.6) 100%)'
            : 'linear-gradient(135deg, rgba(16, 185, 129, 0.12) 0%, rgba(17, 24, 39, 0.6) 100%)',
          border: `1px solid ${anyMissing ? 'rgba(245, 158, 11, 0.35)' : 'rgba(16, 185, 129, 0.35)'}`,
          borderRadius: '12px',
          padding: '1.25rem 1.5rem',
          boxShadow: '0 4px 20px rgba(0, 0, 0, 0.3)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.4rem' }}>
              {anyMissing ? (
                <AlertCircle size={20} style={{ color: '#f59e0b' }} />
              ) : (
                <CheckCircle2 size={20} style={{ color: '#10b981' }} />
              )}
              <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 600 }}>
                {anyMissing ? `${totalCount - readyCount} Required Component${totalCount - readyCount > 1 ? 's' : ''} Need Setup` : 'All External Components Operational'}
              </h3>
            </div>
            <p style={{ margin: 0, fontSize: '0.875rem', color: 'rgba(255, 255, 255, 0.7)', maxWidth: '640px' }}>
              All dependencies (Java execution engine, download accelerators, and audio transcoders) run in isolated app storage without system-wide changes.
            </p>
          </div>

          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button
              className="btn btn-secondary"
              onClick={handleTestAll}
              disabled={isAnyBusy}
              title="Test existing binaries without downloading"
            >
              {isAnyBusy ? <Loader2 size={14} className="spin" /> : <ShieldCheck size={14} />}
              <span>Test All</span>
            </button>

            <button
              className={`btn ${anyMissing ? 'btn-primary' : 'btn-secondary'}`}
              onClick={handleInstallSelected}
              disabled={isAnyBusy || selected.size === 0}
            >
              {isAnyBusy ? <Loader2 size={14} className="spin" /> : <Download size={14} />}
              <span>{anyMissing ? 'Install Selected' : 'Reinstall Selected'}</span>
            </button>
          </div>
        </div>

        {/* Global Action & Selection Bar */}
        <div
          style={{
            marginTop: '1rem',
            paddingTop: '0.85rem',
            borderTop: '1px solid rgba(255, 255, 255, 0.08)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: '0.825rem',
          }}
        >
          <div
            style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', userSelect: 'none' }}
            onClick={toggleSelectAll}
          >
            {selected.size === 3 ? (
              <CheckSquare size={16} style={{ color: '#3b82f6' }} />
            ) : (
              <Square size={16} style={{ color: 'rgba(255, 255, 255, 0.4)' }} />
            )}
            <span style={{ fontWeight: 500 }}>Select All Components ({selected.size}/3)</span>
          </div>

          <div style={{ color: 'rgba(255, 255, 255, 0.5)' }}>
            Status: <strong>{readyCount} of {totalCount} Ready</strong>
          </div>
        </div>
      </div>

      {statusMessage && (
        <div
          style={{
            background: 'rgba(59, 130, 246, 0.15)',
            border: '1px solid rgba(59, 130, 246, 0.4)',
            color: '#93c5fd',
            borderRadius: '8px',
            padding: '0.6rem 1rem',
            fontSize: '0.85rem',
          }}
        >
          {statusMessage}
        </div>
      )}

      {/* Progress Toast / Active Operation Bar */}
      {activeProgress && (
        <div
          style={{
            background: 'rgba(30, 58, 138, 0.3)',
            border: '1px solid rgba(59, 130, 246, 0.4)',
            borderRadius: '8px',
            padding: '0.75rem 1rem',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '0.35rem' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Loader2 size={14} className="spin" style={{ color: '#60a5fa' }} />
              {activeProgress.message}
            </span>
            <span style={{ fontWeight: 600 }}>{activeProgress.percent}%</span>
          </div>
          <div style={{ width: '100%', height: '6px', background: 'rgba(255, 255, 255, 0.1)', borderRadius: '3px', overflow: 'hidden' }}>
            <div
              style={{
                width: `${Math.max(5, activeProgress.percent)}%`,
                height: '100%',
                background: '#3b82f6',
                transition: 'width 0.25s ease',
              }}
            />
          </div>
        </div>
      )}

      {/* COMPONENT 1: CloudStream Extension Runtime */}
      <div
        className="settings-card"
        style={{
          border: `1px solid ${isRuntimeReady ? 'rgba(255, 255, 255, 0.08)' : 'rgba(245, 158, 11, 0.35)'}`,
          position: 'relative',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}>
            <div
              style={{ cursor: 'pointer', marginTop: '0.2rem' }}
              onClick={() => toggleSelect('runtime')}
            >
              {selected.has('runtime') ? (
                <CheckSquare size={18} style={{ color: '#3b82f6' }} />
              ) : (
                <Square size={18} style={{ color: 'rgba(255, 255, 255, 0.4)' }} />
              )}
            </div>

            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Cpu size={18} style={{ color: '#818cf8' }} />
                <h4 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>CloudStream Extension Runtime</h4>
              </div>
              <p style={{ margin: '0.35rem 0 0 0', fontSize: '0.85rem', color: 'rgba(255, 255, 255, 0.65)' }}>
                Runs community Android <code>.cs3</code> extensions in a secure, sandboxed JVM process. Includes OpenJDK 21, DEX compatibility layer, and provider bridge.
              </p>
            </div>
          </div>

          <div>
            {isRuntimeReady ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', color: '#10b981', fontSize: '0.85rem', fontWeight: 600 }}>
                <CheckCircle2 size={15} /> Ready
              </span>
            ) : (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', color: '#f59e0b', fontSize: '0.85rem', fontWeight: 600 }}>
                <AlertCircle size={15} /> Setup Required
              </span>
            )}
          </div>
        </div>

        {/* Verification / Test Badge */}
        {suiteState.tests.runtime && (
          <div
            style={{
              marginTop: '0.75rem',
              padding: '0.4rem 0.75rem',
              borderRadius: '6px',
              fontSize: '0.8rem',
              background: suiteState.tests.runtime.ok ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
              color: suiteState.tests.runtime.ok ? '#34d399' : '#f87171',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
            }}
          >
            <Activity size={13} />
            <span>Test Result: {suiteState.tests.runtime.ok ? `${suiteState.tests.runtime.version} • Verified Executable` : suiteState.tests.runtime.error}</span>
          </div>
        )}

        {/* Action Buttons */}
        <div style={{ marginTop: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              className="btn btn-secondary"
              onClick={() => handleTestComponent('runtime')}
              disabled={busyMap.runtime}
              title="Test Java binary and sidecar jar"
            >
              {busyMap.runtime ? <Loader2 size={13} className="spin" /> : <ShieldCheck size={13} />}
              <span>Test Runtime</span>
            </button>

            <button
              className={`btn ${isRuntimeReady ? 'btn-secondary' : 'btn-primary'}`}
              onClick={() => handleInstallComponent('runtime')}
              disabled={busyMap.runtime}
            >
              {busyMap.runtime ? <Loader2 size={13} className="spin" /> : <Download size={13} />}
              <span>{isRuntimeReady ? 'Re-provision' : 'Install Runtime'}</span>
            </button>

            <button
              className="btn btn-secondary"
              onClick={() => handleRemoveComponent('runtime')}
              disabled={busyMap.runtime}
              title="Remove runtime files to do a clean reinstall"
            >
              <Trash2 size={13} />
              <span>Clean</span>
            </button>
          </div>

          <button
            className="settings-card__disclosure"
            style={{ background: 'none', border: 'none', color: 'rgba(255, 255, 255, 0.5)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.8rem' }}
            onClick={() => toggleDisclosure('runtime')}
          >
            {openDisclosures.runtime ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            Technical Details
          </button>
        </div>

        {openDisclosures.runtime && (
          <div style={{ marginTop: '0.75rem', padding: '0.75rem', background: 'rgba(0, 0, 0, 0.25)', borderRadius: '6px', fontSize: '0.8rem', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            <div>Java 21 Binary: <strong>{suiteState.runtime?.javaReady ? suiteState.runtime.javaVersion ?? 'Present' : 'Not Detected'}</strong></div>
            <div>Extension Compatibility Layer: <strong>{suiteState.runtime?.sidecarReady ? 'Ready (cs3-sidecar.jar)' : 'Not Provisioned'}</strong></div>
            <div>CloudStream Provider Bridge: <strong>{suiteState.runtime?.bridgeReady ? 'Ready (library-jvm 4.8.0)' : 'Not Provisioned'}</strong></div>
            <div>Managed Environment: <strong>{suiteState.runtime?.isAppManaged ? 'Application Managed (%APPDATA%)' : 'Bundled / Local'}</strong></div>
          </div>
        )}
      </div>

      {/* COMPONENT 2: High-Performance Download Engines (aria2c & yt-dlp) */}
      <div
        className="settings-card"
        style={{
          border: `1px solid ${isDownloadsReady ? 'rgba(255, 255, 255, 0.08)' : 'rgba(245, 158, 11, 0.35)'}`,
          position: 'relative',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}>
            <div
              style={{ cursor: 'pointer', marginTop: '0.2rem' }}
              onClick={() => toggleSelect('downloads')}
            >
              {selected.has('downloads') ? (
                <CheckSquare size={18} style={{ color: '#3b82f6' }} />
              ) : (
                <Square size={18} style={{ color: 'rgba(255, 255, 255, 0.4)' }} />
              )}
            </div>

            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Zap size={18} style={{ color: '#38bdf8' }} />
                <h4 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>Download Engines (aria2c & yt-dlp)</h4>
              </div>
              <p style={{ margin: '0.35rem 0 0 0', fontSize: '0.85rem', color: 'rgba(255, 255, 255, 0.65)' }}>
                Multi-connection HTTP downloader and stream extractor. Enables lightning-fast parallel segment downloading and video stream capture.
              </p>
            </div>
          </div>

          <div>
            {isDownloadsReady ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', color: '#10b981', fontSize: '0.85rem', fontWeight: 600 }}>
                <CheckCircle2 size={15} /> Ready
              </span>
            ) : (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', color: '#f59e0b', fontSize: '0.85rem', fontWeight: 600 }}>
                <AlertCircle size={15} /> Setup Required
              </span>
            )}
          </div>
        </div>

        {/* Verification Badges */}
        {(suiteState.tests.aria2 || suiteState.tests.ytdlp) && (
          <div
            style={{
              marginTop: '0.75rem',
              padding: '0.4rem 0.75rem',
              borderRadius: '6px',
              fontSize: '0.8rem',
              background: 'rgba(59, 130, 246, 0.1)',
              color: '#93c5fd',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.2rem',
            }}
          >
            {suiteState.tests.aria2 && (
              <div>aria2c: {suiteState.tests.aria2.ok ? `✓ ${suiteState.tests.aria2.version}` : `✗ ${suiteState.tests.aria2.error}`}</div>
            )}
            {suiteState.tests.ytdlp && (
              <div>yt-dlp: {suiteState.tests.ytdlp.ok ? `✓ ${suiteState.tests.ytdlp.version}` : `✗ ${suiteState.tests.ytdlp.error}`}</div>
            )}
          </div>
        )}

        {/* Action Buttons */}
        <div style={{ marginTop: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              className="btn btn-secondary"
              onClick={() => handleTestComponent('downloads')}
              disabled={busyMap.downloads}
              title="Test aria2c and yt-dlp execution"
            >
              {busyMap.downloads ? <Loader2 size={13} className="spin" /> : <ShieldCheck size={13} />}
              <span>Test Binaries</span>
            </button>

            <button
              className={`btn ${isDownloadsReady ? 'btn-secondary' : 'btn-primary'}`}
              onClick={() => handleInstallComponent('downloads')}
              disabled={busyMap.downloads}
            >
              {busyMap.downloads ? <Loader2 size={13} className="spin" /> : <Download size={13} />}
              <span>{isDownloadsReady ? 'Reinstall' : 'Install Engines'}</span>
            </button>

            <button
              className="btn btn-secondary"
              onClick={() => handleRemoveComponent('downloads')}
              disabled={busyMap.downloads}
              title="Remove aria2c and yt-dlp"
            >
              <Trash2 size={13} />
              <span>Remove</span>
            </button>
          </div>

          <button
            className="settings-card__disclosure"
            style={{ background: 'none', border: 'none', color: 'rgba(255, 255, 255, 0.5)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.8rem' }}
            onClick={() => toggleDisclosure('downloads')}
          >
            {openDisclosures.downloads ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            Technical Details
          </button>
        </div>

        {openDisclosures.downloads && (
          <div style={{ marginTop: '0.75rem', padding: '0.75rem', background: 'rgba(0, 0, 0, 0.25)', borderRadius: '6px', fontSize: '0.8rem', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            <div>aria2c binary: <strong>{suiteState.binaries?.aria2 ? 'Installed (%USERPROFILE%\\AppData\\...\\bin\\aria2c.exe)' : 'Not Installed'}</strong></div>
            <div>yt-dlp binary: <strong>{suiteState.binaries?.ytdlp ? 'Installed (%USERPROFILE%\\AppData\\...\\bin\\yt-dlp.exe)' : 'Not Installed'}</strong></div>
          </div>
        )}
      </div>

      {/* COMPONENT 3: Media Transcoding & Audio Suite (ffmpeg & ffprobe) */}
      <div
        className="settings-card"
        style={{
          border: `1px solid ${isMediaReady ? 'rgba(255, 255, 255, 0.08)' : 'rgba(245, 158, 11, 0.35)'}`,
          position: 'relative',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}>
            <div
              style={{ cursor: 'pointer', marginTop: '0.2rem' }}
              onClick={() => toggleSelect('media')}
            >
              {selected.has('media') ? (
                <CheckSquare size={18} style={{ color: '#3b82f6' }} />
              ) : (
                <Square size={18} style={{ color: 'rgba(255, 255, 255, 0.4)' }} />
              )}
            </div>

            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Wrench size={18} style={{ color: '#f43f5e' }} />
                <h4 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>Media Components (FFmpeg & FFprobe)</h4>
              </div>
              <p style={{ margin: '0.35rem 0 0 0', fontSize: '0.85rem', color: 'rgba(255, 255, 255, 0.65)' }}>
                Audio transcoding and format compatibility engine. Identifies and decodes AC-3, E-AC-3, and DTS audio so videos with unsupported audio play with full sound.
              </p>
            </div>
          </div>

          <div>
            {isMediaReady ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', color: '#10b981', fontSize: '0.85rem', fontWeight: 600 }}>
                <CheckCircle2 size={15} /> Ready
              </span>
            ) : (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', color: '#f59e0b', fontSize: '0.85rem', fontWeight: 600 }}>
                <AlertCircle size={15} /> Setup Required
              </span>
            )}
          </div>
        </div>

        {/* Verification Badges */}
        {(suiteState.tests.ffmpeg || suiteState.tests.ffprobe) && (
          <div
            style={{
              marginTop: '0.75rem',
              padding: '0.4rem 0.75rem',
              borderRadius: '6px',
              fontSize: '0.8rem',
              background: 'rgba(59, 130, 246, 0.1)',
              color: '#93c5fd',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.2rem',
            }}
          >
            {suiteState.tests.ffmpeg && (
              <div>ffmpeg: {suiteState.tests.ffmpeg.ok ? `✓ ${suiteState.tests.ffmpeg.version}` : `✗ ${suiteState.tests.ffmpeg.error}`}</div>
            )}
            {suiteState.tests.ffprobe && (
              <div>ffprobe: {suiteState.tests.ffprobe.ok ? `✓ ${suiteState.tests.ffprobe.version}` : `✗ ${suiteState.tests.ffprobe.error}`}</div>
            )}
          </div>
        )}

        {/* Action Buttons */}
        <div style={{ marginTop: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              className="btn btn-secondary"
              onClick={() => handleTestComponent('media')}
              disabled={busyMap.media}
              title="Test ffmpeg and ffprobe"
            >
              {busyMap.media ? <Loader2 size={13} className="spin" /> : <ShieldCheck size={13} />}
              <span>Test Media Tools</span>
            </button>

            <button
              className={`btn ${isMediaReady ? 'btn-secondary' : 'btn-primary'}`}
              onClick={() => handleInstallComponent('media')}
              disabled={busyMap.media}
            >
              {busyMap.media ? <Loader2 size={13} className="spin" /> : <Download size={13} />}
              <span>{isMediaReady ? 'Reinstall' : 'Install Components'}</span>
            </button>

            <button
              className="btn btn-secondary"
              onClick={() => handleRemoveComponent('media')}
              disabled={busyMap.media}
              title="Remove ffmpeg and ffprobe"
            >
              <Trash2 size={13} />
              <span>Remove</span>
            </button>
          </div>

          <button
            className="settings-card__disclosure"
            style={{ background: 'none', border: 'none', color: 'rgba(255, 255, 255, 0.5)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.8rem' }}
            onClick={() => toggleDisclosure('media')}
          >
            {openDisclosures.media ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            Technical Details
          </button>
        </div>

        {openDisclosures.media && (
          <div style={{ marginTop: '0.75rem', padding: '0.75rem', background: 'rgba(0, 0, 0, 0.25)', borderRadius: '6px', fontSize: '0.8rem', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            <div>ffmpeg: <strong>{suiteState.binaries?.ffmpeg ? 'Installed (%USERPROFILE%\\AppData\\...\\bin\\ffmpeg.exe)' : 'Not Installed'}</strong></div>
            <div>ffprobe: <strong>{suiteState.binaries?.ffprobe ? 'Installed (%USERPROFILE%\\AppData\\...\\bin\\ffprobe.exe)' : 'Not Installed'}</strong></div>
          </div>
        )}
      </div>
    </div>
  );
};
