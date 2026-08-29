import React from 'react';
import { ShieldCheck, X } from 'lucide-react';
import type { PluginCompatibilityReport } from '../../types/plugin';
import { Badge } from './primitives';

/**
 * Static compatibility classification for one archive, before it is trusted.
 *
 * The score is a *prediction* from reading the bytecode, not an observation of
 * the extension running, and it is labelled that way. The two disagree often
 * enough to matter — an archive can classify well and still fail on a host that
 * blocks it — so presenting this as a verdict would invite the wrong conclusion
 * when a high-scoring extension returns nothing.
 */
/**
 * Four-letter archive codes are for the code, not for a panel someone reads.
 * `CSJ` in particular means nothing to anyone who has not read the PRD.
 */
const FORMAT_LABELS: Record<PluginCompatibilityReport['format'], string> = {
  CS3: 'Android archive (.cs3, DEX)',
  CSJ: 'Cross-platform JVM jar',
  JS: 'JavaScript',
  KMP: 'Kotlin Multiplatform',
};

export const CompatibilityReport: React.FC<{
  report: PluginCompatibilityReport;
  onClose: () => void;
}> = ({ report, onClose }) => {
  const tone =
    report.compatibilityScore >= 80
      ? 'success'
      : report.compatibilityScore >= 50
        ? 'warning'
        : 'danger';

  return (
    <div className="ext-panel ext-panel--pad" style={{ borderColor: 'var(--accent-primary)' }}>
      <div className="ext-row__head" style={{ padding: 0 }}>
        <ShieldCheck size={16} style={{ color: 'var(--accent-light)', flex: 'none' }} />
        <div className="ext-row__grow">
          <div className="ext-row__title">
            <span>Compatibility analysis: {report.pluginName}</span>
            <Badge tone={tone}>{report.compatibilityScore}%</Badge>
            <Badge>{report.confidence} confidence</Badge>
            {/*
              The one badge here that is an observation rather than a
              prediction: a cross-platform jar has no DEX, so nothing about it
              is translated and the whole class of translation defect cannot
              apply. Worth saying on the row, because it is also the lever —
              an author who sees this is being shown what opting in buys.
            */}
            {report.format === 'CSJ' && <Badge tone="success">Cross-platform jar</Badge>}
          </div>
          <div className="ext-row__subtitle">
            Predicted from the archive's bytecode — not a record of it running.
          </div>
        </div>
        <button type="button" className="ext-btn" onClick={onClose} title="Close">
          <X size={12} />
        </button>
      </div>

      <div className="ext-provenance__grid" style={{ marginTop: '0.7rem' }}>
        <div className="ext-provenance__field">
          <span className="ext-provenance__key">Recommended tier</span>
          <span className="ext-provenance__value">{report.recommendedTier}</span>
        </div>
        <div className="ext-provenance__field">
          <span className="ext-provenance__key">Format</span>
          <span className="ext-provenance__value">{FORMAT_LABELS[report.format]}</span>
        </div>
        <div className="ext-provenance__field">
          <span className="ext-provenance__key">Android API references</span>
          <span className="ext-provenance__value">{report.androidApiReferences}</span>
        </div>
        <div className="ext-provenance__field">
          <span className="ext-provenance__key">Network stack</span>
          <span className="ext-provenance__value">{report.networkStack}</span>
        </div>
        <div className="ext-provenance__field">
          <span className="ext-provenance__key">HTML parser</span>
          <span className="ext-provenance__value">{report.htmlParser}</span>
        </div>
        <div className="ext-provenance__field">
          <span className="ext-provenance__key">Native libraries</span>
          <span className="ext-provenance__value">{report.hasNativeLibs ? 'Present' : 'None'}</span>
        </div>
      </div>

      {Array.isArray(report.details) && report.details.length > 0 && (
        <ul
          style={{
            margin: '0.7rem 0 0',
            paddingLeft: '1.1rem',
            fontSize: '0.76rem',
            color: 'var(--text-muted)',
            lineHeight: 1.6,
          }}
        >
          {report.details.map((detail, index) => (
            <li key={index}>{detail}</li>
          ))}
        </ul>
      )}
    </div>
  );
};
