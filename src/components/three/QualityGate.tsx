"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { AdaptiveScaler, qualityStore, resolveQuality, setManualOverride } from "@/scene/quality";
import type { GpuReport, QualitySettings, QualityTier } from "@/scene/quality";

/**
 * QUALITY GATE
 * ============
 * Resolves the quality tier once, then keeps the frame rate honest.
 *
 * The <Canvas> is mounted *after* resolution, because the tier determines
 * `dpr`, and changing dpr on a live canvas reallocates the render target,
 * which is a visible flash and a hitch. Decide first, mount once.
 *
 * ## Why a mutable module store
 *
 * Two very different places need the live settings: React, which renders the
 * trees and the terrain, and the R3F render loop, which adjusts the pixel
 * ratio every frame. Passing the adaptive result back through React state
 * would mean a re-render of the entire scene graph several times per second
 * whenever the render scale moved, which is precisely when the frame budget
 * is already blown.
 *
 * So the settings live in a module-level store, like the scroll store. React
 * reads a snapshot at mount and whenever the tier changes by hand; the render
 * loop mutates the store directly.
 */

type QualityContextValue = {
  settings: QualitySettings;
  gpu: GpuReport;
  isManual: boolean;
  setTier: (tier: QualityTier | "auto") => void;
};

const QualityContext = createContext<QualityContextValue | null>(null);

export function useQuality() {
  const context = useContext(QualityContext);
  if (!context) throw new Error("useQuality must be used inside <QualityProvider>");
  return context;
}

export function QualityProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<{
    settings: QualitySettings;
    gpu: GpuReport;
    isManual: boolean;
  } | null>(null);

  // GPU detection calls getContext("webgl"), which only exists in the browser,
  // so it cannot be a lazy state initialiser: the server has no GPU to ask,
  // and using one would produce a hydration mismatch against a guess. This is
  // a genuine "read from an external system once on mount" — the exact case
  // the lint rule warns about generally, but here the alternative is worse.
  //
  // Until it resolves this provider renders null, so the <Canvas> is never
  // mounted with a guessed dpr and then reconfigured.
  useEffect(() => {
    const resolved = resolveQuality();
    qualityStore.set(resolved.settings);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState({ ...resolved, isManual: resolved.isManual });
  }, []);

  const setTier = useCallback((tier: QualityTier | "auto") => {
    setManualOverride(tier);
    const resolved = resolveQuality();
    qualityStore.set(resolved.settings);
    setState({ ...resolved, isManual: tier !== "auto" });
  }, []);

  const value = useMemo<QualityContextValue | null>(
    () => (state ? { settings: state.settings, gpu: state.gpu, isManual: state.isManual, setTier } : null),
    [state, setTier]
  );

  if (!value) return null;

  return <QualityContext.Provider value={value}>{children}</QualityContext.Provider>;
}

/**
 * Drives the adaptive render scale. Lives inside <Canvas> because it needs
 * the frame delta.
 *
 * Only resolution moves. Instance counts stay fixed for the lifetime of the
 * page: rebuilding instanced meshes mid-scroll would cause a visible hitch,
 * and a scene that permanently strips its own detail ends up looking worse
 * than one that merely renders slightly soft.
 */
export function AdaptiveQuality() {
  const gl = useThree((state) => state.gl);

  // useMemo rather than a ref: the scaler must be created exactly once, and
  // a ref written during render trips the compiler's ref-access rules.
  const scaler = useMemo(() => {
    const base = qualityStore.snapshot();
    if (!base) return null;
    return new AdaptiveScaler(base, (next) => {
      qualityStore.set(next);
    });
  }, []);

  useFrame((_, delta) => {
    const settings = qualityStore.current;
    if (!settings) return;

    scaler?.update(delta, settings);

    // Applied by resizing the drawing buffer, which is far cheaper than
    // remounting the Canvas.
    const devicePixelRatio = globalThis.devicePixelRatio || 1;
    const target = Math.min(settings.maxPixelRatio, devicePixelRatio * settings.renderScale);
    if (Math.abs(gl.getPixelRatio() - target) > 0.01) {
      gl.setPixelRatio(target);
    }
  });

  return null;
}

/** Reads the live settings from outside React. Used by the dev panel. */
export function currentSettings() {
  return qualityStore.snapshot();
}
