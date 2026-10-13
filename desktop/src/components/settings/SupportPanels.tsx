import React from 'react';
import { Check, Copy, ExternalLink, Heart, Mail, X } from 'lucide-react';
import {
  PUBLIC_INFO,
  contactEmail,
  usableDeveloperLinks,
  usableDonationMethods,
  type DonationMethod,
} from '../../config/publicInfo';
import { useFlash } from '../../utils/useFlash';
import { Button } from '../ui';

/**
 * Support CS3 and About the developer (requirements 100–107).
 *
 * Two sections that sit next to each other and stay independent: dismissing
 * the support card hides one card, never the developer's details or the
 * donation methods, which stay under Settings → About & support.
 *
 * Every destination comes from `config/publicInfo.ts`. A method that is not
 * configured is not drawn — the card says so in one line rather than offering
 * a button that goes nowhere.
 */

function openLink(url: string) {
  void window.cloudstream?.openExternalLink?.(url);
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/**
 * The configured donation methods, each saying where it goes before it is
 * pressed: an external page names its host, a UPI ID is shown in full with a
 * copy button (desktop systems rarely have a UPI handler; a phone does).
 */
const DonationMethodList: React.FC<{ methods: DonationMethod[] }> = ({ methods }) => {
  const { message: copied, flash } = useFlash<string>(2000);
  return (
    <ul className="support__methods">
      {methods.map((method) => (
        <li key={method.id} className="support__method">
          <div className="support__method-text">
            <span className="support__method-label">{method.label}</span>
            <span className="support__method-detail">
              {method.kind === 'link'
                ? `Opens ${hostOf(method.url)} in your browser`
                : `UPI ID ${method.upiId} — pay from any UPI app`}
              {method.description ? ` · ${method.description}` : ''}
            </span>
          </div>
          {method.kind === 'link' ? (
            <Button
              size="compact"
              icon={ExternalLink}
              onClick={() => openLink(method.url)}
              aria-label={`${method.label} — opens ${hostOf(method.url)} in your browser`}
            >
              Open
            </Button>
          ) : (
            <Button
              size="compact"
              icon={copied === method.id ? Check : Copy}
              onClick={() => {
                void navigator.clipboard
                  .writeText(method.upiId.trim())
                  .then(() => flash(method.id))
                  .catch(() => undefined);
              }}
            >
              {copied === method.id ? 'Copied' : 'Copy UPI ID'}
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
};

const SUPPORT_LEDE =
  'CloudStream 3 Desktop is free and built as a hobby. If it is useful to you, a voluntary contribution helps cover the time it takes to keep it working. Nothing in the app depends on it.';

/** No donation page is configured yet: say how else to help, never a dead button. */
const NoDonationMethods: React.FC = () => {
  const repository = usableDeveloperLinks().find((link) => link.id === 'repository');
  return (
    <p className="support__empty">
      Donation options are not set up yet.
      {repository ? (
        <>
          {' '}
          Starring or sharing the{' '}
          <Button variant="ambient" size="compact" className="support__inline-link" onClick={() => openLink(repository.url)}>
            project on GitHub
          </Button>{' '}
          helps too.
        </>
      ) : null}
    </p>
  );
};

/**
 * The prominent card at the top of Settings. Dismissible with a quiet ×; the
 * same methods stay reachable under About & support.
 */
export const SupportCard: React.FC<{ onDismiss: () => void; onShowMore: () => void }> = ({
  onDismiss,
  onShowMore,
}) => {
  const methods = usableDonationMethods();
  return (
    <section className="support-card" aria-labelledby="support-card-title">
      <Button
        variant="ambient"
        size="compact"
        iconOnly
        icon={X}
        className="support-card__dismiss"
        onClick={onDismiss}
        aria-label="Hide this card"
        title="Hide this card — it stays available under About & support"
      />
      <div className="support-card__head">
        <Heart size={16} aria-hidden className="support-card__icon" />
        <h3 id="support-card-title">Support CS3</h3>
      </div>
      <p className="support-card__lede">{SUPPORT_LEDE}</p>
      {methods.length > 0 ? <DonationMethodList methods={methods} /> : <NoDonationMethods />}
      <Button variant="ambient" size="compact" className="support__inline-link support-card__more" onClick={onShowMore}>
        About the developer
      </Button>
    </section>
  );
};

/**
 * The smaller entry under About & support: the same methods, plus the way back
 * to the prominent card once it has been hidden.
 */
export const SupportSettings: React.FC<{ cardDismissed: boolean; onRestoreCard: () => void }> = ({
  cardDismissed,
  onRestoreCard,
}) => {
  const methods = usableDonationMethods();
  return (
    <div className="support">
      <p className="support__lede">{SUPPORT_LEDE}</p>
      {methods.length > 0 ? <DonationMethodList methods={methods} /> : <NoDonationMethods />}
      {cardDismissed ? (
        <div className="support__restore">
          <span>The support card is hidden from the top of Settings.</span>
          <Button size="compact" onClick={onRestoreCard}>
            Show it again
          </Button>
        </div>
      ) : null}
    </div>
  );
};

/** Who builds the app and how to reach them. Independent of the support card. */
export const DeveloperPanel: React.FC = () => {
  const { developer } = PUBLIC_INFO;
  const links = usableDeveloperLinks();
  const email = contactEmail();
  return (
    <div className="developer">
      <div className="developer__identity">
        <span className="developer__name">{developer.name}</span>
        {developer.tagline ? <span className="developer__tagline">{developer.tagline}</span> : null}
      </div>

      {developer.contactTopics?.length ? (
        <p className="developer__topics">
          Get in touch about: {developer.contactTopics.join(' · ')}.
        </p>
      ) : null}

      <ul className="developer__links">
        {email ? (
          <li>
            <Button
              variant="ambient"
              icon={Mail}
              className="developer__link"
              onClick={() => openLink(`mailto:${email}`)}
              title={`Opens your mail app to write to ${email}`}
            >
              <span className="developer__link-label">Email</span>
              <span className="developer__link-detail">{email}</span>
            </Button>
          </li>
        ) : null}
        {links.map((link) => (
          <li key={link.id}>
            <Button
              variant="ambient"
              icon={ExternalLink}
              className="developer__link"
              onClick={() => openLink(link.url)}
              title={`Opens ${link.url} in your browser`}
            >
              <span className="developer__link-label">{link.label}</span>
              <span className="developer__link-detail">{link.description ?? hostOf(link.url)}</span>
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
};
