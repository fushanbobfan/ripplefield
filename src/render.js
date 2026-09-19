// Turns a WaveField into pixels. Pure functions operate on typed arrays so the
// colour mapping can be tested without a canvas; paintField() writes straight
// into an ImageData buffer at one pixel per cell, and the page scales it up.

/** Clamp x into [0, 1]. */
function unit(x) {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/**
 * Diverging colour ramp for displacement: troughs deep blue, still water a
 * dark slate, crests warm off-white. Input is normalised displacement in [-1, 1].
 * Returns [r, g, b] in 0..255.
 */
export function displacementColor(v) {
  const t = unit(Math.abs(v));
  if (v >= 0) {
    // slate -> amber -> warm off-white
    return [
      Math.round(30 + 225 * t),
      Math.round(41 + 150 * t + 49 * t * t),
      Math.round(59 + 60 * t + 81 * t * t),
    ];
  }
  // slate -> blue -> cyan-white
  return [
    Math.round(30 - 20 * t + 90 * t * t),
    Math.round(41 + 80 * t + 100 * t * t),
    Math.round(59 + 196 * t),
  ];
}

/**
 * Sequential ramp for time-averaged intensity in [0, 1]:
 * near-black through violet and orange to pale yellow.
 */
export function intensityColor(t) {
  t = unit(t);
  const r = 255 * Math.pow(t, 0.55);
  const g = 245 * Math.pow(t, 1.6);
  const b = 200 * Math.pow(Math.max(0, Math.sin(Math.PI * t * 0.85)), 1.2) * (1 - t) + 40 * t;
  return [Math.round(r), Math.round(g), Math.round(b)];
}

export const WALL_COLOR = [214, 200, 178];
export const SOURCE_COLOR = [255, 80, 80];

/**
 * Exponential running average of squared displacement, i.e. the intensity a
 * long-exposure photograph of the tank would record.
 */
export class IntensityAccumulator {
  constructor(size, { rate = 0.02 } = {}) {
    this.values = new Float32Array(size);
    this.rate = rate;
    this.peak = 0;
  }

  reset() {
    this.values.fill(0);
    this.peak = 0;
  }

  /**
   * A robust brightness reference: the given percentile of the accumulated
   * intensity, estimated from a strided sample so it is cheap enough to call
   * every frame. The single brightest cell (usually a source) would otherwise
   * dominate the normalisation and leave the rest of the tank black.
   */
  reference(percentile = 0.98, stride = 7) {
    const sample = [];
    for (let i = 0; i < this.values.length; i += stride) sample.push(this.values[i]);
    sample.sort((a, b) => a - b);
    const k = Math.min(sample.length - 1, Math.floor(percentile * sample.length));
    return sample[k] ?? 0;
  }

  /** Fold one displacement snapshot in and return the running peak intensity. */
  update(u) {
    const { values, rate } = this;
    let peak = 0;
    for (let i = 0; i < values.length; i++) {
      const v = values[i] + rate * (u[i] * u[i] - values[i]);
      values[i] = v;
      if (v > peak) peak = v;
    }
    this.peak = peak;
    return peak;
  }
}

// Colour lookup tables so the per-pixel loop does no float maths on colours.
// Displacement is quantised to 511 levels over [-1, 1], intensity to 256.
const LUT_HALF = 255;
const displacementLut = new Uint8ClampedArray((2 * LUT_HALF + 1) * 3);
const intensityLut = new Uint8ClampedArray(256 * 3);
for (let i = 0; i <= 2 * LUT_HALF; i++) {
  const [r, g, b] = displacementColor((i - LUT_HALF) / LUT_HALF);
  displacementLut[i * 3] = r;
  displacementLut[i * 3 + 1] = g;
  displacementLut[i * 3 + 2] = b;
}
for (let i = 0; i < 256; i++) {
  const [r, g, b] = intensityColor(i / 255);
  intensityLut[i * 3] = r;
  intensityLut[i * 3 + 1] = g;
  intensityLut[i * 3 + 2] = b;
}

/**
 * Shade the medium: walls are drawn solid, shallow (slow) water is tinted so
 * lenses and steps are visible even when the surface is flat.
 */
function mediumTint(speed) {
  // speed 1 -> no tint; speed 0.5 -> noticeable teal shift.
  return (1 - speed) * 0.9;
}

/**
 * Write the field into an RGBA buffer (Uint8ClampedArray, width*height*4).
 * mode is 'displacement' or 'intensity'; scale normalises the values so that
 * |u| = scale maps to full colour (displacement) or intensity = scale maps to
 * full brightness. Intensity is shown on a square-root scale, i.e. as an
 * amplitude, which keeps faint fringes visible next to bright ones.
 */
export function paintField(field, rgba, { mode = 'displacement', scale = 1, intensity = null } = {}) {
  const { width, height, cur, wall, speed } = field;
  const inv = scale > 0 ? 1 / scale : 1;
  const useIntensity = mode === 'intensity' && intensity;
  const [wr, wg, wb] = WALL_COLOR;
  let p = 0;
  for (let i = 0; i < width * height; i++) {
    let r;
    let g;
    let b;
    if (wall[i]) {
      r = wr;
      g = wg;
      b = wb;
    } else {
      let k;
      let lut;
      if (useIntensity) {
        let v = Math.sqrt(intensity[i] * inv);
        if (v > 1) v = 1;
        k = Math.round(v * 255) * 3;
        lut = intensityLut;
      } else {
        let v = cur[i] * inv;
        if (v > 1) v = 1;
        else if (v < -1) v = -1;
        k = (Math.round(v * LUT_HALF) + LUT_HALF) * 3;
        lut = displacementLut;
      }
      r = lut[k];
      g = lut[k + 1];
      b = lut[k + 2];
      const sp = speed[i];
      if (sp < 1) {
        const tint = mediumTint(sp);
        r = Math.round(r * (1 - 0.35 * tint));
        g = Math.round(g * (1 - 0.05 * tint) + 30 * tint);
        b = Math.round(b * (1 - 0.1 * tint) + 20 * tint);
      }
    }
    rgba[p++] = r;
    rgba[p++] = g;
    rgba[p++] = b;
    rgba[p++] = 255;
  }
  for (const src of field.sources) {
    if (!src.enabled) continue;
    const i = field.index(src.x, src.y) * 4;
    rgba[i] = SOURCE_COLOR[0];
    rgba[i + 1] = SOURCE_COLOR[1];
    rgba[i + 2] = SOURCE_COLOR[2];
  }
  return rgba;
}
