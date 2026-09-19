import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WaveField } from '../src/wave.js';
import {
  displacementColor,
  intensityColor,
  IntensityAccumulator,
  paintField,
  WALL_COLOR,
  SOURCE_COLOR,
} from '../src/render.js';

function isRgb(c) {
  return c.length === 3 && c.every((v) => Number.isInteger(v) && v >= 0 && v <= 255);
}

test('displacement colours are valid, clamp, and distinguish crest from trough', () => {
  for (const v of [-5, -1, -0.5, 0, 0.5, 1, 5]) assert.ok(isRgb(displacementColor(v)), `bad colour for ${v}`);
  assert.deepEqual(displacementColor(3), displacementColor(1));
  assert.deepEqual(displacementColor(-3), displacementColor(-1));
  const crest = displacementColor(1);
  const trough = displacementColor(-1);
  assert.ok(crest[0] > trough[0] + 100, 'crest is much redder than trough');
  assert.ok(trough[2] > crest[2], 'trough is bluer than crest');
  // Still water is dark.
  const rest = displacementColor(0);
  assert.ok(rest.every((c) => c < 80));
});

test('crest brightness increases monotonically with displacement', () => {
  let last = -1;
  for (let v = 0; v <= 1; v += 0.05) {
    const [r, g, b] = displacementColor(v);
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    assert.ok(lum >= last, `luminance dipped at ${v}`);
    last = lum;
  }
});

test('intensity colours run dark to bright and clamp', () => {
  const lum = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
  let last = -1;
  for (let t = 0; t <= 1.0001; t += 0.05) {
    const c = intensityColor(t);
    assert.ok(isRgb(c));
    assert.ok(lum(c) >= last - 1e-9, `intensity ramp dipped at ${t}`);
    last = lum(c);
  }
  assert.ok(lum(intensityColor(0)) < 5);
  assert.ok(lum(intensityColor(1)) > 200);
  assert.deepEqual(intensityColor(7), intensityColor(1));
  assert.deepEqual(intensityColor(-2), intensityColor(0));
});

test('the intensity accumulator tracks a running mean of squared displacement', () => {
  const acc = new IntensityAccumulator(3, { rate: 0.5 });
  acc.update(new Float32Array([1, 0, -2]));
  assert.deepEqual(Array.from(acc.values), [0.5, 0, 2]);
  assert.equal(acc.peak, 2);
  acc.update(new Float32Array([1, 0, -2]));
  assert.deepEqual(Array.from(acc.values), [0.75, 0, 3]);
  acc.reset();
  assert.deepEqual(Array.from(acc.values), [0, 0, 0]);
  assert.equal(acc.peak, 0);
});

test('paintField writes opaque pixels, marks walls and sources, and honours the scale', () => {
  const f = new WaveField(8, 6);
  f.setWall(1, 1);
  f.addSource(6, 4);
  f.cur[f.index(3, 3)] = 0.5;
  const rgba = new Uint8ClampedArray(8 * 6 * 4);
  paintField(f, rgba, { scale: 0.5 });
  for (let i = 3; i < rgba.length; i += 4) assert.equal(rgba[i], 255);
  const px = (x, y) => Array.from(rgba.subarray(f.index(x, y) * 4, f.index(x, y) * 4 + 3));
  assert.deepEqual(px(1, 1), WALL_COLOR);
  assert.deepEqual(px(6, 4), SOURCE_COLOR);
  assert.deepEqual(px(3, 3), displacementColor(1), 'scale 0.5 maps u=0.5 to full colour');
  assert.deepEqual(px(0, 0), displacementColor(0));
});

test('intensity mode paints from the accumulator and shallow water is tinted', () => {
  const f = new WaveField(4, 4);
  f.setSpeed(2, 2, 0.5);
  const intensity = new Float32Array(16);
  intensity[f.index(1, 1)] = 2;
  const rgba = new Uint8ClampedArray(64);
  paintField(f, rgba, { mode: 'intensity', scale: 2, intensity });
  const px = (x, y) => Array.from(rgba.subarray(f.index(x, y) * 4, f.index(x, y) * 4 + 3));
  assert.deepEqual(px(1, 1), intensityColor(1));
  assert.deepEqual(px(0, 0), intensityColor(0));
  assert.notDeepEqual(px(2, 2), px(0, 0), 'slow cell is tinted differently from deep water');
  // Without an accumulator, intensity mode falls back to displacement.
  paintField(f, rgba, { mode: 'intensity', scale: 1 });
  assert.deepEqual(px(0, 0), displacementColor(0));
});
