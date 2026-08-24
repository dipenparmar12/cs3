import React from 'react';
import { ChevronRight, Users, Tag, AlertTriangle, ShieldCheck, ShieldAlert } from 'lucide-react';
import { Badge, ExternalLink } from './primitives';
import { tagLabel, isAdultTag, languageLabel } from './useExtensionFilters';

function formatCompactBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

/**
 * Where a thing came from and who is responsible for it.
 *
 * This is the answer to the question the screen could not previously answer at
 * all: a provider row showed a name and a toggle, and nothing tied it to the
 * extension that registered it or the repository that supplied that extension.
 * When a provider returned nothing there was no way to tell whose code had
 * failed or whose repository to raise it with.
 *
 * The chain at the top is the load-bearing part. `repository ▸ extension ▸
 * provider` is the real three-level model — there is no fourth entity in
 * CloudStream — and showing all three at every level means any row can be traced
 * upward in one glance.
 *
 * Rendered inline beneath its row rather than in a modal. A modal would let the
 * user inspect exactly one thing at a time and lose the list position; several
 * of these can be open at once while comparing.
 */

export interface Provenance {
  kind: 'repository' | 'extension' | 'provider';
  title: string;
  /** repository ▸ extension ▸ provider, as far as it is known at this level. */
  chain: string[];
  internalName?: string;
  version?: number;
  authors?: string[];
  description?: string;
  language?: string;
  category?: string;
  tags?: string[];
  url?: string;
  homepageUrl?: string;
  fileSize?: number;
  fileHash?: string;
  verified?: boolean;
  bundled?: boolean;
  counts?: Array<{ label: string; value: string }>;
  /** Why this contributes nothing, when it contributes nothing. */
  problem?: string;
  /** Why it is silent despite its own switch being on. */
  suppressedReason?: string;
}

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="ext-provenance__field">
    <span className="ext-provenance__key">{label}</span>
    <span className="ext-provenance__value">{children}</span>
  </div>
);

export const ProvenancePanel: React.FC<{ details: Provenance }> = ({ details }) => {
  const {
    chain,
    internalName,
    version,
    authors,
    description,
    language,
    category,
    tags,
    url,
    homepageUrl,
    fileSize,
    fileHash,
    verified,
    bundled,
    counts,
    problem,
    suppressedReason,
  } = details;

  return (
    <div className="ext-provenance">
      {chain.length > 0 && (
        <div className="ext-provenance__chain">
          {chain.map((step, index) => (
            <React.Fragment key={`${step}-${index}`}>
              {index > 0 && <ChevronRight size={12} style={{ color: 'var(--text-subtle)' }} />}
              <span style={index === chain.length - 1 ? { color: 'var(--text-main)', fontWeight: 600 } : undefined}>
                {step}
              </span>
            </React.Fragment>
          ))}
        </div>
      )}

      {suppressedReason && (
        <div className="ext-provenance__chain" style={{ color: 'var(--status-warning)' }}>
          <AlertTriangle size={12} />
          <span>{suppressedReason}</span>
        </div>
      )}

      {problem && (
        <div className="ext-provenance__chain" style={{ color: 'var(--status-error)' }}>
          <AlertTriangle size={12} />
          <span>{problem}</span>
        </div>
      )}

      <div className="ext-provenance__grid">
        {internalName && <Field label="Internal ID">{internalName}</Field>}
        {version !== undefined && <Field label="Version">v{version}</Field>}
        {language && <Field label="Language">{languageLabel(language)}</Field>}
        {category && <Field label="Category">{category}</Field>}
        {fileSize !== undefined && <Field label="Package size">{formatCompactBytes(fileSize)}</Field>}
        {counts?.map((entry) => (
          <Field key={entry.label} label={entry.label}>
            {entry.value}
          </Field>
        ))}
        {verified !== undefined && (
          <Field label="Catalogue">
            {verified ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', color: 'var(--status-success)' }}>
                <ShieldCheck size={12} /> Verified link
              </span>
            ) : (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', color: 'var(--text-muted)' }}>
                <ShieldAlert size={12} /> Unverified link
              </span>
            )}
          </Field>
        )}
        {bundled && <Field label="Origin">Installed on first launch</Field>}
      </div>

      {/*
        Maintainers are named because they are who a broken provider has to be
        reported to. The app cannot fix a site that changed its markup; the
        person listed here is the one who can.
      */}
      {authors && authors.length > 0 && (
        <div className="ext-provenance__tags">
          <Users size={12} style={{ color: 'var(--text-subtle)' }} />
          <span className="ext-provenance__key">Maintainers</span>
          {authors.map((author) => (
            <Badge key={author}>{author}</Badge>
          ))}
        </div>
      )}

      {tags && tags.length > 0 && (
        <div className="ext-provenance__tags">
          <Tag size={12} style={{ color: 'var(--text-subtle)' }} />
          <span className="ext-provenance__key">Content</span>
          {tags.map((tag) => (
            <Badge key={tag} tone={isAdultTag(tag) ? 'danger' : 'accent'}>
              {tagLabel(tag)}
            </Badge>
          ))}
        </div>
      )}

      {description && (
        <div style={{ color: 'var(--text-muted)', lineHeight: 1.45 }}>{description}</div>
      )}

      {(url || homepageUrl) && (
        <div className="ext-provenance__grid">
          {homepageUrl && (
            <Field label="Project page">
              <ExternalLink url={homepageUrl} />
            </Field>
          )}
          {url && url !== homepageUrl && (
            <Field label="Source URL">
              <ExternalLink url={url} />
            </Field>
          )}
        </div>
      )}

      {fileHash && (
        <Field label="SHA-256">
          <code style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{fileHash}</code>
        </Field>
      )}
    </div>
  );
};
