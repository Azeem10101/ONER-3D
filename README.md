# ONER 3D

A scroll-driven 3D experience for **ONER**, the environmental AI autopilot. The
viewer starts above a jungle, descends toward an industrial plant, follows the
smoke plume up past the gases it contains, pulls back to the bird's eye, then
dives into the lake the plant has been discharging into.

Built as the narrative front door to the existing ONER platform — it frames the
problem the dashboard then quantifies.

## Stack

| Concern | Choice |
| --- | --- |
| Framework | Next.js 16 (App Router, Turbopack) + React 19 + TypeScript |
| 3D | Three.js 0.186 via React Three Fiber 9 + drei 10 |
| Scroll | Native document scroll + one `requestAnimationFrame` loop |
| Styling | Tailwind CSS v4 |
| Assets | Model in Spline → export `.glb` → load in R3F |

## Getting started

```bash
npm install
npm run dev          # http://localhost:3000
```

| Script | Purpose |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm run check` | Types + lint + timeline validation |

## How the scroll works

This is the part worth understanding before changing anything.

```
window scroll position
        │
        ▼
┌───────────────────┐
│  scrollStore      │  raw progress 0 → 1, in module scope, no React state
└─────────┬─────────┘
          │
     ┌────┴─────┐
     ▼          ▼
┌─────────┐  ┌──────────────┐
│ 3D loop │  │ overlay loop │
│ (R3F)   │  │ (rAF)        │
└────┬────┘  └──────┬───────┘
     │              │
 camera transform  opacity / transform
 on a keyframed     written directly to
 Catmull path       the DOM nodes
```

Key decisions:

- **The canvas is `position: fixed`; the DOM column provides the scroll
  height.** Native scrolling is not hijacked, so keyboard scrolling, browser
  find-in-page, trackpad momentum, and mobile behaviour all keep working. GSAP
  ScrollTrigger or Lenis can be added later without a rewrite.
- **Scroll progress never enters React state.** It lives in a module-level
  store. The camera samples it in the render loop; the overlay loop writes
  `opacity` and a CSS variable straight onto cached DOM nodes. Scrolling
  therefore triggers **zero React re-renders** — the component tree renders
  once on mount.
- **One number drives everything.** The DOM section heights are
  `(to - from) * TOTAL_VH`, and the camera is sampled at the same progress. A
  gas card cannot drift out of sync with the moment its gas appears, because
  both read the same timeline.
- **Cards are HTML, not 3D text.** Crisp at any resolution, selectable,
  screen-reader accessible, and free in the WebGL frame budget.

## Retiming the experience

`src/scene/timeline.ts` is the single source of truth. Each shot is a range of
scroll progress plus a start and end camera state:

```ts
{
  id: "rise-no2",
  from: 0.51,
  to: 0.6,
  position: [[6, 86, 12], [2, 106, 10]],
  target:   [[5, 84, -5],  [1, 104, -4]],
  fov:      [43, 43],
  ease:     "inOutSine",
  card:     "no2",
}
```

To slow a moment down, widen its range. To change total page length, edit
`TOTAL_VH` in `src/components/overlays/Overlays.tsx`.

Ranges must be contiguous and cover exactly `0 → 1`; a gap makes the camera
snap at the seam. `npm run check:timeline` enforces this, along with
no-orbit-camera-below-ground, no-unknown-cards, and no-cards-that-never-appear:

```
Progress  Duration  Shot
0.000 - 0.080     8.0%  overview
0.080 - 0.200    12.0%  approach
0.200 - 0.320    12.0%  chimney
0.320 - 0.420    10.0%  rise-co2 [co2]
...
PASS — no problems found.
```

## Project layout

```
src/
  app/
    layout.tsx          Root layout, metadata
    page.tsx            Server component shell
    globals.css         Theme, card styles, reduced-motion handling
  components/
    Journey.tsx         Composes scene + overlays + scroll provider
    overlays/
      Overlays.tsx      Scroll column, the single rAF loop, all chrome
      CardPanel.tsx     One emissions card (pure presentational)
    scroll/
      ScrollProvider.tsx Attaches the store to the document
    three/
      Scene.tsx         The fixed full-viewport Canvas
      CameraRig.tsx     Samples the timeline into a camera transform
      Environment.tsx   Lights, fog, terrain
      Factory.tsx       Placeholder — replace with Spline GLB
      Jungle.tsx        Placeholder — replace with Spline GLB
      Lake.tsx          Placeholder — replace with Spline GLB
      Plume.tsx         Smoke particles (cheap, procedural)
  lib/
    scrollStore.ts      Module-scope scroll progress + damping
  scene/
    timeline.ts         THE TIMELINE — shots, easing, world layout
    content.ts          All card copy and figures
    random.ts           Seeded PRNG (keeps the scene identical per load)
    validate.ts         Development-time timeline assertions
scripts/
  check-timeline.ts     Runs validation in CI
```

## World layout

Right-handed, Y up, 1 unit ≈ 1 metre.

| Element | Position |
| --- | --- |
| Factory footprint | x ∈ [-22, 22], z ∈ [-16, 18] |
| Chimney | base `[8, 14, -6]` → top `[8, 44, -6]` |
| Lake centre | `[-52, 0, 30]`, radius 30 |
| Jungle ring | radius 60 → 260 |

All camera keyframes are in these units. Get the placeholder geometry's scale
right and real Spline models drop in without re-timing the camera.

## Replacing the placeholders

The factory, jungle, and lake are built from primitives to establish scale and
silhouette. To use real assets:

1. Model in Spline, then **Export → GLB** (Spline's `.splinecode` format is
   runtime-bound to Spline and is not a useful interchange format for a
   Three.js app).
2. Drop the `.glb` into `public/models/`.
3. Replace the placeholder component with `useGLTF` from drei.
4. Align the model to the world layout table above.

Lighting, fog, camera, and timeline do not need to change.

## Performance notes

- `dpr` is capped at `[1, 1.75]`. A full-screen canvas at dpr 2 is 4× the
  fragment work for a difference that is invisible on a moving scene.
- The lake uses `MeshReflectorMaterial`, which renders the scene a second time.
  At 512px with blur this is fine on desktop; drop to 256 or switch to
  `MeshStandardMaterial` for mobile.
- Trees are instanced through drei's `<Instances>` — 1400 of them cost one
  draw call.
- The plume is 420 CPU-updated points. Cheap, and a placeholder for a real
  fluid simulation.
- All "random" placement uses a seeded PRNG so the art direction does not
  reshuffle on every hot reload.

## Accessibility

- The scroll column is real semantic markup: `<main>`, labelled `<section>`s,
  and all card copy in the DOM, so it works with a screen reader and is
  indexable.
- `prefers-reduced-motion: reduce` removes the card travel and the intro
  animation, and drops the overlay damping to 1 (no lag) while keeping the
  content fully readable.
- Cards only become interactive above 0.85 opacity, so a half-faded card
  cannot swallow a click meant for the scene behind it.

## Not yet built

- Live data from the ONER FastAPI backend. The card figures are illustrative;
  `card.stats` is shaped to be replaced with real values.
- Mobile / touch tuning.
- Progress persistence and a deep-linkable `#gas` / `#water` entry point.
