import React, { useEffect, useState } from 'react';
import { Scale, ExternalLink, Copy, Check } from 'lucide-react';
import { useFlash } from '../../utils/useFlash';

/**
 * What this app is, what it is built from, and under what terms.
 *
 * The repository shipped with **no `LICENSE` file at all** while being a port of
 * a GPL-3.0 Android application, vendoring 26 community extension repositories
 * and bundling FFmpeg, mpv, aria2, yt-dlp and a JRE — each with its own terms.
 * That is the one defect in this codebase whose consequences are outside it.
 *
 * `LICENSE` and `THIRD-PARTY-NOTICES.md` now exist at the repository root, and
 * this panel is what makes them reachable from a *packaged* build, where the
 * repository is not. GPL-3.0 §6 asks that a recipient of a binary can find the
 * corresponding source; a notice that ships and cannot be opened does not do
 * that.
 *
 * The FFmpeg line is specific for a reason. The bundled Windows builds are the
 * GPL-licensed variants — not the LGPL ones — and stating "FFmpeg" without
 * saying which would be the kind of accurate-sounding omission this file exists
 * to avoid.
 */

interface Row {
  name: string;
  detail: string;
  licence: string;
}

const RUNTIME_COMPONENTS: Row[] = [
  { name: 'CloudStream 3', detail: 'The Android app this is a port of', licence: 'GPL-3.0' },
  { name: 'FFmpeg / ffprobe', detail: 'Media inspection and conversion (GPL build)', licence: 'GPL-3.0' },
  { name: 'mpv', detail: 'The native playback engine', licence: 'GPL-2.0-or-later' },
  { name: 'aria2', detail: 'Multi-connection downloads', licence: 'GPL-2.0-or-later' },
  { name: 'yt-dlp', detail: 'Fallback link extraction', licence: 'Unlicense' },
  { name: 'OpenJDK', detail: 'Runs the .cs3 extension sidecar', licence: 'GPL-2.0 + Classpath' },
  { name: 'Shaka Player', detail: 'DASH playback', licence: 'Apache-2.0' },
  { name: 'hls.js', detail: 'HLS playback', licence: 'Apache-2.0' },
  { name: 'WebTorrent', detail: 'Torrent streaming', licence: 'MIT' },
  { name: 'React', detail: 'The interface', licence: 'MIT' },
  { name: 'Inter', detail: 'The typeface, bundled rather than fetched', licence: 'SIL OFL 1.1' },
];

const SOURCE_URL = 'https://github.com/recloudstream/cloudstream';

export const AboutPanel: React.FC = () => {
  const [environment, setEnvironment] = useState<Record<string, string> | null>(null);
  const { message: copied, flash: setCopied } = useFlash<boolean>(2000);

  useEffect(() => {
    let mounted = true;
    void window.cloudstream?.getPluginRuntimeStatus?.().then((status) => {
      if (!mounted) return;
      setEnvironment({
        'Extension runtime': status?.available ? 'ready' : (status?.reason || 'unavailable'),
        Extensions: String(status?.installedCount ?? 0),
      });
    });
    return () => {
      mounted = false;
    };
  }, []);

  const copyNotice = async () => {
    const text = [
      'CloudStream 3 Desktop — third-party components',
      '',
      ...RUNTIME_COMPONENTS.map((row) => `${row.name} — ${row.licence} — ${row.detail}`),
      '',
      'This application is distributed under the GNU General Public License v3.',
      `Corresponding source: ${SOURCE_URL}`,
    ].join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      // The list is on screen either way; a refused clipboard loses nothing.
    }
  };

  return (
    <div className="about-panel">
      <div className="about-panel__lede">
        <Scale size={18} aria-hidden />
        <div>
          <h3>Licence</h3>
          <p>
            CloudStream 3 Desktop is a port of the CloudStream 3 Android application and is
            distributed under the <strong>GNU General Public License, version 3</strong>. You may
            use, study, modify and redistribute it under those terms, and the complete source is
            available.
          </p>
        </div>
      </div>

      <p className="about-panel__note">
        Extensions you install are independent works by their own authors, under their own
        licences. They are downloaded at runtime from repositories you choose and are not part of
        this application.
      </p>

      <div className="about-panel__table" role="table" aria-label="Bundled components">
        <div className="about-panel__row about-panel__row--head" role="row">
          <span role="columnheader">Component</span>
          <span role="columnheader">What it does</span>
          <span role="columnheader">Licence</span>
        </div>
        {RUNTIME_COMPONENTS.map((row) => (
          <div className="about-panel__row" role="row" key={row.name}>
            <span role="cell">{row.name}</span>
            <span role="cell" className="about-panel__detail">
              {row.detail}
            </span>
            <span role="cell" className="about-panel__licence">
              {row.licence}
            </span>
          </div>
        ))}
      </div>

      {environment && (
        <dl className="about-panel__env">
          {Object.entries(environment).map(([key, value]) => (
            <React.Fragment key={key}>
              <dt>{key}</dt>
              <dd>{value}</dd>
            </React.Fragment>
          ))}
        </dl>
      )}

      <div className="about-panel__actions">
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => void window.cloudstream?.openExternalLink?.(SOURCE_URL)}
        >
          <ExternalLink size={15} /> Source code
        </button>
        <button type="button" className="btn btn-secondary" onClick={() => void copyNotice()}>
          {copied ? <Check size={15} /> : <Copy size={15} />}
          {copied ? 'Copied' : 'Copy notices'}
        </button>
      </div>
    </div>
  );
};
