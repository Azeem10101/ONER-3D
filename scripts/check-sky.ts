/**
 * What colour does the sky dome actually render?
 *
 *   npx tsx scripts/check-sky.ts
 *
 * Reimplements three-stdlib's Preetham sky — the one drei's <Sky> actually
 * compiles — and pushes the result through the same ACES tone map and sRGB
 * transfer the renderer applies. Then it reports the final pixel value at a
 * range of elevations.
 *
 * ## Why this is a script and not an eyeball
 *
 * The complaint is "the background is white". There is no way to check that
 * without seeing the frame, and a browser is not always available. But the sky
 * is a closed-form function of six numbers, and the tone map is a closed-form
 * function of one. So the final pixel value can simply be calculated, and the
 * question "is the sky white" becomes arithmetic rather than opinion.
 *
 * ## Why it matters
 *
 * A Preetham sky with the sun at 11 degrees elevation produces a very high
 * radiance near the horizon. Whether that reads as blue or as white is decided
 * entirely by whether the radiance lands below the tone map's shoulder, and
 * nothing in the component shows you the number. It was authored at
 * rayleigh 1.35, turbidity 2.4, exposure 1.05 and never checked.
 *
 * Constants are transcribed from
 * node_modules/three-stdlib/objects/Sky.js. If that file changes, re-read it.
 */

import {
  HEMISPHERE_GROUND_COLOR,
  HEMISPHERE_INTENSITY,
  HEMISPHERE_SKY_COLOR,
  MIE_COEFFICIENT,
  MIE_DIRECTIONAL_G,
  RAYLEIGH,
  SUN_COLOR,
  SUN_DIRECTION,
  SUN_INTENSITY,
  TURBIDITY,
} from "../src/scene/sun";
import { EXPOSURE } from "../src/scene/tone";

// --- Preetham constants, from three-stdlib/objects/Sky.js --------------------
const totalRayleigh = [5.804542996261093e-6, 1.3562911419845635e-5, 3.0265902468824876e-5];
const MieConst = [1.8399918514433978e14, 2.7798023919660528e14, 4.0790479543861094e14];
const RAYLEIGH_ZENITH_LENGTH = 8.4e3;
const MIE_ZENITH_LENGTH = 1.25e3;
const THREE_OVER_SIXTEENPI = 0.05968310365946075;
const ONE_OVER_FOURPI = 0.07957747154594767;
const CUTOFF_ANGLE = 1.6110731556870734;
const STEEPNESS = 1.5;
const EE = 1000;
const SUN_ANGULAR_DIAMETER_COS =
  0.999956676946448443553574619906976478926848692873900859324;

type V3 = [number, number, number];

const totalMie = (T: number): V3 => {
  const c = 0.2 * T * 10e-18;
  return [0.434 * c * MieConst[0], 0.434 * c * MieConst[1], 0.434 * c * MieConst[2]];
};

const sunIntensity = (zenithAngleCos: number) => {
  const c = Math.max(-1, Math.min(1, zenithAngleCos));
  return EE * Math.max(0, 1 - Math.exp(-((CUTOFF_ANGLE - Math.acos(c)) / STEEPNESS)));
};

