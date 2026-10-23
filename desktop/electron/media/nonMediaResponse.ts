/**
 * What a source answered instead of media (Content Validation PRD §6, Phase 2).
 *
 * A provider link that returns HTTP 200 is not therefore a video: it can be a
 * sign-in page, a "please update the app" notice, or a landing page. Those were
 * reported as "the format could not be read", which sends a viewer looking for
 * a codec problem. Read from the response's content type and the first part of
 * its body only. Pure.
 */

export type NonMediaKind = 'login' | 'update-required' | 'html';

const LOGIN = [
  /\b(?:sign|log)\s*-?\s*in\b/i,
  /\blogin\b/i,
  /\bauthenticat(?:e|ion)\b/i,
  /\bpassword\b/i,
  /\bcreate (?:a |an )?account\b/i,
  /\bsubscribe to (?:watch|continue)\b/i,
];

const UPDATE = [
  /\bupdate (?:your |the )?app\b/i,
  /\b(?:please|kindly) update\b/i,
  /\bnew version (?:is )?(?:required|available)\b/i,
  /\bapp (?:is )?(?:outdated|out of date)\b/i,
  /\bdownload (?:our|the) (?:latest )?app\b/i,
  /\bunsupported (?:app )?version\b/i,
];

export function looksLikeHtml(contentType: string | null | undefined, head: string): boolean {
  if (contentType && /\b(?:text\/html|application\/xhtml\+xml)\b/i.test(contentType)) return true;
  return /^\s*(?:<!doctype html|<html[\s>]|<head[\s>]|<body[\s>])/i.test(head);
}

/** Visible text of a page's head, roughly: tags and scripts dropped. */
function visibleText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ');
}

/** Update notices win over sign-in, since an update page often links a login too. */
export function classifyNonMedia(contentType: string | null | undefined, head: string): NonMediaKind | null {
  if (!looksLikeHtml(contentType, head)) return null;
  const text = visibleText(head);
  if (UPDATE.some((pattern) => pattern.test(text))) return 'update-required';
  if (/<input[^>]+type=["']?password/i.test(head) || LOGIN.some((pattern) => pattern.test(text))) return 'login';
  return 'html';
}

export function nonMediaReason(kind: NonMediaKind): string {
  switch (kind) {
    case 'login':
      return 'This source answered with a sign-in page instead of the video. It needs an account on its website.';
    case 'update-required':
      return 'This source answered with an "update the app" notice instead of the video. Try another source.';
    case 'html':
      return 'This source answered with a web page, not a video. Try another source.';
  }
}
