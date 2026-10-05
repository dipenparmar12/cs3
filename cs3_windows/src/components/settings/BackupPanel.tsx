import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  Check,
  ChevronDown,
  ChevronRight,
  Download,
  GitMerge,
  Loader2,
  Replace,
  RotateCw,
  Sparkles,
  Undo2,
  Upload,
} from 'lucide-react';
import type {
  BackupAnalysis,
  BackupSectionAnalysis,
  ConflictResolution,
  RestoreMode,
  RestoreSummary,
  SectionResolution,
} from '../../types/backup';
import { useFlash } from '../../utils/useFlash';
import { formatBytes } from '../../utils/format';
import { InfoHint } from './InfoHint';
import {
  GROUP_LABELS,
  GROUP_ORDER,
  buildPlan,
  changesSomething,
  defaultSelection,
  describeComparison,
  describeCounts,
  isRestorable,
  itemNoun,
  reviewCounts,
} from './restoreReview';

/**
 * Take this installation somewhere else, and bring back as much of it as you
 * want.
 *
 * Restoring is a short sequence rather than one button, because a restore
 * writes over live data and the only honest basis for confirming one is what
 * is *in* the file compared with what is *here*:
 *
 *   summary → how to restore → what to restore → review → result
 *
 * Every number on these screens comes from the main process comparing the file
 * with this installation (`BackupService.analyze`); nothing is guessed from the
 * filename or the file's own summary. Smart restore is the default and the
 * only mode shown until asked for more — it is the one that cannot surprise.
 */

type Step = 'summary' | 'mode' | 'select' | 'review' | 'done';

const STEPS: Array<{ id: Exclude<Step, 'done'>; label: string }> = [
  { id: 'summary', label: 'Backup' },
  { id: 'mode', label: 'How' },
  { id: 'select', label: 'What' },
  { id: 'review', label: 'Review' },
];

const MODES: Array<{
  id: RestoreMode;
  label: string;
  icon: React.ReactNode;
  text: string;
}> = [
  {
    id: 'smart',
    label: 'Smart restore',
    icon: <Sparkles size={16} />,
    text:
      'Adds what is new, keeps whichever copy changed most recently, and asks you only about things that differ with no way to tell which is right.',
  },
  {
    id: 'merge',
    label: 'Merge',
    icon: <GitMerge size={16} />,
    text: 'Adds everything from the backup and updates what differs. Nothing on this computer is removed.',
  },
  {
    id: 'replace',
    label: 'Replace',
    icon: <Replace size={16} />,
    text:
      'Makes each category you choose match the backup exactly — anything in it that is not in the backup is removed. Your current data is saved first so you can undo.',
  },
];

const RESOLUTIONS: Array<{ id: ConflictResolution; label: string }> = [
  { id: 'backup', label: 'Use backup' },
  { id: 'local', label: 'Keep current' },
  { id: 'both', label: 'Keep both' },
  { id: 'skip', label: 'Skip' },
];