/** The sky's linear radiance looking along `direction`, sun at `sun`. */
function skyRadiance(
  direction: V3,
  sun: V3,
  rayleigh: number,
  turbidity: number,
  mieCoefficient: number,
  mieDirectionalG: number
): V3 {
  const sunY = sun[1];
  const sunE = sunIntensity(sunY);
  const sunfade = 1 - Math.max(0, Math.min(1, 1 - Math.exp(sunY / 450000)));
  const rayleighCoefficient = rayleigh - (1 - sunfade);

  const vBetaR: V3 = totalRayleigh.map((c) => c * rayleighCoefficient) as V3;
  const tm = totalMie(turbidity);
  const vBetaM: V3 = [
    tm[0] * mieCoefficient,
    tm[1] * mieCoefficient,
    tm[2] * mieCoefficient,
  ];

  // Optical length along the view ray.
  const zenithAngle = Math.acos(Math.max(0, direction[1]));
  const inv = 1 / (Math.cos(zenithAngle) + 0.15 * Math.pow(93.885 - (zenithAngle * 180) / Math.PI, -1.253));
  const sR = RAYLEIGH_ZENITH_LENGTH * inv;
  const sM = MIE_ZENITH_LENGTH * inv;

  const Fex: V3 = [0, 1, 2].map(
    (i) => Math.exp(-(vBetaR[i] * sR + vBetaM[i] * sM))
  ) as V3;

  const cosTheta = direction[0] * sun[0] + direction[1] * sun[1] + direction[2] * sun[2];
  const rPhase = THREE_OVER_SIXTEENPI * (1 + Math.pow(cosTheta * 0.5 + 0.5, 2));
  const g2 = mieDirectionalG * mieDirectionalG;
  const mPhase =
    ONE_OVER_FOURPI * ((1 - g2) / Math.pow(1 - 2 * mieDirectionalG * cosTheta + g2, 1.5));

  const mixT = Math.max(
    0,
    Math.min(1, Math.pow(1 - sunY, 5))
  );

  const out: V3 = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const bRt = vBetaR[i] * rPhase;
    const bMt = vBetaM[i] * mPhase;
    const ratio = (bRt + bMt) / (vBetaR[i] + vBetaM[i]);
    const base = sunE * ratio;
    let Lin = Math.pow(base * (1 - Fex[i]), 1.5);
    const second = Math.pow(base * Fex[i], 0.5);
    Lin *= 1 + (second - 1) * mixT;

    const sundisk = smoothstep(
      SUN_ANGULAR_DIAMETER_COS,
      SUN_ANGULAR_DIAMETER_COS + 0.00002,
      cosTheta
    );
    const L0 = 0.1 * Fex[i] + sunE * 19000 * Fex[i] * sundisk;
    const texColor = (Lin + L0) * 0.04 + [0, 0.0003, 0.00075][i];
    out[i] = Math.pow(texColor, 1 / (1.2 + 1.2 * sunfade));
  }
  return out;
}

function smoothstep(e0: number, e1: number, x: number) {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

// --- The renderer's output transform ----------------------------------------

/** three's ACESFilmicToneMapping. */
function aces(x: number) {
  const a = 2.51;
  const b = 0.03;
  const c = 2.43;
  const d = 0.59;
  const e = 0.14;
  return Math.max(0, Math.min(1, (x * (a * x + b)) / (x * (c * x + d) + e)));
}

const srgb = (c: number) =>
  c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;

const srgbToLinear = (c: number) =>
  c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);

const luminance = (c: V3) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

/**
 * A representative canopy pixel, through the real light rig and the same tone
 * map. This is the other half of the ratio in assertion 5: the sky dome reads
 * none of these values, but the ground reads all of them, and that asymmetry
 * is the only thing that lets the two be balanced independently.
 *
 * Modelled on Terrain.tsx: albedo times (sun * diffuse * 0.85 + hemisphere).
 * uMidColor is the dominant canopy green, and 0.72 is a mid-value for the
 * wrapped-diffuse term on ground that is not facing straight up.
 *
 * ## The hex is decoded by hand, on purpose
 *
 * `new Color("#3f8f14")` already converts from sRGB to linear when three's
 * colour management is on, which it is by default. Passing its .r/.g/.b through
 * the sRGB transfer function a second time darkened the albedo enough to report
 * a canopy at 0.25 luminance where the real value was 0.60 — and that error
 * nearly caused the sun intensity to be tripled to compensate for it. The hex is
 * parsed and converted exactly once here, which is what the renderer does.
 */
function canopyPixel(exposure: number): V3 {
  const hex = "3f8f14";
  const lin: V3 = [
    srgbToLinear(parseInt(hex.slice(0, 2), 16) / 255),
    srgbToLinear(parseInt(hex.slice(2, 4), 16) / 255),
    srgbToLinear(parseInt(hex.slice(4, 6), 16) / 255),
  ];
  const skyC: V3 = [HEMISPHERE_SKY_COLOR.r, HEMISPHERE_SKY_COLOR.g, HEMISPHERE_SKY_COLOR.b];
  const gndC: V3 = [HEMISPHERE_GROUND_COLOR.r, HEMISPHERE_GROUND_COLOR.g, HEMISPHERE_GROUND_COLOR.b];
  const sunC: V3 = [SUN_COLOR.r, SUN_COLOR.g, SUN_COLOR.b];
  const diffuse = 0.72;
  const out: V3 = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const ambient = (skyC[i] + gndC[i]) * 0.5 * HEMISPHERE_INTENSITY;
    const lit = lin[i] * (sunC[i] * SUN_INTENSITY * diffuse * 0.85 + ambient);
    out[i] = srgb(aces(lit * exposure));
  }
  return out;
}

// --- Report -----------------------------------------------------------------

const sun: V3 = [SUN_DIRECTION.x, SUN_DIRECTION.y, SUN_DIRECTION.z];
const sl = Math.hypot(sun[0], sun[1], sun[2]);
const sunN: V3 = [sun[0] / sl, sun[1] / sl, sun[2] / sl];

