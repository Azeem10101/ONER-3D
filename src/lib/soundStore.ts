"use client";

/**
 * SOUND STATE
 * ===========
 * Whether the ambient bed is on, and who wants to know when that changes.
 *
 * ## Why this is a module-level store rather than React state
 *
 * Two unrelated parts of the tree need this: the <audio> element, which lives
 * inside the video layer and runs on a rAF loop, and the toggle button, which
 * lives in the overlay chrome. Toggling via `useState` would re-render the whole
 * overlay subtree — including every beat text block — to change one boolean on
 * one element. This is the same reasoning as `scrollStore`: write the number,
 * notify the one thing that cares, and leave React out of the frame loop.
 *
 * ## Why sound is OFF by default
 *
 * Not only because browsers block unmuted autoplay until the user has
 * interacted with the page. A documentary that starts making noise before anyone
 * has touched anything is hostile, and this is an ambient bed rather than a
 * soundtrack with a cue that demands attention. It stays silent until asked.
 */
let enabled = false;

const listeners = new Set<(value: boolean) => void>();

export const soundStore = {
  get enabled() {
    return enabled;
  },

  subscribe(listener: (value: boolean) => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  set(next: boolean) {
    if (enabled === next) return;
    enabled = next;
    for (const listener of listeners) listener(enabled);
  },

  toggle() {
    soundStore.set(!enabled);
  },
};