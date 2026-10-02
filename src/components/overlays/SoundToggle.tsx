"use client";

import { useEffect, useState } from "react";
import { soundStore } from "@/lib/soundStore";

/**
 * The sound toggle.
 *
 * ## Why this button exists at all
 *
 * Not as a nicety — because browsers will not start unmuted audio until the user
 * has interacted with the page, so *something* has to be clicked before the bed
 * can play. This is that something, and it does double duty as the disclosure:
 * the piece makes no sound until the reader asks it to.
 *
 * It sits with the rest of the fixed chrome rather than in the scroll column,
 * because it has to be reachable at any point in the journey without scrolling
 * back to find it.
 *
 * The icon is drawn with CSS rather than imported as SVG so there is no extra
 * request, and the state is read from the store rather than held locally — the
 * store is the source of truth, and a second copy would drift.
 */
export function SoundToggle() {
  const [enabled, setEnabled] = useState(() => soundStore.enabled);

  useEffect(() => soundStore.subscribe(setEnabled), []);

  return (
    <button
      type="button"
      onClick={() => soundStore.toggle()}
      aria-pressed={enabled}
      // The label is the accessible name; the glyph alone is not enough, and a
      // screen-reader user toggling sound needs to know the current state.
      aria-label={enabled ? "Mute ambient sound" : "Play ambient sound"}
      title={enabled ? "Mute ambient sound" : "Play ambient sound"}
      className="pointer-events-auto flex items-center gap-2 rounded-full border border-white/20 bg-black/35 px-3 py-1.5 backdrop-blur-md transition hover:border-white/40 hover:bg-black/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/70"
    >
      <span aria-hidden className="flex h-3 w-4 items-end gap-[2px]">
        {/* Three bars whose heights animate with state. Decorative: the button's
            accessible name already carries the meaning. */}
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className={`w-[3px] rounded-full bg-white transition-all duration-200 ${
              enabled ? "animate-pulse" : "h-[3px]"
            }`}
            style={{
              height: enabled ? [9, 12, 6][i] : 3,
              animationDelay: enabled ? `${i * 140}ms` : undefined,
              opacity: enabled ? 1 : 0.55,
            }}
          />
        ))}
      </span>
      <span className="hud-label">{enabled ? "Sound on" : "Sound off"}</span>
    </button>
  );
}