import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, ClipboardCopy, RefreshCw } from 'lucide-react';
import { useFlash } from '../../utils/useFlash';
import type { StartupProfile } from '../../../electron/startupProfile';
import type { StartupTaskReport } from '../../../electron/util/startupQueue';

/**
 * What this launch cost, and whether the main thread stopped answering.
 *
 * Startup was reported as slow, and separately as Windows' "Not Responding",
 * and neither could be answered because nothing was counted. Those are two
 * different faults and this screen keeps them apart, because a fix for one does
 * nothing for the other:
 *
 * **Stages** say where the time went. **Stalls** say where the app stopped
 * pumping messages, which is the only one a viewer experiences as the window
 * greying out. A five-second startup made of responsive stages never shows the
 * ghost window; a one-second startup made of a single synchronous block does.
 *
 * The background queue is on the same screen rather than its own, because "the
 * app started fine and a feature never arrived" is one report, and splitting it
 * across two panels means being able to see half of it.
 */

/** Everything under this is noise on a list where the interesting rows are hundreds. */
const STAGE_FLOOR_MS = 1;

function ms(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return value >= 1000 ? `${(value / 1000).toFixed(2)}s` : `${Math.round(value)}ms`;
}

export const StartupProfilePanel: React.FC = () => {
  const [profile, setProfile] = useState<StartupProfile | null>(null);
  const [tasks, setTasks] = useState<StartupTaskReport[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { message: copied, flash: setCopied } = useFlash<boolean>(2500);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const answer = await window.cloudstream?.getStartupProfile?.();
      if (!answer) {
        setError('This build does not report a startup profile.');
      } else if (answer.ok) {
        setProfile(answer.profile);
        setTasks(answer.tasks);
        setError(null);
      } else {
        setError(answer.error);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /**
   * Longest first, not chronological.
   *
   * A timeline is the obvious rendering and it is the wrong one here: the
   * question this panel answers is "what should I fix", and the answer is the
   * top row. Each stage's `startedAt` is shown so the order is still
   * recoverable.
   */
  const stages = useMemo(
    () =>
      (profile?.stages ?? [])
        .filter((stage) => stage.durationMs >= STAGE_FLOOR_MS)
        .slice()
        .sort((a, b) => b.durationMs - a.durationMs)
        .slice(0, 20),
    [profile]
  );

  const report = useMemo(() => {
    if (!profile) return '';
    const lines = [
      '## Startup',
      `before main: ${ms(profile.beforeMainMs)}`,
      ...Object.entries(profile.marks)
        .sort((a, b) => a[1] - b[1])
        .map(([name, at]) => `${name}: ${ms(at)}`),
      '',
      `## Blocked (${ms(profile.stalledMs)} total, ${profile.stalls.length} stalls)`,
      ...profile.stalls.map((s) => `${ms(s.durationMs)} at ${ms(s.startedAt)} — ${s.during ?? 'uninstrumented'}`),
      '',
      '## Stages',
      ...stages.map((s) => `${ms(s.durationMs).padStart(8)}  ${s.name}${s.error ? ` — FAILED: ${s.error}` : ''}`),
      '',
      '## Background',
      ...tasks.map((t) => `${t.state.padEnd(8)} ${ms(t.durationMs).padStart(8)}  ${t.id}${t.error ? ` — ${t.error}` : ''}`),
    ];
    return lines.join('\n');
  }, [profile, stages, tasks]);

  return (
    <section className="settings-group">
      <header className="settings-group__header">
        <Activity size={15} aria-hidden />
        <h3>Startup</h3>
        <div className="settings-group__actions">
          <button type="button" className="btn btn-ghost" onClick={() => void refresh()} disabled={loading}>
            <RefreshCw size={14} className={loading ? 'spin' : undefined} aria-hidden /> Refresh
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={!report}
            onClick={() => {
              void navigator.clipboard.writeText(report);
              setCopied(true);
            }}
          >
            <ClipboardCopy size={14} aria-hidden /> {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </header>

      {error && <p className="settings-note settings-note--warn">{error}</p>}

      {profile && (
        <>
          <dl className="startup-profile__marks">
            {/*
              Before main is the part we do not control — Electron's own
              bootstrap and the V8 snapshot — and it is shown so the rest of the
              numbers are read against the right baseline rather than blamed for
              it.
            */}
            <div>
              <dt>Before our first line</dt>
              <dd>{ms(profile.beforeMainMs)}</dd>
            </div>
            <div>
              <dt>Modules loaded</dt>
              <dd>{ms(profile.marks.modules_loaded)}</dd>
            </div>
            <div>
              <dt>Window painted</dt>
              <dd>{ms(profile.marks.first_paint)}</dd>
            </div>
            <div>
              <dt>Interactive</dt>
              <dd>{ms(profile.marks.interactive)}</dd>
            </div>
            <div className={profile.stalledMs > 0 ? 'startup-profile__mark--bad' : undefined}>
              <dt>Main thread blocked</dt>
              <dd>
                {ms(profile.stalledMs)}
                {profile.stalls.length > 0 && ` over ${profile.stalls.length}`}
              </dd>
            </div>
          </dl>

          {profile.stalls.length > 0 ? (
            <>
              <h4 className="startup-profile__heading">Where it stopped responding</h4>
              <ul className="startup-profile__list">
                {profile.stalls.map((stall, index) => (
                  <li key={index}>
                    <strong>{ms(stall.durationMs)}</strong>
                    <span>{stall.during ?? 'outside any measured stage'}</span>
                    <em>at {ms(stall.startedAt)}</em>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="settings-note">
              The main thread answered throughout startup — nothing blocked it for longer
              than a tenth of a second.
            </p>
          )}

          <h4 className="startup-profile__heading">Slowest stages</h4>
          <ul className="startup-profile__list">
            {stages.map((stage) => (
              <li key={stage.name} className={stage.error ? 'startup-profile__row--bad' : undefined}>
                <strong>{ms(stage.durationMs)}</strong>
                <span>{stage.name}</span>
                <em>{stage.error ? stage.error : `at ${ms(stage.startedAt)}`}</em>
              </li>
            ))}
          </ul>

          <h4 className="startup-profile__heading">Loaded in the background</h4>
          <ul className="startup-profile__list">
            {tasks.map((task) => (
              <li key={task.id} className={task.state === 'failed' ? 'startup-profile__row--bad' : undefined}>
                <strong>{task.state}</strong>
                <span>{task.label}</span>
                <em>
                  {task.error
                    ? task.error
                    : task.durationMs === null
                      ? 'not started yet'
                      : ms(task.durationMs)}
                </em>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
};