function formatDate(at: number): string {
  if (!at) return 'an unknown date';
  return new Date(at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export const BackupPanel: React.FC = () => {
  const [busy, setBusy] = useState<'export' | 'choose' | 'restore' | 'undo' | null>(null);
  const [analysis, setAnalysis] = useState<BackupAnalysis | null>(null);
  const [step, setStep] = useState<Step>('summary');
  const [mode, setMode] = useState<RestoreMode>('smart');
  const [showModes, setShowModes] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [resolutions, setResolutions] = useState<Record<string, SectionResolution>>({});
  const [summary, setSummary] = useState<RestoreSummary | null>(null);
  const { message: notice, flash } = useFlash<{ text: string; bad?: boolean }>(6000);

  const exportNow = async () => {
    setBusy('export');
    try {
      const result = await window.cloudstream?.exportUserData?.();
      if (result?.cancelled) return;
      if (result?.ok) flash({ text: `Saved ${formatBytes(result.bytes ?? 0)} to ${result.path}` });
      else flash({ text: result?.error ?? 'The export could not be written.', bad: true });
    } finally {
      setBusy(null);
    }
  };

  const chooseFile = async () => {
    setBusy('choose');
    try {
      const result = await window.cloudstream?.inspectBackup?.();
      if (result?.cancelled) return;
      if (!result?.ok || !result.analysis) {
        flash({ text: result?.error ?? 'That file could not be read.', bad: true });
        return;
      }
      setAnalysis(result.analysis);
      setSelected(defaultSelection(result.analysis));
      setResolutions({});
      setMode('smart');
      setShowModes(false);
      setSummary(null);
      setStep('summary');
    } finally {
      setBusy(null);
    }
  };

  const close = () => {
    setAnalysis(null);
    setSummary(null);
    setStep('summary');
  };

  const restoreNow = async () => {
    if (!analysis) return;
    setBusy('restore');
    try {
      const result = await window.cloudstream?.restoreUserData?.(
        analysis.path,
        buildPlan(mode, selected, resolutions)
      );
      if (!result?.ok) {
        flash({ text: result?.error ?? 'The restore did not complete.', bad: true });
        return;
      }
      setSummary(result);
      setStep('done');
    } finally {
      setBusy(null);
    }
  };

  const undo = async () => {
    setBusy('undo');
    try {
      const result = await window.cloudstream?.undoRestore?.();
      if (result?.ok) {
        flash({ text: 'Put back what was here before the restore.' });
        close();
      } else {
        flash({ text: result?.error ?? 'There was nothing to undo.', bad: true });
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="backup-panel">
      <p className="backup-panel__lede">
        Your library, history, saved pages, settings and extensions — in one file, restored as much
        or as little as you like.
        <InfoHint label="What a backup holds">
          Everything needed to make another computer into this one: the library and where you got
          to, watch history, saved pages and searches, your download list, every setting, which
          repositories and extensions you have and which are switched off, and your indexers.
          Extension files and downloaded videos are not included — they are large and can be
          fetched again; the backup records <em>which</em> ones you had. Sign-in tokens are left
          out.
        </InfoHint>
      </p>

      {!analysis && (
        <div className="backup-panel__actions">
          <button type="button" className="btn btn-primary" onClick={() => void exportNow()} disabled={busy !== null}>
            {busy === 'export' ? <Loader2 size={15} className="spin" /> : <Download size={15} />}
            Export my data
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => void chooseFile()} disabled={busy !== null}>
            {busy === 'choose' ? <Loader2 size={15} className="spin" /> : <Upload size={15} />}
            Restore from a backup…
          </button>
        </div>
      )}

      {analysis && step !== 'done' && (
        <RestoreWizard
          analysis={analysis}
          step={step}
          setStep={setStep}
          mode={mode}
          setMode={setMode}
          showModes={showModes}
          setShowModes={setShowModes}
          selected={selected}
          setSelected={setSelected}
          resolutions={resolutions}
          setResolutions={setResolutions}
          busy={busy}
          onRestore={() => void restoreNow()}
          onCancel={close}
        />
      )}

      {analysis && step === 'done' && summary && (
        <RestoreResult summary={summary} busy={busy} onUndo={() => void undo()} onDone={close} />
      )}

      {notice && (
        <div className={`backup-panel__flash${notice.bad ? ' backup-panel__flash--bad' : ''}`} role="status">
          {notice.bad ? <AlertTriangle size={14} /> : <Check size={14} />}
          <span>{notice.text}</span>
        </div>
      )}
    </div>
  );
};

interface WizardProps {
  analysis: BackupAnalysis;
  step: Step;
  setStep: (step: Step) => void;
  mode: RestoreMode;
  setMode: (mode: RestoreMode) => void;
  showModes: boolean;
  setShowModes: (show: boolean) => void;
  selected: Set<string>;
  setSelected: (next: Set<string>) => void;
  resolutions: Record<string, SectionResolution>;
  setResolutions: (next: Record<string, SectionResolution>) => void;
  busy: string | null;
  onRestore: () => void;
  onCancel: () => void;
}

const RestoreWizard: React.FC<WizardProps> = (props) => {
  const { analysis, step, setStep, busy, onCancel } = props;
  const index = STEPS.findIndex((entry) => entry.id === step);
  const chosen = analysis.sections.filter((section) => props.selected.has(section.id));
  const next = STEPS[index + 1]?.id;
  const back = STEPS[index - 1]?.id;

  return (
    <div className="backup-panel__chosen">
      <ol className="backup-wizard__steps" aria-label="Restore steps">
        {STEPS.map((entry, i) => (
          <li
            key={entry.id}
            className={i === index ? 'is-current' : i < index ? 'is-done' : undefined}
            aria-current={i === index ? 'step' : undefined}
          >
            <span>{i < index ? <Check size={11} /> : i + 1}</span>
            {entry.label}
          </li>
        ))}
      </ol>

      {step === 'summary' && <SummaryStep analysis={analysis} />}
      {step === 'mode' && <ModeStep {...props} />}
      {step === 'select' && <SelectStep {...props} />}
      {step === 'review' && <ReviewStep {...props} chosen={chosen} />}

      <div className="backup-panel__actions">
        {back && (
          <button type="button" className="btn btn-secondary" onClick={() => setStep(back)} disabled={busy !== null}>
            Back
          </button>
        )}
        {next && (
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setStep(next)}
            disabled={busy !== null || (step === 'select' && chosen.length === 0)}
          >
            {step === 'summary' ? 'Choose what to restore' : 'Continue'}
          </button>
        )}
        {step === 'review' && (
          <button
            type="button"
            className="btn btn-primary"
            onClick={props.onRestore}
            disabled={busy !== null || chosen.length === 0}
          >
            {busy === 'restore' ? <Loader2 size={15} className="spin" /> : <Upload size={15} />}
            Restore {chosen.length} {chosen.length === 1 ? 'category' : 'categories'}
          </button>
        )}
        <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy !== null}>
          Cancel
        </button>
      </div>
    </div>
  );
};

/** What is in the file, before any choice is asked for. */
const SummaryStep: React.FC<{ analysis: BackupAnalysis }> = ({ analysis }) => {
  const unsupported = analysis.sections.filter((section) => !isRestorable(section));
  const present = analysis.sections.filter((section) => isRestorable(section) && section.backupCount > 0);
  return (
    <>
      <h4>
        <Archive size={15} /> Backup created {formatDate(analysis.createdAt)}
      </h4>
      <p className="backup-panel__meta">
        Made by version {analysis.appVersion} on {analysis.platform}
      </p>
      {analysis.formatVersion < 2 && (
        <p className="backup-panel__note">Made by an older version of the app. It will be converted as it is read.</p>
      )}
      {analysis.newerFormat && (
        <p className="backup-wizard__warning">
          <AlertTriangle size={14} /> Made by a newer version of the app. Anything this version does not
          understand is listed below and skipped.
        </p>
      )}
      {present.length === 0 ? (
        <p className="backup-panel__note">This backup has nothing this version of the app can restore.</p>
      ) : (
        GROUP_ORDER.map((group) => {
          const rows = present.filter((section) => section.group === group);
          if (!rows.length) return null;
          return (
            <section key={group} className="backup-wizard__group">
              <h5>{GROUP_LABELS[group]}</h5>
              <ul className="backup-panel__summary">
                {rows.map((section) => (
                  <li key={section.id} title={section.description}>
                    <span>{section.label}</span>
                    <strong>
                      {section.backupCount} {itemNoun(section.backupCount)}
                    </strong>
                  </li>
                ))}
              </ul>
            </section>
          );
        })
      )}
      {unsupported.length > 0 && <UnsupportedList sections={unsupported} />}
    </>
  );
};

const UnsupportedList: React.FC<{ sections: BackupSectionAnalysis[] }> = ({ sections }) => (
  <div className="backup-wizard__unsupported">
    <p>
      {sections.length} {sections.length === 1 ? 'part' : 'parts'} of this backup will be skipped:
    </p>
    <ul>
      {sections.map((section) => (
        <li key={section.id}>
          <strong>{section.label}</strong> — {section.reason ?? 'Not supported by this version.'}
        </li>
      ))}
    </ul>
  </div>
);

const ModeStep: React.FC<WizardProps> = ({ mode, setMode, showModes, setShowModes }) => {
  const visible = showModes || mode !== 'smart' ? MODES : MODES.filter((entry) => entry.id === 'smart');
  return (
    <>
      <h4>How should the backup be restored?</h4>
      <div className="backup-wizard__modes" role="radiogroup" aria-label="Restore mode">
        {visible.map((entry) => (
          <label key={entry.id} className={`backup-wizard__mode${mode === entry.id ? ' is-selected' : ''}`}>
            <input
              type="radio"
              name="restore-mode"
              checked={mode === entry.id}
              onChange={() => setMode(entry.id)}
            />
            <span className="backup-wizard__mode-title">
              {entry.icon} {entry.label}
              {entry.id === 'smart' && <em>Recommended</em>}
            </span>
            <span className="backup-wizard__mode-text">{entry.text}</span>
          </label>
        ))}
      </div>
      {!showModes && mode === 'smart' && (
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowModes(true)}>
          Other ways to restore
        </button>
      )}
    </>
  );
};

