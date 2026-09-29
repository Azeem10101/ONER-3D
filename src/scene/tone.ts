/**
 * OUTPUT TRANSFORM
 * ================
 * The two numbers that decide what the renderer actually puts on screen.
 *
 * These live here rather than inline in <Canvas> because they are not really
 * React's business, and more usefully because they can then be READ by
 * check-sky.ts, which reimplements the sky dome in order to calculate its final
 * pixel value. That check is the only thing standing between a plausible-looking
 * set of numbers and a white background: the sky's radiance is decided entirely
 * by where it lands relative to the tone map's shoulder, and nothing in the
 * component tree shows you that number.
 *
 * See scripts/check-sky.ts for the arithmetic and the constants.
 */

/**
 * Tone-mapping exposure.
 *
 * Applied to the linear radiance BEFORE the ACES curve, so it scales the input
 * to the curve rather than brightening the result.
 *
 * ## Why this is 0.32 and not 1.05
 *
 * Measured with check-sky.ts, which reimplements the sky dome and pushes it
 * through this exact transform. At exposure 1.05 the sky at 5 degrees elevation
 * rendered at 0.987/0.985/0.975 sRGB — 98.5% luminance, 1% saturation. That is
 * white, and it is the "white background" behind everything.
 *
 * Two sweeps established that the atmosphere parameters cannot fix it:
 *
 *   - Rayleigh above 1.35 makes the horizon LESS saturated, not more
 *     (7% at 1.35, 1% at 3.8). Counter-intuitive, and it is the extinction path
 *     length doing it, not the scattering.
 *   - Sun elevation barely moves it either: 7% saturation at 11 degrees and 7%
 *     at 30.
 *
 * A Preetham horizon is pale at every setting, which is also true of the real
 * sky, so chasing hue there is the wrong goal. The problem was never hue, it was
 * VALUE: at 1.05 the horizon sat at 0.99 against ground at 0.60, so the land
 * was a dark silhouette under a blown sky.
 *
 * ## Why this pairs with SUN_INTENSITY
 *
 * The sky dome's radiance is a pure function of the atmosphere uniforms — it
 * does not read the directional light at all. So the two can be moved
 * independently, and that is the only lever available:
 *
 *     lower EXPOSURE        -> sky and ground both down
 *     raise SUN_INTENSITY   -> ground up, sky untouched
 *
 * At 0.32 with the sun at 6.4 the horizon lands at 0.66 luminance against
 * ground at 0.59, a ratio of 1.15. Before, that ratio was 1.32 with both
 * numbers far too high. The sky is now a daylight blue sitting just above the
 * land in value, which is how a horizon is supposed to read.
 */
export const EXPOSURE = 0.32;
