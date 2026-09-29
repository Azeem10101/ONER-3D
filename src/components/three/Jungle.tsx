"use client";

import { useMemo } from "react";
import { Instance, Instances } from "@react-three/drei";
import { range } from "@/scene/random";
import { createRandom } from "@/scene/random";
import { WORLD, terrainHeight, padInfluence } from "@/scene/world";
import type { QualitySettings } from "@/scene/quality";

/**
 * THE JUNGLE
 * ==========
 * Instanced tropical forest, procedurally generated.
 *
 * ## Scale, which is the thing that was wrong before
 *
 * The previous version scattered trees in a ring from 60m to 260m. The terrain
 * is 1400m in radius and the mountains start at 6km, so a 260m forest was a
 * small dark dot in the middle of an enormous empty plain — which read as "no
 * vegetation" rather than as "distant forest".
 *
 * The forest now fills the whole detailed terrain, out to 1350m, and every
 * tree is seated on the real heightfield from `terrainHeight()` — the same
 * function the terrain mesh is built from, so nothing floats or sinks.
 *
 * ## Why still low-poly
 *
 * At the opening altitude a tree is roughly 8 pixels tall. Spending geometry
 * on silhouette detail that cannot be resolved would buy nothing. What reads at
 * that distance is *aggregate* — canopy clumping, height variance, value
 * variance, and the way the canopy shades itself. All of that is scatter
 * logic, not polygon count, so that is where the effort goes.
 *
 * Four species with genuinely different proportions, because a forest of one
 * shape is a plantation.
 */

type Species = {
  name: string;
  /** Trunk + crown proportions. */
  height: [number, number];
  /** Crown radius range, in metres. */
  crown: [number, number];
  /** Fraction of total height that is bare trunk. */
  bareTrunk: [number, number];
  color: string;
  colorB: string;
  weight: number;
  /** Does this species rise above the canopy ceiling? */
  emergent: boolean;
};

const SPECIES: Species[] = [
  {
    // The canopy workhorse. Most of what you see from above.
    name: "broadleaf",
    height: [22, 34],
    crown: [7, 12],
    bareTrunk: [0.42, 0.6],
    color: "#357a26",
    colorB: "#489a30",
    weight: 0.44,
    emergent: false,
  },
  {
    // Emergent: breaks the canopy ceiling. These are what give a real forest
    // its layered silhouette and its sense of vertical depth.
    name: "emergent",
    height: [40, 54],
    crown: [5.5, 9],
    bareTrunk: [0.68, 0.8],
    color: "#4c9430",
    colorB: "#5cae3a",
    weight: 0.1,
    emergent: true,
  },
  {
    name: "palm",
    height: [14, 24],
    crown: [4, 6.5],
    bareTrunk: [0.66, 0.78],
    color: "#4e9e2e",
    colorB: "#63bd38",
    weight: 0.16,
    emergent: false,
  },
  {
    // Understory. Almost invisible from the bird's eye, but it fills the gaps
    // between trunks so the ground does not show through the canopy.
    name: "understory",
    height: [6, 14],
    crown: [2.6, 5],
    bareTrunk: [0.06, 0.2],
    color: "#2f6b1e",
    colorB: "#3f8a26",
    weight: 0.3,
    emergent: false,
  },
];

type Tree = {
  x: number;
  y: number;
  z: number;
  height: number;
  crown: number;
  bareTrunk: number;
  rotation: number;
  lean: number;
  leanAxis: number;
  /** 0..1 blend between the species' two tones. */
  tone: number;
  species: number;
};

function pickSpecies(random: () => number) {
  const roll = random();
  let accumulated = 0;
  for (let i = 0; i < SPECIES.length; i++) {
    accumulated += SPECIES[i].weight;
    if (roll <= accumulated) return i;
  }
  return SPECIES.length - 1;
}

