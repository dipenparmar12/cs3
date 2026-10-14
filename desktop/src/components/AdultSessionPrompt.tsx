import React, { useEffect, useState } from 'react';
import { EyeOff } from 'lucide-react';
import { Button, Checkbox, Dialog, DialogActions } from './ui';
import { revealAdultForSession, setAdultMode, useAdultState } from '../utils/useAdultMode';

/**
 * The launch-time question for "Ask every time" (PRD: adult content privacy, §1/§3).
 *
 * The `ask` mode existed and kept adult providers locked each launch, but
 * nothing ever asked: the unlock lived in Settings → Extensions, so "ask"
 * behaved as "off" unless you knew where to look. This asks once per launch,
 * only in that mode — `off` and `on` are answers already, and asking someone
 * who never wanted adult content about it on every start would be the nag the
 * setting exists to avoid.
 *
 * Nothing is revealed until the viewer says so: dismissing (Esc, the close
 * button) keeps it hidden, and the gate stays locked while the question is up.
 * "Don't ask again" turns the answer into the setting (`off` or `on`), which
 * Settings can turn back to "Ask every time".
 */
let answeredThisLaunch = false;

export const AdultSessionPrompt: React.FC = () => {
  const { mode, allowed, loaded } = useAdultState();
  const [open, setOpen] = useState(false);
  const [remember, setRemember] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loaded || answeredThisLaunch || mode !== 'ask' || allowed) return;
    // Wait behind first-run onboarding or any other dialog; never stack on one.
    const check = () => {
      if (document.querySelector('[aria-modal="true"], .modal-overlay')) return false;
      setOpen(true);
      return true;
    };
    if (check()) return;
    const timer = window.setInterval(() => {
      if (check()) window.clearInterval(timer);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [loaded, mode, allowed]);

  const answer = async (show: boolean) => {
    answeredThisLaunch = true;
    setBusy(true);
    if (remember) await setAdultMode(show ? 'on' : 'off');
    else if (show) await revealAdultForSession(true);
    setBusy(false);
    setOpen(false);
  };

  if (!open) return null;
  return (
    <Dialog
      size="sm"
      icon={<EyeOff size={18} />}
      title="Show adult content this session?"
      description="Some installed extensions publish adult (NSFW) titles. Showing them makes their titles, posters and results appear in search, catalogues and recommendations until you close the app."
      onClose={() => void answer(false)}
      footer={
        <DialogActions>
          <Button onClick={() => void answer(false)} disabled={busy}>
            Keep hidden
          </Button>
          <Button variant="prominent" onClick={() => void answer(true)} loading={busy}>
            Show this session
          </Button>
        </DialogActions>
      }
    >
      <Checkbox
        checked={remember}
        onChange={setRemember}
        label="Don't ask again"
        description="Your answer becomes the setting. Settings → Extensions → Adult content can bring this question back."
      />
    </Dialog>
  );
};