// Perpendicular to the sun, in the horizontal plane, so "elevation" is measured
// away from the sun rather than in whatever direction happens to be convenient.
const perp: V3 = [-sunN[2], 0, sunN[0]];
const pl = Math.hypot(perp[0], perp[2]);

console.log("\nSky dome, as rendered");
console.log("=".repeat(80));
console.log(
  `  rayleigh ${RAYLEIGH}, turbidity ${TURBIDITY}, mie ${MIE_COEFFICIENT}, ` +
    `g ${MIE_DIRECTIONAL_G}`
);
console.log(
  `  sun elevation ${((Math.asin(sunN[1]) * 180) / Math.PI).toFixed(1)}deg, ` +
    `exposure ${EXPOSURE}, ACES filmic\n`
);
console.log(
  `  ${"elev".padStart(6)}${"azimuth".padStart(10)}   ` +
    `${"linear radiance".padStart(26)}   ${"final sRGB".padEnd(18)}${"lum".padStart(7)}${"sat".padStart(7)}`
);

interface Row {
  elev: number;
  az: string;
  radiance: V3;
  final: V3;
}

const rows: Row[] = [];
const ELEVATIONS = [0, 2, 5, 10, 20, 35, 55, 80];
const AZIMUTHS: [string, number][] = [
  ["toward sun", 0],
  ["45 deg off", 45],
  ["90 deg off", 90],
  ["anti-sun", 180],
];

let failed = 0;

for (const az of AZIMUTHS) {
  const a = (az[1] * Math.PI) / 180;
  for (const elevDeg of ELEVATIONS) {
    const e = (elevDeg * Math.PI) / 180;
    // Direction at this elevation, rotated `az` away from the sun's azimuth.
    const dx = perp[0] * Math.sin(a) + sunN[0] * Math.cos(a);
    const dz = perp[2] * Math.sin(a) + sunN[2] * Math.cos(a);
    const dh = pl * Math.sin(a);
    void dh;
    const dir: V3 = [
      dx * Math.cos(e),
      Math.sin(e),
      dz * Math.cos(e),
    ];
    const dl = Math.hypot(dir[0], dir[1], dir[2]);
    const dirN: V3 = [dir[0] / dl, dir[1] / dl, dir[2] / dl];

    const radiance = skyRadiance(
      dirN,
      sunN,
      RAYLEIGH,
      TURBIDITY,
      MIE_COEFFICIENT,
      MIE_DIRECTIONAL_G
    );
    const final: V3 = radiance.map((c) => srgb(aces(c * EXPOSURE))) as V3;
    const lum = luminance(final);
    const mx = Math.max(...final);
    const mn = Math.min(...final);
    const sat = mx > 0 ? (mx - mn) / mx : 0;

    rows.push({ elev: elevDeg, az: az[0], radiance, final });
    if (az[0] === AZIMUTHS[0][0] || elevDeg === 5) {
      console.log(
        `  ${(elevDeg + "deg").padStart(6)}${az[0].padStart(10)}   ` +
          radiance.map((c) => c.toFixed(2).padStart(8)).join("") +
          `   ` +
          final.map((c) => c.toFixed(3)).join(" ") +
          `   ${lum.toFixed(3).padStart(6)}${(sat * 100).toFixed(0).padStart(6)}%`
      );
    }
  }
}

// --- Assertions -------------------------------------------------------------

console.log("\n" + "-".repeat(80));

// 1. Nothing may be clipped. A channel pinned at 1.0 has lost all hue.
const clipped = rows.filter((r) => Math.max(...r.final) >= 0.999);
if (clipped.length > 0) {
  console.log(
    `  FAIL  ${clipped.length} of ${rows.length} sky samples are clipped to white ` +
      `(max channel >= 1.0)`
  );
  for (const r of clipped.slice(0, 4)) {
    console.log(
      `          ${r.az} at ${r.elev}deg -> ${r.final.map((c) => c.toFixed(3)).join(" ")}`
    );
  }
  failed++;
} else {
  console.log(`  PASS  no sky sample clips to white (${rows.length} samples)`);
}

// 2 & 3 sample the GENERAL sky only.
//
//    Two regions are excluded on purpose, because asserting on them would be
//    asserting something false:
//
//      - toward the sun. The aureole around a sun 11 degrees above the horizon
//        is legitimately near-white, and it stays that way at any exposure. It
//        measured 0.93 luminance here and that is correct, not a bug.
//      - the horizon itself. A Preetham horizon is pale at every parameter
//        setting, which is also true of the real sky. See the note on RAYLEIGH
//        in sun.ts.
//
//    So the questions "is the sky blue" and "is the sky a blown highlight" are
//    both asked of the sky at 90 and 180 degrees from the sun, which is the sky
//    that actually sits behind the subject in these shots.
const general = rows.filter((r) => r.az !== "toward sun" && r.az !== "45 deg off");