export function Jungle({ quality }: { quality: QualitySettings }) {
  const trees = useMemo<Tree[]>(() => {
    const random = createRandom(20260928);
    const result: Tree[] = [];

    // Emergent species are sparse by nature, so the count is the canopy
    // budget and the weight handles the rest.
    const target = quality.vegetationNearCount + quality.vegetationFarCount;
    const outer = WORLD.terrainRadius * 0.96;

    let guard = 0;
    while (result.length < target && guard < target * 14) {
      guard++;

      const speciesIndex = pickSpecies(random);
      const species = SPECIES[speciesIndex];

      const angle = random() * Math.PI * 2;
      // sqrt for area-uniform distribution. Without it everything clusters
      // toward the origin and the outer ring looks bare — which is exactly
      // the bug the previous version had.
      const distance = 34 + Math.sqrt(random()) * outer;
      const x = Math.cos(angle) * distance;
      const z = Math.sin(angle) * distance;

      // Nothing grows on the industrial pad.
      if (padInfluence(x, z) > 0.015) continue;

      const ground = terrainHeight(x, z);
      // Nothing grows in the lake, and nothing below the waterline.
      if (ground < 1.2) continue;

      // Nothing on a cliff.
      const slope = Math.abs(terrainHeight(x + 7, z) - terrainHeight(x - 7, z)) / 14;
      if (slope > 0.62) continue;

      // Upper elevations are above the treeline in a real range, and the
      // reference frames show bare rock and grass up there. The threshold is
      // relative to the base terrain (see the +18 offset in world.ts), so this
      // is "well above the surrounding jungle" rather than an absolute.
      if (ground > 320) continue;

      // CLUMPING. This is the single biggest contributor to a forest looking
      // like a forest. A uniform scatter is instantly recognisable as
      // procedural, because real forest is patchy — dense stands, gaps, and
      // clearings. Rejecting placements against a low-frequency noise field
      // costs nothing and changes the read completely.
      const density =
        Math.sin(x * 0.0019 + Math.cos(z * 0.0016) * 2.3) * 0.5 +
        Math.cos(z * 0.0013 + Math.sin(x * 0.0021) * 1.8) * 0.5;
      const clump = density * 0.5 + 0.5;
      if (random() > 0.22 + clump * 0.78) continue;

      const height = range(random, species.height[0], species.height[1]);
      // Crown radius correlates with height but not perfectly, or every tree
      // of a given height would look identical.
      const crown = range(random, species.crown[0], species.crown[1]) * (0.85 + height / 260);

      result.push({
        x,
        // Sit the trunk base just under the surface so no gap shows on slopes.
        y: ground - 0.4,
        z,
        height,
        crown,
        bareTrunk: range(random, species.bareTrunk[0], species.bareTrunk[1]),
        rotation: random() * Math.PI * 2,
        lean: range(random, 0, species.emergent ? 0.05 : 0.09),
        leanAxis: random() * Math.PI * 2,
        tone: random(),
        species: speciesIndex,
      });
    }
    return result;
  }, [quality.vegetationNearCount, quality.vegetationFarCount]);

  // Grouped by species so each species is one draw call for trunks and one for
  // canopies, rather than one per tree.
  const bySpecies = useMemo(() => {
    const groups: Tree[][] = SPECIES.map(() => []);
    for (const tree of trees) groups[tree.species].push(tree);
    return groups;
  }, [trees]);

  return (
    <group>
      {SPECIES.map((species, index) => (
        <group key={species.name}>
          {/* Canopy. One merged form per species, instanced. */}
          <Instances limit={bySpecies[index].length} range={bySpecies[index].length} frustumCulled>
            {/* Slightly rounded crown rather than a plain cone — at this scale
                the silhouette is two triangles, but a cone apex reads as a
                spike and a real canopy is domed. */}
            <sphereGeometry args={[1, 7, 5]} />
            <meshStandardMaterial roughness={0.95} metalness={0} />
            {bySpecies[index].map((tree, i) => (
              <Instance
                key={i}
                position={[
                  tree.x,
                  tree.y + tree.height * (1 - tree.bareTrunk * 0.55),
                  tree.z,
                ]}
                scale={[tree.crown, tree.crown * 0.82, tree.crown]}
                rotation={[0, tree.rotation, 0]}
                color={tree.tone > 0.5 ? species.colorB : species.color}
              />
            ))}
          </Instances>

          {/* Trunk. Only worth drawing for species with visible bare trunk;
              at the bird's eye most trunks are hidden by the canopy, and
              dropping them removes half the draw calls. */}
          {species.bareTrunk[1] > 0.3 ? (
            <Instances limit={bySpecies[index].length} range={bySpecies[index].length} frustumCulled>
              <cylinderGeometry args={[0.5, 1, 1, 5]} />
              <meshStandardMaterial roughness={0.98} metalness={0} />
              {bySpecies[index].map((tree, i) => (
                <Instance
                  key={i}
                  position={[tree.x, tree.y + tree.height * tree.bareTrunk * 0.5, tree.z]}
                  scale={[tree.height * 0.021, tree.height * tree.bareTrunk, tree.height * 0.021]}
                  rotation={[0, tree.rotation, 0]}
                  color="#2e2620"
                />
              ))}
            </Instances>
          ) : null}
        </group>
      ))}
    </group>
  );
}
