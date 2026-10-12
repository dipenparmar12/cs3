/**
 * Who makes this app, how to reach them, and how to support it — in one place.
 *
 * Settings → About & support and the Support card at the top of Settings draw
 * from this file and nothing else, so changing a link is an edit here and never
 * a redesign there.
 *
 * **Only publish what is meant to be public.** Every value below is shown to
 * everyone who installs the app. The GitHub profile and repository were
 * verified public when this was written; the email, donation pages and UPI
 * destination were deliberately left empty because nobody has said which ones
 * are for publication. An empty or malformed entry is not drawn — it does not
 * appear as a dead button — so filling one in is the whole job.
 *
 * UPI: a UPI ID reveals the account holder's registered name to whoever pays
 * it, and some reveal the phone number they are built from. Prefer a merchant
 * or payment-page link (Razorpay, Instamojo, Cashfree…) as a `link` method,
 * which accepts UPI without exposing either; use a `upi` method only with an ID
 * you are content to publish.
 *
 * Nothing here processes a payment. Every method leaves the app.
 */

export interface PublicLink {
  id: string;
  label: string;
  url: string;
  /** One line under the label: what a person would go there for. */
  description?: string;
}

export type DonationMethod =
  | {
      kind: 'link';
      id: string;
      label: string;
      /** An https page on the platform — opened in the system browser. */
      url: string;
      description?: string;
    }
  | {
      kind: 'upi';
      id: string;
      label: string;
      /** A UPI virtual payment address, `name@bank`. Shown with a copy button. */
      upiId: string;
      description?: string;
    };

export interface PublicInfo {
  developer: {
    /** The public name or handle the app is credited to. */
    name: string;
    /** A short line under the name. */
    tagline?: string;
    /** Public contact address. Empty means not published. */
    contactEmail?: string;
    /** What people may get in touch about — shown beside the contact links. */
    contactTopics?: string[];
    links: PublicLink[];
  };
  donations: {
    methods: DonationMethod[];
  };
}

export const PUBLIC_INFO: PublicInfo = {
  developer: {
    name: 'Dipen Parmar',
    tagline: 'Developer of CloudStream 3 Desktop, a free hobby project.',
    // Not published yet. Put a public address here to show an "Email" link.
    contactEmail: '',
    contactTopics: [
      'Questions',
      'Feedback and bug reports',
      'Collaboration',
      'Service requests and business enquiries',
    ],
    links: [
      {
        id: 'github',
        label: 'GitHub',
        url: 'https://github.com/dipenparmar12',
        description: 'Profile and other projects',
      },
      {
        id: 'repository',
        label: 'Project repository',
        url: 'https://github.com/dipenparmar12/cs3',
        description: 'Source code for this desktop app',
      },
      {
        id: 'issues',
        label: 'Report a problem',
        url: 'https://github.com/dipenparmar12/cs3/issues',
        description: 'Bugs, ideas and questions, in public',
      },
    ],
  },
  donations: {
    /*
     * Empty until real destinations are chosen. Examples of the two shapes:
     *
     *   { kind: 'link', id: 'bmc', label: 'Buy Me a Coffee',
     *     url: 'https://buymeacoffee.com/<handle>', description: 'Cards, Apple Pay, Google Pay' },
     *   { kind: 'link', id: 'razorpay', label: 'UPI and Indian cards',
     *     url: 'https://razorpay.me/@<handle>', description: 'UPI, RuPay, netbanking' },
     *   { kind: 'upi', id: 'upi', label: 'UPI', upiId: '<name>@<bank>' },
     */
    methods: [],
  },
};

const UPI_ID = /^[a-z0-9._-]{2,256}@[a-z][a-z0-9.-]{1,64}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** An http(s) URL that parses. Anything else is not drawn. */
export function isPublishableUrl(value: string | undefined): value is string {
  // `<handle>` is the example's placeholder, copied in but never filled.
  if (!value || /[<>]/.test(value)) return false;
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:') && Boolean(url.hostname);
  } catch {
    return false;
  }
}

export function isUpiId(value: string | undefined): value is string {
  return Boolean(value && UPI_ID.test(value.trim()));
}

export function isEmail(value: string | undefined): value is string {
  return Boolean(value && EMAIL.test(value.trim()));
}

/**
 * The donation methods that can actually be used. A placeholder, an empty
 * string or a mistyped URL is dropped rather than drawn as a button that
 * goes nowhere — and a duplicated id keeps its first entry.
 */
export function usableDonationMethods(info: PublicInfo = PUBLIC_INFO): DonationMethod[] {
  const seen = new Set<string>();
  return info.donations.methods.filter((method) => {
    if (!method.label?.trim() || seen.has(method.id)) return false;
    const usable = method.kind === 'link' ? isPublishableUrl(method.url) : isUpiId(method.upiId);
    if (usable) seen.add(method.id);
    return usable;
  });
}

/** The developer's links that can be opened, in configured order. */
export function usableDeveloperLinks(info: PublicInfo = PUBLIC_INFO): PublicLink[] {
  return info.developer.links.filter((link) => link.label?.trim() && isPublishableUrl(link.url));
}

/** The published contact address, or null when there is none. */
export function contactEmail(info: PublicInfo = PUBLIC_INFO): string | null {
  const email = info.developer.contactEmail?.trim();
  return isEmail(email) ? email : null;
}