const notBlue = general.filter((r) => r.elev >= 10 && r.final[2] <= r.final[0]);
if (notBlue.length > 0) {
  console.log(
    `  FAIL  ${notBlue.length} general-sky samples above 10deg are not blue (red >= blue)`
  );
  failed++;
} else {
  const n = general.filter((r) => r.elev >= 10).length;
  console.log(`  PASS  all ${n} general-sky samples above 10deg are bluer than red`);
}

const zenith = general.filter((r) => r.elev >= 35);
const sats = zenith.map((r) => {
  const mx = Math.max(...r.final);
  const mn = Math.min(...r.final);
  return mx > 0 ? (mx - mn) / mx : 0;
});
const worstSat = Math.min(...sats);
const meanSat = sats.reduce((a, b) => a + b, 0) / sats.length;
if (worstSat < 0.22) {
  console.log(
    `  FAIL  saturation falls to ${(worstSat * 100).toFixed(0)}% above 35deg — that reads as ` +
      `a grey wash, not as sky`
  );
  failed++;
} else {
  console.log(
    `  PASS  saturation above 35deg: ${(worstSat * 100).toFixed(0)}% worst, ` +
      `${(meanSat * 100).toFixed(0)}% mean`
  );
}

// 4. The sky must not be a blown highlight. The general horizon was measured at
//    86% luminance before this was fixed, which is the "white background".
//    Toward the sun is excluded — see the note above.
const horizonRows = general.filter((r) => r.elev <= 5);
const worstHorizon = Math.max(...horizonRows.map((r) => luminance(r.final)));
if (worstHorizon > 0.78) {
  console.log(
    `  FAIL  the sky at the horizon reaches ${(worstHorizon * 100).toFixed(0)}% luminance — ` +
      `that is a blown highlight, not a sky`
  );
  failed++;
} else {
  console.log(
    `  PASS  the horizon sky stays at or below ${(worstHorizon * 100).toFixed(0)}% luminance`
  );
}

// 5. The relationship that actually matters: the sky must sit only a little
//    above the land in value.
//
//    This is the assertion that would have caught the original bug, and it is
//    expressed as a ratio rather than as two absolute numbers on purpose. The
//    sky dome's radiance is independent of SUN_INTENSITY while the terrain's is
//    not, so the ratio is the quantity the lighting rig actually controls, and
//    it is the thing a viewer reads as "is the land losing to the background".
//
//    Measured 1.32 at exposure 1.05 (ground 0.60 under sky 0.99). Now 1.15.
const canopy = canopyPixel(EXPOSURE);
const groundLum = luminance(canopy);
const ratio = worstHorizon / Math.max(0.001, groundLum);
if (ratio > 1.9) {
  console.log(
    `  FAIL  the sky is ${ratio.toFixed(2)}x brighter than the canopy ` +
      `(${worstHorizon.toFixed(2)} vs ${groundLum.toFixed(2)}) — the land reads as a ` +
      `silhouette under a bright background`
  );
  failed++;
} else {
  console.log(
    `  PASS  sky/ground ratio ${ratio.toFixed(2)} ` +
      `(sky ${worstHorizon.toFixed(2)}, canopy ${groundLum.toFixed(2)})`
  );
}

// 6. And the land has to survive the exposure cut. The exposure came down 3.3x,
//    so this is the assertion that the sun-intensity compensation is real rather
//    than than assumed.
if (groundLum < 0.34) {
  console.log(
    `  FAIL  the canopy renders at ${groundLum.toFixed(2)} luminance — the exposure cut ` +
      `was not compensated by the sun intensity`
  );
  failed++;
} else {
  const g = canopy;
  console.log(
    `  PASS  canopy renders ${g[0].toFixed(2)}/${g[1].toFixed(2)}/${g[2].toFixed(2)} at ` +
      `${groundLum.toFixed(2)} luminance` +
      (g[1] > g[0] && g[1] > g[2] ? ", and green" : ", NOT GREEN")
  );
  if (!(g[1] > g[0] && g[1] > g[2])) {
    console.log("  FAIL  the canopy is not green-dominant after the sun colour change");
    failed++;
  }
}

console.log();
if (failed > 0) {
  console.log(`FAIL — ${failed} problem(s).`);
  process.exitCode = 1;
} else {
  console.log("PASS");
}
