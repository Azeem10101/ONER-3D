/**
 * SUN AND SKY
 * ===========
 * Physical-ish atmosphere and lighting for a single fixed time of day.
 *
 * ## The approach
 *
 * We use a Preetham/Hosek-style analytic sky (three's Sky shader) rather than
 * a cubemap or gradient texture. This is the decision that does the most for
 * realism, and the reason is that it makes the sky and the fog agree.
 *
 * With an analytic sky we can *sample the same function* the sky dome uses to
 * tint the fog. Aerial perspective in a real photograph is the sky's own
 * colour scattered into the line of sight, so when your fog colour is
 * computed from the sky rather than picked by hand, distant hills recede
 * correctly no matter where the sun is. Hand-picked fog colour is the single
 * most common reason a Three.js scene looks like a demo.
 *
 * ## The time of day
 *
 * Late afternoon, sun low and behind-ish the camera, matching the reference
 * frames: warm key light, long shadows, cool sky fill, haze in the valleys.
 * Sun elevation is around 11 degrees, which is low enough for long shadows
 * and visible god-ray scatter without the sun clipping the horizon.
 *
 * We hard-code this rather than computing a real solar position for a real
 * date and latitude. A "correct" sun that drifts by season would make the
 * art direction unreproducible, and the whole point of the reference look is
 * a specific, repeatable hour. If you ever want a day/night cycle, the sun
 * vector is the only thing that needs to change.
 */

/** Sun direction as a unit vector pointing FROM the origin TOWARD the sun. */
export const SUN_DIRECTION = {
  x: -0.62,
  y: 0.196, // ~11.3 degrees elevation
  z: -0.76,
} as const;

/** Preetham turbidity. Higher = hazier, more orange near the horizon.
 *  2.4 is a clear tropical day with a little atmospheric moisture. */
export const TURBIDITY = 2.4;

/** Rayleigh scattering coefficient. */
export const RAYLEIGH = 1.35;

/** Mie scattering — controls the size and intensity of the sun's halo. */
export const MIE_COEFFICIENT = 0.0042;

/** Mie directional scattering — how tightly the halo hugs the sun. */
export const MIE_DIRECTIONAL_G = 0.82;

/**
 * Sun colour, sampled for a low sun.
 *
 * Hand-derived rather than a constant, because a directional light with
 * `color: 0xffffff` and an intensity near 1.0 is the "default Three.js
 * lighting" look the brief explicitly rules out. Real sunlight at 11 degrees
 * elevation is strongly warm and, critically, *dimmer* than midday — the
 * perceived brightness of a sunset is carried by the black level of the
 * surroundings, not by a bright light source.
 */
export const SUN_COLOR = { r: 1.0, g: 0.78, b: 0.52 } as const;

/** Directional light intensity. Kept moderate; the sky fill does real work. */
export const SUN_INTENSITY = 3.4;

/**
 * Hemisphere fill: sky above, jungle-bounce below.
 *
 * This is what keeps shadowed sides from going black, and it is the second
 * most important lighting decision after the sun colour. A pure ambient light
 * flattens everything; a hemisphere light preserves a vertical gradient, so
 * undersides and canopies still read as separate planes.
 */
export const HEMISPHERE_SKY_COLOR = { r: 0.56, g: 0.74, b: 0.96 } as const;
export const HEMISPHERE_GROUND_COLOR = { r: 0.16, g: 0.22, b: 0.1 } as const;
export const HEMISPHERE_INTENSITY = 1.05;

/**
 * Distance of the directional light from the origin. Must exceed the shadow
 * camera's far plane, or geometry gets clipped out of the shadow map.
 *
 * Was 900m for the previous 1400m world. The world is now 600m across, so 900
 * would park the light outside the shadow volume for most of the frame and
 * waste shadow-map depth range. 420m comfortably covers a 220m shadow camera
 * plus the tallest geometry in the play area.
 */
export const SUN_DISTANCE = 420;

/**
 * Approximate sky colour at the horizon.
 *
 * Only used as the scene background, behind the sky dome. There is no longer a
 * fog colour to tint, since distance fog has been removed — see FOG_DENSITY in
 * Lighting.tsx.
 *
 * Darker and cooler than the value this started at, because with the fog gone
 * this is what shows at the very edge of frame and the old tone was close
 * enough to white to read as a blown highlight.
 */
export const HORIZON_TINT = { r: 0.44, g: 0.49, b: 0.53 } as const;
