"use client";

import { useEffect } from "react";
import { scrollStore } from "@/lib/scrollStore";

/**
 * Attaches the scroll store to the document once, at the top of the tree.
 *
 * The page scrolls natively: the <Canvas> is `position: fixed` and a tall
 * spacer drives the scroll height. That means GSAP ScrollTrigger, browser
 * find-in-page, keyboard scrolling, and mobile momentum all keep working —
 * none of which they would with a custom scroll hijack.
 */
export function ScrollProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => scrollStore.attach(window), []);

  return <>{children}</>;
}
