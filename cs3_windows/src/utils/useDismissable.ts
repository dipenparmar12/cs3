import { useEffect, type RefObject } from 'react';

/**
 * Close this on a click outside it, or on Escape.
 *
 * Seven components had their own copy of this effect — `FacetMenu`,
 * `CopyErrorButton`, `SourceExportButton`, `PlayerCopyMenu`, `DetailHero`,
 * `SearchScopePicker` and `HistoryView`'s export menu — and they had drifted on
 * the one detail that matters.
 *
 * ## The drift was a bug, and it closed the film
 *
 * `VideoPlayer` binds `keydown` on `window` and treats Escape as "close the
 * open panel, or leave the player". Five of the seven copies listened on
 * `document` in the **bubble** phase and did not stop the event, and `window`
 * is the last stop in the bubble path — so the menu handled Escape, and then
 * the player handled the same Escape with no panel open and called `onBack()`.
 * Opening the copy menu inside the player and pressing Escape closed the menu
 * *and ended playback*. `SourceExportButton` had worked this out and used
 * capture plus `stopPropagation`; it was one component's fix for a shared
 * mistake.
 *
 * So the rule lives here: **whoever consumes the Escape stops it.** The listener
 * is registered in the capture phase, which runs before the player's
 * bubble-phase handler, and calls `stopPropagation` only when it actually
 * closed something — an Escape this menu ignored must still reach whatever else
 * wanted it, or closing a menu would start swallowing the viewer's other
 * shortcuts.
 *
 * ## Why `pointerdown` and not `click`
 *
 * `click` fires after the button that opened the menu has already been
 * released, so a second click on the trigger would close the menu on the
 * outside-click path and immediately reopen it on the trigger's own handler —
 * a menu that cannot be closed by the control that opened it. `pointerdown` in
 * capture, with the wrapper containing the trigger, avoids the whole race and
 * is also what makes the menu close the moment a drag begins rather than when
 * it ends.
 */
export function useDismissable(
  open: boolean,
  wrapper: RefObject<HTMLElement | null>,
  onDismiss: () => void
): void {
  useEffect(() => {
    if (!open) return;

    const onOutside = (event: PointerEvent) => {
      const node = wrapper.current;
      // No wrapper yet means the menu is mid-mount; a click cannot be "outside"
      // something that is not on screen, and dismissing here would close it on
      // the very gesture that opened it.
      if (node && !node.contains(event.target as Node)) onDismiss();
    };

    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // Consumed here, so nothing further up acts on it. See the note above.
      event.stopPropagation();
      onDismiss();
    };

    document.addEventListener('pointerdown', onOutside, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onOutside, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open, wrapper, onDismiss]);
}