const SelectStep: React.FC<WizardProps> = ({ analysis, mode, selected, setSelected }) => {
  const [open, setOpen] = useState<string | null>(null);
  // A category the backup holds nothing of is offered only under Replace,
  // where restoring it means something: emptying it here.
  const restorable = analysis.sections.filter(
    (section) => isRestorable(section) && (section.backupCount > 0 || mode === 'replace')
  );
  const unsupported = analysis.sections.filter((section) => !isRestorable(section));
  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };
  return (
    <>
      <h4>What should be restored?</h4>
      <p className="backup-panel__note">Anything you leave unticked stays exactly as it is.</p>
      <div className="backup-panel__actions">
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => setSelected(new Set(restorable.map((section) => section.id)))}
        >
          Select all
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSelected(new Set())}>
          Select none
        </button>
      </div>
      {GROUP_ORDER.map((group) => {
        const rows = restorable.filter((section) => section.group === group);
        if (!rows.length) return null;
        return (
          <section key={group} className="backup-wizard__group">
            <h5>{GROUP_LABELS[group]}</h5>
            <ul className="backup-wizard__list">
              {rows.map((section) => {
                const counts = reviewCounts(section, mode);
                const expanded = open === section.id;
                return (
                  <li key={section.id} className="backup-wizard__row">
                    <div className="backup-wizard__row-head">
                      <label>
                        <input
                          type="checkbox"
                          checked={selected.has(section.id)}
                          onChange={() => toggle(section.id)}
                        />
                        <span className="backup-wizard__row-label">{section.label}</span>
                      </label>
                      <span className="backup-wizard__row-meta">{describeComparison(section)}</span>
                      <button
                        type="button"
                        className="backup-wizard__expand"
                        aria-expanded={expanded}
                        aria-label={`Details for ${section.label}`}
                        onClick={() => setOpen(expanded ? null : section.id)}
                      >
                        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </button>
                    </div>
                    {mode === 'replace' && counts.remove > 0 && selected.has(section.id) && (
                      <p className="backup-wizard__row-warn">
                        {counts.remove} {itemNoun(counts.remove)} here would be removed.
                      </p>
                    )}
                    {expanded && <SectionDetails section={section} />}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
      {unsupported.length > 0 && <UnsupportedList sections={unsupported} />}
    </>
  );
};

const SectionDetails: React.FC<{ section: BackupSectionAnalysis }> = ({ section }) => {
  const samples = section.parts.flatMap((part) => part.newSamples).slice(0, 6);
  return (
    <div className="backup-wizard__details">
      <p>{section.description}</p>
      <ul>
        {section.parts.map((part) => (
          <li key={part.id}>
            {part.backupCount} {part.label} in the backup · {part.localCount} here
          </li>
        ))}
      </ul>
      {samples.length > 0 && <p>New here, for example: {samples.join(', ')}</p>}
      {section.restartAfterRestore && <p>Takes full effect after the app restarts.</p>}
      {section.migratedFrom !== undefined && <p>Saved in an older form; it will be converted.</p>}
    </div>
  );
};

const ReviewStep: React.FC<WizardProps & { chosen: BackupSectionAnalysis[] }> = ({
  mode,
  chosen,
  resolutions,
  setResolutions,
}) => {
  const rows = useMemo(
    () => chosen.map((section) => ({ section, counts: reviewCounts(section, mode, resolutions[section.id]) })),
    [chosen, mode, resolutions]
  );
  const removing = rows.filter(({ counts }) => counts.remove > 0);
  const resolve = (id: string, next: SectionResolution) => setResolutions({ ...resolutions, [id]: next });

  return (
    <>
      <h4>Review the changes</h4>
      <p className="backup-panel__meta">
        {MODES.find((entry) => entry.id === mode)?.label} · {chosen.length}{' '}
        {chosen.length === 1 ? 'category' : 'categories'}
      </p>
      {removing.length > 0 && (
        <p className="backup-wizard__warning">
          <AlertTriangle size={14} /> Replace removes{' '}
          {removing.map(({ section, counts }) => `${counts.remove} from ${section.label}`).join(', ')}.
        </p>
      )}
      <ul className="backup-wizard__list">
        {rows.map(({ section, counts }) => (
          <li key={section.id} className="backup-wizard__row">
            <div className="backup-wizard__row-head">
              <span className="backup-wizard__row-label">{section.label}</span>
              <span className={`backup-wizard__row-meta${changesSomething(counts) ? ' is-change' : ''}`}>
                {describeCounts(counts)}
              </span>
            </div>
            {mode === 'smart' && section.conflictTotal > 0 && (
              <ConflictChooser
                section={section}
                resolution={resolutions[section.id] ?? { default: 'local' }}
                onChange={(next) => resolve(section.id, next)}
              />
            )}
          </li>
        ))}
      </ul>
      <p className="backup-panel__note">
        A copy of what is here now is saved first, so the restore can be undone. Nothing you did not
        choose is changed.
      </p>
    </>
  );
};

/**
 * The only place a reader is asked about individual rows — and even then one
 * choice covers the whole category, with per-row choices one click away.
 */
const ConflictChooser: React.FC<{
  section: BackupSectionAnalysis;
  resolution: SectionResolution;
  onChange: (next: SectionResolution) => void;
}> = ({ section, resolution, onChange }) => {
  const [open, setOpen] = useState(false);
  const options = RESOLUTIONS.filter((option) => option.id !== 'both' || section.canKeepBoth);
  const items = resolution.items ?? {};
  const setItem = (key: string, choice: ConflictResolution) =>
    onChange({ ...resolution, items: { ...items, [key]: choice } });

  return (
    <div className="backup-wizard__conflicts">
      <p>
        {section.conflictTotal} {section.conflictTotal === 1 ? 'differs' : 'differ'} from what is here,
        with no way to tell which is right.
      </p>
      <div className="backup-wizard__segmented" role="radiogroup" aria-label={`${section.label} conflicts`}>
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={resolution.default === option.id}
            className={resolution.default === option.id ? 'is-selected' : undefined}
            onClick={() => onChange({ ...resolution, default: option.id })}
          >
            {option.label}
          </button>
        ))}
      </div>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(!open)} aria-expanded={open}>
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />} Choose for each
      </button>
      {open && (
        <ul className="backup-wizard__conflict-list">
          {section.conflicts.map((item) => (
            <li key={item.key}>
              <span className="backup-wizard__conflict-name">{item.label}</span>
              <span className="backup-wizard__conflict-sides">
                Backup: {item.backup} · Here: {item.current}
              </span>
              <select
                value={items[item.key] ?? resolution.default}
                onChange={(event) => setItem(item.key, event.target.value as ConflictResolution)}
                aria-label={`Choice for ${item.label}`}
              >
                {options.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </li>
          ))}
          {section.conflictTotal > section.conflicts.length && (
            <li className="backup-wizard__conflict-more">
              {section.conflictTotal - section.conflicts.length} more follow the choice above.
            </li>
          )}
        </ul>
      )}
    </div>
  );
};

const RestoreResult: React.FC<{
  summary: RestoreSummary;
  busy: string | null;
  onUndo: () => void;
  onDone: () => void;
}> = ({ summary, busy, onUndo, onDone }) => {
  const failures = summary.sections.reduce((sum, row) => sum + row.failed.length, 0);
  const brokenSections = summary.sections.filter((row) => row.status === 'failed');
  return (
    <div className="backup-panel__result">
      <h4>
        {brokenSections.length || failures ? <AlertTriangle size={15} /> : <Check size={15} />}
        {brokenSections.length || failures ? 'Restore finished, with some exceptions' : 'Restore complete'}
      </h4>
      <ul className="backup-wizard__list">
        {summary.sections.map((row) => (
          <li key={row.id} className="backup-wizard__row">
            <div className="backup-wizard__row-head">
              <span className="backup-wizard__row-label">{row.label}</span>
              <span className={`backup-wizard__row-meta${row.status === 'failed' ? ' is-bad' : ''}`}>
                {row.status === 'restored'
                  ? describeCounts({
                      add: row.added,
                      update: row.updated,
                      remove: row.removed,
                      keep: row.kept + row.skipped,
                      same: row.unchanged,
                      invalid: 0,
                    })
                  : row.reason ?? 'Not restored'}
              </span>
            </div>
            {row.notes.map((note) => (
              <p key={note} className="backup-wizard__row-note">
                {note}
              </p>
            ))}
            {row.failed.length > 0 && (
              <ul className="backup-wizard__failures">
                {row.failed.map((failure, i) => (
                  <li key={`${failure.label}-${i}`}>
                    <strong>{failure.label}</strong> — {failure.reason}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
      <p className="backup-panel__note">Nothing else was changed.</p>
      {summary.restartRecommended && (
        <p className="backup-panel__note">
          Some settings are read when the app starts. Restart to finish applying them.
        </p>
      )}
      <div className="backup-panel__actions">
        <button type="button" className="btn btn-primary" onClick={onDone} disabled={busy !== null}>
          Done
        </button>
        {summary.restartRecommended && (
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => void window.cloudstream?.relaunchApp?.()}
            disabled={busy !== null}
          >
            <RotateCw size={15} /> Restart now
          </button>
        )}
        {summary.undoAvailable && (
          <button type="button" className="btn btn-secondary" onClick={onUndo} disabled={busy !== null}>
            {busy === 'undo' ? <Loader2 size={15} className="spin" /> : <Undo2 size={15} />}
            Undo restore
          </button>
        )}
      </div>
    </div>
  );
};
