import React, { useEffect, useState, useCallback } from 'react';
import { Cpu, CheckCircle2, AlertCircle, RefreshCw, Download } from 'lucide-react';
import type { SystemRuntimeStatus, RuntimeProgress } from '../../electron/cs3/runtimeProvisioner';

export const RuntimeProvisionerCard: React.FC = () => {
  const [status, setStatus] = useState<SystemRuntimeStatus | null>(null);
  const [progress, setProgress] = useState<RuntimeProgress | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await window.cloudstream?.getSystemRuntimeStatus?.();
      if (res && res.ok !== false) {
        setStatus(res as unknown as SystemRuntimeStatus);
      }
    } catch (err) {
      console.warn('Failed to fetch runtime status:', err);
    }
  }, []);

  useEffect(() => {
    void fetchStatus();

    const unsub = window.cloudstream?.onSystemRuntimeProgress?.((p) => {
      setProgress(p);
      if (p.step === 'completed' || p.step === 'error') {
        setIsBusy(false);
        void fetchStatus();
      }
    });

    return () => {
      unsub?.();
    };
  }, [fetchStatus]);

  const handleProvision = async () => {
    setIsBusy(true);
    setProgress({ step: 'checking', progress: 5, message: 'Preparing CloudStream Runtime...' });
    const res = await window.cloudstream?.provisionSystemRuntime?.();
    if (!res?.ok) {
      setIsBusy(false);
    }
    await fetchStatus();
  };

  const handleRepair = async () => {
    setIsBusy(true);
    setProgress({ step: 'checking', progress: 5, message: 'Repairing CloudStream Runtime...' });
    const res = await window.cloudstream?.repairSystemRuntime?.();
    if (!res?.ok) {
      setIsBusy(false);
    }
    await fetchStatus();
  };

  return (
    <section className="setting-group" style={{ marginBottom: '1.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
        <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0 }}>
          <Cpu size={16} />
          CloudStream Extension Runtime
        </h3>
        {status?.ready ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', color: '#10b981', fontSize: '0.85rem', fontWeight: 600 }}>
            <CheckCircle2 size={14} /> Ready
          </span>
        ) : (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', color: '#f59e0b', fontSize: '0.85rem', fontWeight: 600 }}>
            <AlertCircle size={14} /> Setup Required
          </span>
        )}
      </div>

      <p className="diag__intro" style={{ marginBottom: '1rem' }}>
        The extension runtime runs Android <code>.cs3</code> community extensions in an isolated process. All dependencies are managed automatically for a plug-and-play experience.
      </p>

      <div style={{ background: 'rgba(255, 255, 255, 0.03)', borderRadius: '8px', padding: '0.85rem 1rem', marginBottom: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.875rem' }}>
          <span>Java 21 Execution Engine:</span>
          <strong>{status?.javaReady ? status.javaVersion ?? 'Java 21 Ready' : 'Not Provisioned'}</strong>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.875rem' }}>
          <span>Extension Compatibility Layer:</span>
          <strong>{status?.sidecarReady ? 'Ready (cs3-sidecar.jar)' : 'Not Provisioned'}</strong>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.875rem' }}>
          <span>CloudStream Provider Bridge:</span>
          <strong>{status?.bridgeReady ? 'Ready (library-jvm 4.8.0)' : 'Not Provisioned'}</strong>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.875rem' }}>
          <span>Runtime Environment:</span>
          <strong>{status?.isAppManaged ? 'Application Managed (%APPDATA%)' : 'Bundled / Local'}</strong>
        </div>
      </div>

      {isBusy && progress && (
        <div style={{ marginBottom: '1rem', background: 'rgba(59, 130, 246, 0.1)', border: '1px solid rgba(59, 130, 246, 0.3)', borderRadius: '8px', padding: '0.75rem 1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '0.35rem' }}>
            <span>{progress.message}</span>
            <span>{progress.progress}%</span>
          </div>
          <div style={{ width: '100%', height: '6px', background: 'rgba(255, 255, 255, 0.1)', borderRadius: '3px', overflow: 'hidden' }}>
            <div style={{ width: `${progress.progress}%`, height: '100%', background: '#3b82f6', transition: 'width 0.2s ease' }} />
          </div>
          {progress.error && (
            <div style={{ color: '#ef4444', fontSize: '0.8rem', marginTop: '0.35rem' }}>
              Error: {progress.error}
            </div>
          )}
        </div>
      )}

      {status?.reason && !status.ready && (
        <div style={{ color: '#f59e0b', fontSize: '0.85rem', marginBottom: '1rem' }}>
          {status.reason}
        </div>
      )}

      <div style={{ display: 'flex', gap: '0.75rem' }}>
        <button
          className={`btn ${status?.ready ? 'btn-secondary' : 'btn-primary'}`}
          onClick={handleProvision}
          disabled={isBusy}
        >
          <Download size={14} />
          <span>{status?.ready ? 'Re-provision Components' : 'Install Required Components'}</span>
        </button>

        <button
          className="btn btn-secondary"
          onClick={handleRepair}
          disabled={isBusy}
        >
          <RefreshCw size={14} />
          <span>Repair Runtime</span>
        </button>
      </div>
    </section>
  );
};
