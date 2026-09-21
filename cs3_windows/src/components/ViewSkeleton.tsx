/**
 * What a route shows while its code is still arriving.
 *
 * The renderer used to ship as one 2.1 MB chunk, so the window — which waits
 * for `ready-to-show`, which waits for the first paint — could not appear until
 * every screen in the app had been parsed and evaluated, including the 4,152
 * line player and the two media libraries behind it. Splitting the routes moves
 * that cost to the moment a route is opened, and this is what stands in for the
 * few milliseconds it takes.
 *
 * It is shaped, not a spinner, and that is the whole argument for it existing:
 * a spinner says "something is happening", a block in the position the content
 * will occupy says "this is where it will be" and does not move the layout when
 * it arrives. A chunk read off local disk is fast enough that the honest risk
 * here is a flash, so it fades in — under about 150ms nothing is drawn at all.
 */
export function ViewSkeleton() {
  return (
    <div className="view-skeleton" role="status" aria-label="Loading">
      <div className="view-skeleton__bar view-skeleton__bar--title" />
      <div className="view-skeleton__grid">
        {Array.from({ length: 8 }, (_, index) => (
          <div key={index} className="view-skeleton__card" />
        ))}
      </div>
    </div>
  );
}
