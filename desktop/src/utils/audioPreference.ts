/**
 * Which audio language to ask the engine for, and which to write down.
 *
 * The stream's default track is what plays only when the viewer has expressed
 * no wish at all. Before this module, the played-source record stored whatever
 * happened to play ten seconds in — usually the default, English — and the next
 * play read it back as this title's preference, ahead of the language the viewer
 * keeps choosing. One unattended play pinned a title to its default for good.
 */
import type { PlaybackPreferences } from '../types/library';

/** A language stored for this title, only if somebody chose it. */
function storedChoice(stored: PlaybackPreferences | null | undefined): string | undefined {
  return stored?.audioChosen ? stored.audioLanguage || undefined : undefined;
}

/**
 * This session's pick, then a pick stored for this title, then the language the
 * viewer keeps choosing everywhere. `undefined` means "the stream's default".
 */
export function wantedAudioLanguage(
  sessionChoice: string | null | undefined,
  stored: PlaybackPreferences | null | undefined,
  everywhere: string | null | undefined
): string | undefined {
  return sessionChoice || storedChoice(stored) || everywhere || undefined;
}

/**
 * The audio half of what goes onto the played-source record.
 *
 * Both fields are present even when empty: the record is merged field by
 * field, and an explicit `undefined` is what clears a default an older build
 * stored as if it were a choice.
 */
export function recordedAudioChoice(
  sessionChoice: string | null | undefined,
  stored: PlaybackPreferences | null | undefined
): Pick<PlaybackPreferences, 'audioLanguage' | 'audioChosen'> {
  const language = sessionChoice || storedChoice(stored);
  return { audioLanguage: language, audioChosen: language ? true : undefined };
}
