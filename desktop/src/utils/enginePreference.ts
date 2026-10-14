/**
 * Whether a source has told us it needs a full media player.
 *
 * Some extractors say so in their own name — CNC Verse's
 * `Castle TV (Use VLC) - Hindi, English, Tamil, Telugu` ships four audio
 * languages as elementary streams inside MPEG-TS with no `#EXT-X-MEDIA` tags,
 * which hls.js cannot switch between and mpv can. That suffix is the
 * maintainer's declaration about the stream, the same kind of fact as `isDash`,
 * so it is read from the source's name and extractor — never the provider,
 * which for that link is `CastleTvProvider` and says nothing.
 *
 * Only the explicit "use VLC/MPV" phrasing counts. A source merely *named*
 * after a player ("VLC Mirror") is not asking for anything.
 */
export function asksForExternalPlayer(
  source: { title?: string; indexerName?: string } | null | undefined,
): boolean {
  if (!source) return false;
  return [source.indexerName, source.title].some(
    (name) => typeof name === 'string' && /\b(?:use|play (?:in|with)|open (?:in|with))[ _-]?(?:vlc|mpv)\b/i.test(name),
  );
}
