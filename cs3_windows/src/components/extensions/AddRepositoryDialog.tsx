import React, { useState } from 'react';
import { Plus } from 'lucide-react';
import { Button, Dialog, DialogActions, Input } from '../ui';
import { InfoHint } from '../settings/InfoHint';

/**
 * Adding a repository by its address — a deliberate act, so a dialog.
 *
 * It used to be a URL bar across the top of Browse, which made a catalogue
 * read as a configuration screen and put the rarest action above every
 * repository. Browse first is offered beside Add because looking costs one
 * fetch and keeping it is a commitment; neither installs anything.
 */
export const AddRepositoryDialog: React.FC<{
  onBrowse(url: string): void;
  onAdd(url: string): void;
  onClose(): void;
}> = ({ onBrowse, onAdd, onClose }) => {
  const [url, setUrl] = useState('');
  const value = url.trim();

  return (
    <Dialog
      size="sm"
      icon={<Plus size={18} />}
      title="Add a repository"
      onClose={onClose}
      footer={
        <DialogActions>
          <Button variant="ambient" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!value}
            onClick={() => {
              onBrowse(value);
              onClose();
            }}
          >
            Look first
          </Button>
          <Button
            variant="prominent"
            disabled={!value}
            onClick={() => {
              onAdd(value);
              onClose();
            }}
          >
            Add
          </Button>
        </DialogActions>
      }
    >
      <form
        className="add-repository"
        onSubmit={(event) => {
          event.preventDefault();
          if (!value) return;
          onAdd(value);
          onClose();
        }}
      >
        <label className="add-repository__label" htmlFor="add-repository-url">
          Repository address
          <InfoHint label="Which addresses work">
            A repository link, a project page or a shortcode. There is no fixed place a plugin
            list lives, so the usual branches and file names are tried for you. Adding keeps it
            in your list (and in backups); nothing is installed until you choose extensions.
          </InfoHint>
        </label>
        <Input
          id="add-repository-url"
          type="url"
          autoFocus
          value={url}
          placeholder="https://example.com/repo.json"
          onChange={(event) => setUrl(event.target.value)}
        />
      </form>
    </Dialog>
  );
};
