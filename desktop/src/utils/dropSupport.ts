/**
 * Whether a drag is something CS3 can open, decided before the drop.
 *
 * The drop overlay used to light up for any drag carrying files or text — an
 * image dragged off a web page, a PDF, a word selected in the app itself — and
 * a feature that reacts to everything reads as one that is in the way.
 *
 * While a drag is in progress Chromium shows only the *shape* of what is being
 * dragged: each item's kind (`file`/`string`) and MIME type, never a file name
 * or the text. So the decision is made on MIME types, conservatively in one
 * direction only: a file whose type the system does not know (`''`) counts,
 * because that is exactly how a `.torrent` arrives on a machine with no
 * torrent client registered, and how `.mkv` arrives on some Windows installs.
 * Everything with a known type that is not media — images, documents,
 * archives, programs — stays quiet. The drop itself then decides on the real
 * file names (`classifyDroppedPaths`).
 */

export interface DragItemShape {
  kind: string;
  type: string;
}

/** Drags the app starts itself (a sidebar row being reordered) are not inputs. */
const APP_DRAG_TYPES = ['application/x-ott-platform'];

const MEDIA_MIME_PREFIXES = ['video/', 'audio/'];
const MEDIA_MIME_TYPES = new Set([
  'application/x-bittorrent',
  'application/x-matroska',
  'application/mp4',
  'application/ogg',
  'application/x-mpegurl',
  'application/vnd.apple.mpegurl',
]);

function isOpenableFileType(type: string): boolean {
  const mime = type.trim().toLowerCase();
  if (mime === '') return true;
  return MEDIA_MIME_TYPES.has(mime) || MEDIA_MIME_PREFIXES.some((prefix) => mime.startsWith(prefix));
}

/**
 * True when the drag may be something CS3 opens.
 *
 * - Started inside this window → never (the app's own drags are not inputs).
 * - Any file with a media, torrent or unknown type → yes; one is enough, the
 *   rest are dealt with on drop.
 * - No files, but a link (`text/uri-list`) → yes: a magnet or a page address,
 *   both of which the drop handles. Plain selected text → no.
 */
export function isSupportedDrag(
  types: readonly string[],
  items: readonly DragItemShape[],
  startedInApp: boolean,
): boolean {
  if (startedInApp) return false;
  if (types.some((type) => APP_DRAG_TYPES.includes(type))) return false;

  const files = items.filter((item) => item.kind === 'file');
  if (files.length > 0) return files.some((file) => isOpenableFileType(file.type));
  // Files announced without per-item detail: the type list is all there is.
  if (types.includes('Files') && items.length === 0) return true;

  return types.includes('text/uri-list');
}

const TORRENT_EXTENSIONS = new Set(['torrent']);
const MEDIA_EXTENSIONS = new Set([
  'mp4', 'm4v', 'mkv', 'webm', 'avi', 'mov', 'wmv', 'flv', 'mpg', 'mpeg', 'ts', 'm2ts', 'mts',
  'ogv', '3gp', 'mp3', 'm4a', 'aac', 'flac', 'wav', 'ogg', 'opus',
]);

function extensionOf(filePath: string): string {
  const name = filePath.split(/[\\/]/).pop() ?? '';
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

/** What a drop actually contained, by file name. */
export function classifyDroppedPaths(paths: readonly string[]): {
  torrents: string[];
  media: string[];
  other: string[];
} {
  const torrents: string[] = [];
  const media: string[] = [];
  const other: string[] = [];
  for (const filePath of paths) {
    const ext = extensionOf(filePath);
    if (TORRENT_EXTENSIONS.has(ext)) torrents.push(filePath);
    else if (MEDIA_EXTENSIONS.has(ext)) media.push(filePath);
    else other.push(filePath);
  }
  return { torrents, media, other };
}

/** A dropped link the app can act on: a magnet, or a web page to search for. */
export function droppedLinkKind(text: string | undefined | null): 'magnet' | 'page' | null {
  const value = text?.trim() ?? '';
  if (/^magnet:\?/i.test(value)) return 'magnet';
  if (/^https?:\/\/\S+$/i.test(value)) return 'page';
  return null;
}
