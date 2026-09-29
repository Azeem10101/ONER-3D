# ONER-3D — Asset Requirements & Pipeline

> Status: **planning document.** No assets downloaded. No scene modified.
> Target hardware: Intel Arc integrated GPU (Core Ultra 7 155H), 16 GB shared RAM.

This document defines every external asset the project needs, where it comes
from, what it costs, and how it gets into the web build. It is written to be
executable as-is, so the next milestone is mechanical rather than exploratory.

**Licensing constraint: CC0 / public domain only.** Every row below carries an
explicit source and license. Where no CC0 asset meets the quality bar, this
document says so plainly and specifies the alternative, rather than quietly
substituting something that merely happens to be free.

---

## 0. Source policy

| Source | License | API | Use for |
| --- | --- | --- | --- |
| [Poly Haven](https://polyhaven.com) | **CC0 1.0** (public domain) | `api.polyhaven.com` | Primary. Trees, industrial modules, HDRIs, textures |
| [ambientCG](https://ambientcg.com) | **CC0 1.0** | REST | Terrain and ground PBR materials |
| Blender (procedural) | n/a — our own work | local | Factory superstructure, chimneys, tanks, catwalks, LODs, atlases |

**Why Poly Haven is the backbone.** It is the only CC0 library verified to carry
photogrammetry-grade assets with pre-made LODs and 8K PBR textures, and it
exposes a public JSON API so the whole pipeline is scriptable and reproducible.
I queried the API for this document; every asset named below exists there.

**Rejected sources and why:**

- *Sketchfab* — CC0-tagged but per-model license is inconsistent and requires
  manual review of each file. Too much licensing risk to automate.
- *Kenney / low-poly packs* — CC0, but stylised low-poly. Directly contrary to
  the brief ("do not use cartoon trees").
- *Blender Market / Superhive / Fab* — paid. Excluded by instruction.
- *Forestation / Terra Scans* — the best photoreal tree packs, but paid.
  Not usable. This is the single biggest quality compromise; see §11.

---

## 1. Tree and vegetation assets

### 1.1 Hero trees — the canopy

Poly Haven's `trees` category. All CC0, all with author-provided LODs and 8K
textures.

| ID | Role | Source poly | Notes |
| --- | --- | --- | --- |
| `jacaranda_tree` | Primary broadleaf | 312k | Multi-trunk, dense canopy. LODs provided. Highest download count on the site (144k) — a proxy for quality |
| `island_tree_01` | Emergent | 3.7M | Twisted trunk, wind-sculpted canopy. LODs provided. Must be decimated hard |
| `island_tree_02` | Mid broadleaf | 1.76M | LODs provided |
| `pachira_aquatica_01` | Tropical understory | 77k | Braided trunk, glossy leaves. Reads as tropical immediately |

> **Colour caution:** `jacaranda_tree` is purple-flowered. Even desaturated it
> will read wrong against a green canopy. It is listed as the *structural*
> reference for canopy shape and LOD chain, not necessarily a ship asset. The
> real selection happens at import time by visual comparison.

### 1.2 Understory and ground cover

| ID | Role | Source poly |
| --- | --- | --- |
| `fern_02` | Fern clumps | 6.2k |
| `nettle_plant` | Broadleaf understory | 46k |
| `moss_01` | Ground cover | 246k |
| `shrub_01` | Shrub | 282k |
| `dead_tree_trunk_02` | Fallen debris, forest floor | 156k |

### 1.3 Vegetation budget and LOD chain

| LOD | Triangles | Distance band | Technique |
| --- | --- | --- | --- |
| LOD0 | 3k – 6k | 0 – 120 m | Full mesh |
| LOD1 | 800 – 1.5k | 120 – 350 m | Decimated, alpha-tested leaf cards |
| LOD2 | 200 – 400 | 350 – 900 m | Impostor billboard (2 tris) |
| Shell | n/a | 900 m + | Canopy shell, see §4 |

Per-tree texture: **single 1024² atlas** after Blender repack. 8K source
textures are a non-starter here — 8K BC7 is 22MB uncompressed per map, and four
maps per species would exhaust shared RAM on their own.

**Instance budget on Arc:**

| Tier | LOD0/LOD1 | LOD2 | Draw calls |
| --- | --- | --- | --- |
| HIGH | 200 | 2,500 | ~40 |
| MEDIUM | 80 | 1,200 | ~24 |
| LOW | 0 (impostors only) | 500 | ~12 |

### 1.4 Camera requirement

The camera descends to 26 m at the outro and passes within metres of trees in
the approach. So we need genuine near-field quality, not just a distant forest.
This is why LOD0 exists at all.

---

## 2. Factory assets

### 2.1 Verified Poly Haven industrial modules (CC0)

Queried from the API. All 8K PBR, all authored specifically for this purpose.

| ID | Role | Source poly | LODs |
| --- | --- | --- | --- |
| `modular_factory_facade` | **Building shells.** Brick panels, varied windows, doors, loading bays | 175k | no |
| `modular_pipes` | Pipe runs, fittings, valves, weathered | 47k | no |
| `modular_industrial_pipes_01` | Industrial pipe set: flanges, elbows, tees, valve with gauge | 12k | no |
| `modular_airduct_rectangular_01` | Ducting, elbows, joints, grilles | 45k | no |
| `modular_airduct_circular_01` | Circular ducting, corrugated sections | 14k | no |
| `overhead_crane` | Crane hoist: beam, trolley, cable drum, hook | 90k | no |
| `old_military_compressor` | Machinery: compressor with belt drive, stencils | 79k | no |
| `portable_generator` | Machinery, grime detail | 26k | no |
| `modular_electric_cables` | Cables, junction boxes, conduit | 42k | no |
| `modular_electricity_poles` | Utility poles, transformers, insulators | 201k | no |
| `modular_chainlink_fence` | Perimeter fencing, gate | 89k | yes |
| `modular_fire_escape` | **Catwalk source.** Platforms, ladders, stair sections, railings | 11k | no |
| `concrete_road_barrier` | Site barriers | 81k | yes |
| `rollershutter_door` | Loading bay doors | 1.1k | no |
| `utility_box_01/02` | Electrical cabinets | 4.4k / 6.3k | no |
| `ladder_sectioned_01` | Access ladders, safety caps | 29k | no |
| `Barrel_01/02/03` | Drums, storage | 2.7k each | no |
| `wooden_crate_01/02` | Storage crates | 6.6k / 5.2k | no |
| `industrial_storage_cart` | Plant equipment | 19k | no |
| `caged_hanging_light` | Exterior lighting | 23k | no |
| `fire_hydrant` | Site detail | 86k | no |

### 2.2 Must be authored in Blender — no CC0 equivalent exists

I searched specifically for these. **Nothing suitable exists under CC0**, so
they are ours to build. This is not a fallback — piped industrial
superstructure is genuinely rare in free libraries, and the reference factory is
mostly this.

| Component | Target tris | Why Blender |
| --- | --- | --- |
| **Chimney stack ×3** | 8k each | Tapered lathe geometry, banding rings, ladder cage, platform. No CC0 chimney exists on Poly Haven |
| **Storage tanks ×4** | 6k each | Cylindrical + conical roof, external stair spiral, railing |
| **Cooling tower** | 12k | Hyperboloid profile (natural draft) |
| **Conveyor bridge ×2** | 15k each | Enclosed truss spanning between buildings, the signature element in the reference |
| **Structural frame / hall** | 40k | Steel truss columns, roof trusses, gantry rails |
| **Catwalks** | 8k | Reuse `modular_fire_escape` railings; author the spans |
| **Handrail system** | 3k | One reusable module, instanced everywhere |
| **Pipe supports / gantries** | 5k | Structural, connects pipe runs to buildings |
| **Valve / flange cluster** | 2k | One module, heavily instanced |

**Factory totals:** ~180k triangles, **target under 80 draw calls.** For static
architecture at this scale, that is cheap. The real cost is textures.

### 2.3 Factory material set

Six materials only, which is what keeps draw calls down:

1. Weathered red brick (facade)
2. Stained concrete (structure, pad)
3. Rusted steel (pipes, frames)
4. Painted steel, chipped (tanks, machinery)
5. Corrugated metal roofing
6. Industrial glass (windows)

Weathering lives in **albedo and roughness maps, never in geometry.** Rust
streaks as geometry would multiply triangles for detail that reads identically
at every camera distance we use.

---

## 3. Terrain materials

ambientCG, CC0. All are 8K/4K PBR with normal + roughness + AO.

| Material | Resolution | Use |
| --- | --- | --- |
| Tropical forest floor | 4K | Ground under canopy |
| Mud / wet soil | 4K | Lake margin, low ground |
| Gravel / crushed stone | 2K | Factory pad, roads |
| Rock (weathered) | 2K | Slopes above treeline |
| Grass / scrub | 2K | Clearings, edges |

Sampled with a **4-layer splat map** driven by slope, height, and a noise mask.
Per-fragment blending, two textures per layer set, one texture fetch per
material — no triplanar, which would triple the cost on a full-screen surface.

**Ambient occlusion is mandatory here.** It was the largest single realism gap
in the previous attempt. The forest floor must be heavily occluded; lit like an
open field, it reads as fake no matter how good the trees are.

Poly Haven rock geometry for the mountains and lake edge: `mountainside` (288k,
LODs), `boulder_01` (124k, LODs), `rock_face_01` (20k).

---

## 4. Canopy shell requirements

**The single highest-leverage item in this document.**

At the opening altitude (620 m), the camera looks *down at the tops* of trees.
Individual trees are ~8 pixels. The correct representation is therefore not
thousands of trees — it is the forest *volume* as a surface.

| Property | Value |
| --- | --- |
| Geometry | 2 displaced shells following the terrain, ~30k tris total |
| Texture | 2K alpha-tested canopy albedo, tiled |
| Silhouette | Billboard cards, ~400, breaking the shell's outline |
| Blend | Depth-aware, front-to-back sorted |
| Distance | 900 m – 3 km |

Result: perceived density becomes nearly free. Currently every additional tree
costs real time; with the shell, the forest is one draw call.

This is also the item most likely to look wrong, so it gets built and evaluated
**first** in the milestone.

---

## 5. HDRI

| Purpose | Source | Resolution |
| --- | --- | --- |
| Environment lighting | Poly Haven HDRI, golden hour, low sun | 2K, prefiltered to roughness mips |
| Sky visible to camera | Existing analytic Preetham sky | — |

**The HDRI replaces the hand-guessed hemisphere fill** from the previous
attempt. That fill was one of the three causes of the stylised look: it lit
everything uniformly, which flattens form. A real environment map gives
directionally-varying fill, so shadowed sides are not all the same brightness.

Pre-filtered to a mip chain at load. One-time cost, no per-frame cost.

---

## 6. Water

No asset. Shader-based, deliberately.

| Aspect | Approach | Reason |
| --- | --- | --- |
| Surface | Fresnel + two scrolling normal maps | Reads as water at these camera angles |
| Depth colour | Beer-Lambert absorption by depth buffer | Cheap approximation of real water |
| Reflection | **No planar reflection.** Fake it: sky colour + fresnel | A reflection pass renders the scene a second time. Unaffordable on Arc |
| Shore | Soft-depth blend against terrain | Hides the geometry seam |

The lake is ~2.5 km across and mostly seen from above, where water is
predominantly sky reflection. So a sky-coloured fresnel is not a compromise
here — it is close to physically correct for this camera.

---

## 7. Smoke

Milestone 7. No asset — procedural particles, but with these requirements,
which the previous smoke system failed:

- Soft-depth intersection fade, so puffs do not hard-clip against geometry
- Lit by the sun direction, not flat grey
- Per-particle rotation, size curve with age, turbulence via curl noise
- Density falloff with altitude
- A separate, much lower-opacity layer for the wide haze plume

---

## 8. Blender work

Blender is a **tool**, not the project. Roughly 15–20 hours of scripted work,
all reproducible via `scripts/blender/`.

| Task | Input | Output |
| --- | --- | --- |
| Decimate + LOD chain | Poly Haven GLBs | LOD0/1/2 GLBs |
| Impostor bake | LOD2 + render | Billboard atlas with baked lighting |
| Author superstructure | New | Chimneys, tanks, conveyor, cooling tower, catwalks, handrails |
| **Texture atlas pack** | 8K sources | 1024² / 2048² atlases per material family |
| **AO bake** | Factory geometry | Vertex-colour AO, so static architecture needs no runtime self-shadowing |
| KTX2 conversion | PNG/TGA/EXR | GPU-compressed textures |
| Normal generation | Height maps | BC5 tangent-space normals |
| Scale normalisation | All assets | Correct metres, +Y up, origin at base |

**AO baked to vertex colour** is the highest-value single bake: it gives the
factory real contact darkening for free at runtime.

**Pipeline tooling (all free, CLI):**
`gltf-transform` for geometry compression and validation, `toktx` from
KTX-Software for texture compression, `blender --background` for scripting.

---

## 9. Repository layout

```
public/
  assets/
    trees/          hero_jacaranda/{lod0,lod1,impostor}.glb
                    hero_emergent/...
                    understory_fern/...
    factory/        facade.glb  pipes.glb  duct.glb  crane.glb
                    superstructure.glb  machinery.glb
    terrain/        rock_mountainside.glb  boulder.glb
    textures/       <name>_{albedo,normal,orm}.ktx2
    hdri/           golden_hour_2k.hdr
    canopy/         canopy_shell.ktx2  impostor_atlas.ktx2
docs/
  ASSETS.md           Per-asset provenance: source, license, name, modifications
  ASSET_PIPELINE.md   This document
scripts/
  blender/            build_lods.py, bake_atlas.py, bake_ao.py
  fetch-assets.ts     Downloads from Poly Haven API, verifies, records
  optimize-assets.ts  gltf-transform + toktx
  check-assets.ts     Fails CI if provenance is undocumented
```

**`public/assets/` is gitignored.** Binary assets go in Git LFS or a release
bucket; provenance is tracked in `docs/ASSETS.md`. This keeps the repo
reviewable.

---

## 10. Optimisation for WebGL

| Stage | Tool | Setting |
| --- | --- | --- |
| Geometry | `gltf-transform` | **Meshopt, not Draco.** Draco compresses harder but its CPU decode hits exactly where we're weakest. Meshopt decodes several times faster for marginally larger files |
| Geometry | `gltf-transform` | Quantize position 14-bit, normal 10-bit, UV 12-bit; weld vertices; drop unused |
| Textures | `toktx` | **BC7** albedo/ORM, **BC5** normals |
| Textures | `toktx` | Hero 2K, mid 1K, far 512, canopy 2K, impostors 1024² atlas |
| ORM packing | Blender | AO → R, roughness → G, metallic → B. Cuts texture count by two thirds |
| Packing | — | **Zero 4K textures.** One 4K costs as much memory as thirty 2K |

**Total memory ceiling: 400 MB.** With 16 GB shared between CPU and GPU, this
is the real constraint — not triangle count.

Loading: priority queue, terrain and canopy shell first (they cover most of the
frame), hero trees and factory next, mid vegetation last. Progressive
population behind a fade, never a visible pop-in.

---

## 11. Unavoidable compromises

Stated plainly, so the quality ceiling is a known quantity rather than a
disappointment later.

1. **The best photoreal tree packs are paid.** Forestation and Terra Scans are
   $30–40 and would roughly halve the work. Unavailable. We are using
   Poly Haven's free trees, which are good but not on that level. This is the
   largest single gap versus the reference.
2. **Photogrammetry-quality industrial assets do not exist free.** The factory
   will be a high-quality modular assembly, not a scan. The reference's
   industrial density will be approximated, not matched.
3. **At 620 m the factory reads as a well-made model.** Real aerial long-lens
   compression is not reproducible with geometry.
4. **Cinematic, not photographic.** On Arc integrated graphics, this is the
   honest ceiling. Anyone promising photo-identical output on this hardware is
   overselling.
5. **Expected 30–50 fps**, with dips during scroll, absorbed by adaptive
   resolution.
6. **No SSR, no TAA, no volumetric light shafts.** All unaffordable here.
7. **Smoke is particles, not true volumetrics.** Convincing, but a cheat.
8. **No water reflection of the factory.** The lake will not show the plant,
   which the reference does.
9. **Textures are the ceiling, not polygons.** We will have spare triangle
   budget and be out of texture memory.

---

## 12. Revised milestones

### Milestone 1 (revised) — asset pipeline + convincing opening frame

1. `gltf-transform` + `KTX2Loader` pipeline, with loading priority and error states
2. **Canopy shell** — highest risk, built and evaluated first
3. Two real tree species with full LOD chains
4. Terrain with splat-mapped PBR textures **and baked AO**
5. HDRI environment lighting replacing the hemisphere fill
6. Shadow rig with correct cascades
7. Keep: quality tiers, adaptive scaling, scroll, camera timeline, validators

**Done when:** the opening frame reads as dense tropical forest with
photographic lighting. No factory yet.

### Milestone 2 — factory

Modular assembly from §2, on the levelled pad, correct scale, weathered
materials, connected pipe runs.

### Milestone 3+ — smoke, pollutants, lake, underwater

Unchanged in intent.

---

## 13. Provenance requirement

Every asset lands in `docs/ASSETS.md` with:

```markdown
| Asset ID | Source URL | License | Original name | Modifications |
|---|---|---|---|---|
| jacaranda_tree | polyhaven.com/a/jacaranda_tree | CC0 1.0 | Jacaranda Tree | LOD chain; 1024² atlas; desaturated |
```

`npm run check:assets` fails if any file in `public/assets/` lacks an entry.
Non-negotiable — it is the only thing standing between "we found it free" and
"we can prove we may ship it."
