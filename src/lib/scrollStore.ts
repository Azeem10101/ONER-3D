/**
 * Global scroll progress store.
 *
 * WHY THIS EXISTS
 * ---------------
 * Two very different consumers need the same scroll value every frame:
 *
 *   1. The R3F render loop, which samples the camera path in `useFrame`.
 *   2. The HTML overlays (gas / waste cards), which are plain DOM.
 *
 * Putting `progress` in React state would re-render the tree 60+ times a
 * second. Instead we keep a single mutable number in module scope and let the
 * render loop read it directly. React only re-renders when a *section
 * boundary* is crossed, which is rare.
 *
 * The page uses NATIVE document scroll (the <Canvas> is `position: fixed`),
 * so this is just a thin wrapper over window.scrollY. See `ScrollProvider`.
 */

export type ScrollListener = (progress: number, velocity: number) => void;

/** Where the user currently is along the whole journey, 0 -> 1. */
let progress = 0;

/** Raw, undamped progress straight from the scroll event. */
let target = 0;

/** Progress delta between the last two frames. Useful for motion effects. */
let velocity = 0;

const listeners = new Set<ScrollListener>();

/** Live reference to the scrollable element. Set by <ScrollProvider>. */
let scroller: HTMLElement | Window | null = null;

function clamp01(n: number) {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

function measure() {
  if (!scroller) return;

  // Narrow the union so the window and element branches below are each
  // type-safe. `scroller` is only ever set from `attach`.
  const isWindow = scroller === window;
  const element = isWindow ? null : (scroller as HTMLElement);

  const max = isWindow
    ? document.documentElement.scrollHeight - window.innerHeight
    : element!.scrollHeight - element!.clientHeight;
  if (max <= 0) {
    progress = 0;
    target = 0;
    return;
  }
  target = clamp01((isWindow ? window.scrollY : element!.scrollTop) / max);
}

function handleScroll() {
  measure();
  for (const listener of listeners) listener(progress, velocity);
}

export const scrollStore = {
  /** Raw (undamped) scroll position, 0 -> 1. Updated on every scroll event. */
  get target() {
    return target;
  },

  /**
   * Damped progress. Call once per frame from inside the R3F render loop.
   * Exponential smoothing that is frame-rate independent.
   */
  get smoothed() {
    return progress;
  },

  /** Change in smoothed progress since the previous frame. */
  get velocity() {
    return velocity;
  },

  /**
   * Advance the damped value toward the raw target. `lag` is roughly "how
   * many frames behind the scroll the camera should be" — 0 disables
   * smoothing. Keep it low (0.08 - 0.15) or the camera feels laggy/swimmy.
   */
  step(lag: number) {
    const previous = progress;
    if (lag <= 0) {
      progress = target;
    } else {
      progress += (target - progress) * lag;
      // Snap when imperceptibly close, otherwise we keep a permanent 1e-6 drift.
      if (Math.abs(target - progress) < 0.0001) progress = target;
    }
    velocity = progress - previous;
  },

  subscribe(listener: ScrollListener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  /** Wire the store to a scrollable element. Call from an effect. */
  attach(element: HTMLElement | Window) {
    scroller = element;
    measure();
    element.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("resize", handleScroll);
    return () => {
      element.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", handleScroll);
      if (scroller === element) scroller = null;
    };
  },

  /** Scroll back to the very start. Used by the "skip intro" button. */
  reset() {
    if (!scroller) return;
    if (scroller === window) window.scrollTo({ top: 0, behavior: "smooth" });
    else scroller.scrollTo({ top: 0, behavior: "smooth" });
  },
};
