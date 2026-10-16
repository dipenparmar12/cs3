import React, { useEffect, useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { Button, Checkbox, Dialog, DialogActions } from './ui';
import { revealAdultForSession, useAdultState } from '../utils/useAdultMode';

/**
 * Startup confirmation prompt for adult/NSFW content (§129.1).
 *
 * Appears on application launch whenever the user has not explicitly selected
 * "Do Not Ask Again" (`promptPending === true`). While confirmation is pending,
 * adult content remains disabled and visual protection remains active.
 * Dismissing or closing the dialog keeps adult content disabled for the session
 * without suppressing future prompts.
 */
let answeredThisLaunch = false;

export const AdultSessionPrompt: React.FC = () => {
  const { promptPending, doNotAskAgain, savedEnabled, loaded } = useAdultState();
  const [open, setOpen] = useState(false);
  const [remember, setRemember] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // Only show prompt on startup if adult content is enabled and confirmation is pending
    if (!loaded || answeredThisLaunch || doNotAskAgain || !promptPending || !savedEnabled) {
      setOpen(false);
      return;
    }
    // Wait behind first-run region onboarding or any other active modal; never stack dialogs.
    const check = () => {
      if (document.querySelector('[aria-modal="true"], .modal-overlay')) return false;
      setOpen(true);
      return true;
    };
    if (check()) return;
    const timer = window.setInterval(() => {
      if (check()) window.clearInterval(timer);
    }, 250);
    return () => window.clearInterval(timer);
  }, [loaded, promptPending, doNotAskAgain, savedEnabled]);

  const answer = async (unblur: boolean, applyRemember: boolean) => {
    answeredThisLaunch = true;
    setBusy(true);
    // Visual presentation choice: unblur === false means Keep Blurred; unblur === true means Unblur
    await revealAdultForSession(true, {
      blurred: !unblur,
      doNotAskAgain: applyRemember,
    });
    setBusy(false);
    setOpen(false);
  };

  if (!open) return null;
  return (
    <Dialog
      size="sm"
      icon={<ShieldAlert size={18} />}
      title="NSFW Poster Visibility"
      description="Choose how NSFW posters and visual assets should appear during this session. NSFW content availability remains managed in the Extensions screen."
      onClose={() => void answer(false, false)}
      footer={
        <DialogActions>
          <Button onClick={() => void answer(false, remember)} disabled={busy}>
            Keep Blurred
          </Button>
          <Button
            variant="prominent"
            onClick={() => void answer(true, remember)}
            loading={busy}
          >
            Unblur for Session
          </Button>
        </DialogActions>
      }
    >
      <Checkbox
        checked={remember}
        onChange={setRemember}
        label="Do Not Ask Again"
        description="Remember this visual presentation choice on future launches. You can change it anytime in Settings."
      />
    </Dialog>
  );
};

