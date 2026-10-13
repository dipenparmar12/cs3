import React, { useEffect, useMemo, useState } from 'react';
import { ShieldCheck, Trash2 } from 'lucide-react';
import { Button, Checkbox, Dialog, DialogActions } from '../ui';
import type { UserDataSummary } from '../../types/userData';
import { describeError } from '../../utils/errors';

/**
 * Settings → Privacy → "Erase my data".
 *
 * Says both halves of the scope out loud — what goes, and the building blocks
 * that stay — because "erase everything" in an app that also downloads a JVM,
 * mpv and two hundred extensions is ambiguous in a way that costs someone an
 * hour if read the wrong way. Every area starts ticked; the one irreversible
 * extra (deleting finished video files) starts unticked and says so.
 *
 * A copy of what is erased is saved first (an ordinary backup, restorable from
 * Settings → Backup), and the window reloads afterwards so no screen keeps
 * drawing data that no longer exists.
 */
export const EraseDataDialog: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [summary, setSummary] = useState<UserDataSummary | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [deleteFiles, setDeleteFiles] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ backupPath?: string; failed: string[] } | null>(null);

  useEffect(() => {
    let active = true;
    void window.cloudstream?.getUserDataSummary?.().then((response) => {
      if (!active || !response?.ok) return;
      setSummary({ areas: response.areas, preserved: response.preserved });
      setChosen(new Set(response.areas.filter((area) => area.defaultSelected).map((area) => area.id)));
    });
    return () => {
      active = false;
    };
  }, []);

  const allChosen = summary ? summary.areas.every((area) => chosen.has(area.id)) : false;
  const someChosen = chosen.size > 0;
  const labelFor = useMemo(
    () => new Map((summary?.areas ?? []).map((area) => [area.id, area.label])),
    [summary]
  );

  const toggle = (id: string, on: boolean) =>
    setChosen((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const erase = async () => {
    setRunning(true);
    setError(null);
    try {
      const result = await window.cloudstream?.eraseUserData?.({
        areas: [...chosen],
        deleteDownloadedFiles: deleteFiles,
        keepCopy: true,
      });
      if (!result) throw new Error('The app did not answer.');
      if (result.error && result.cleared.length === 0) {
        setError(result.error);
        return;
      }
      setDone({
        backupPath: result.backupPath,
        failed: result.failed.map((f) => `${labelFor.get(f.id) ?? f.id}: ${f.error}`),
      });
    } catch (err) {
      setError(describeError(err));
    } finally {
      setRunning(false);
    }
  };

  if (done) {
    return (
      <Dialog
        title="Your data was erased"
        icon={<ShieldCheck size={18} />}
        onClose={() => window.location.reload()}
        footer={
          <DialogActions>
            <Button variant="prominent" onClick={() => window.location.reload()}>
              Done
            </Button>
          </DialogActions>
        }
      >
        <div className="erase-data">
          {done.failed.length > 0 && (
            <p className="erase-data__warning">
              Some parts could not be erased: {done.failed.join('; ')}
            </p>
          )}
          {done.backupPath && (
            <p className="erase-data__note">
              A copy was saved first. To bring it back, open Settings → Backup → Restore and choose{' '}
              <code>{done.backupPath}</code>.
            </p>
          )}
          <p className="erase-data__note">The app reloads so every screen starts fresh.</p>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog
      title="Erase my data"
      description="Removes what you did in the app. Everything the app needs to run stays."
      icon={<Trash2 size={18} />}
      tone="danger"
      size="md"
      onClose={onClose}
      dismissable={!running}
      footer={
        <DialogActions
          start={
            summary && (
              <Button
                size="compact"
                variant="ambient"
                onClick={() =>
                  setChosen(allChosen ? new Set() : new Set(summary.areas.map((area) => area.id)))
                }
              >
                {allChosen ? 'Select none' : 'Select all'}
              </Button>
            )
          }
        >
          <Button onClick={onClose} disabled={running}>
            Cancel
          </Button>
          <Button variant="destructive" icon={Trash2} loading={running} disabled={!someChosen} onClick={erase}>
            Erase {chosen.size === summary?.areas.length ? 'all' : `${chosen.size}`}
          </Button>
        </DialogActions>
      }
    >
      <div className="erase-data">
        {!summary ? (
          <p className="erase-data__note">Counting…</p>
        ) : (
          <>
            <ul className="erase-data__areas">
              {summary.areas.map((area) => (
                <li key={area.id}>
                  <Checkbox
                    checked={chosen.has(area.id)}
                    onChange={(on) => toggle(area.id, on)}
                    disabled={running}
                    label={
                      <>
                        {area.label}
                        {area.count !== null && area.count > 0 && (
                          <span className="erase-data__count">{area.count}</span>
                        )}
                      </>
                    }
                    description={area.description}
                  />
                </li>
              ))}
            </ul>

            {chosen.has('downloads') && (
              <Checkbox
                className="erase-data__files"
                checked={deleteFiles}
                onChange={setDeleteFiles}
                disabled={running}
                label="Also delete the finished video files"
                description="Off: the files stay in your download folder and only the list is cleared. On: they are deleted and cannot be restored."
              />
            )}

            <div className="erase-data__kept">
              <ShieldCheck size={14} aria-hidden />
              <div>
                <strong>Always kept</strong>
                <span>{summary.preserved.join(' · ')}</span>
              </div>
            </div>
            <p className="erase-data__note">A copy of what is erased is saved first, so it can be restored.</p>
            {error && <p className="erase-data__warning">{error}</p>}
          </>
        )}
      </div>
    </Dialog>
  );
};
