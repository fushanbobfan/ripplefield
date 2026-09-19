import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WaveField, MAX_COURANT } from '../src/wave.js';

test('rejects grids that are too small and unstable Courant numbers', () => {
  assert.throws(() => new WaveField(2, 5), RangeError);
  assert.throws(() => new WaveField(10, 10, { courant: 0.8 }), RangeError);
  assert.ok(MAX_COURANT < 1 / Math.SQRT2);
});

test('a still field stays still', () => {
  const f = new WaveField(20, 20);
  for (let i = 0; i < 50; i++) f.step();
  assert.equal(f.energy(), 0);
  assert.equal(f.time, 50);
});

test('a poke spreads outward symmetrically', () => {
  const f = new WaveField(41, 41);
  f.poke(20, 20, 1);
  for (let i = 0; i < 10; i++) f.step();
  const u = f.cur;
  const at = (x, y) => u[f.index(x, y)];
  // Four-fold symmetry of the stencil about the centre.
  assert.ok(Math.abs(at(20 + 5, 20) - at(20 - 5, 20)) < 1e-6);
  assert.ok(Math.abs(at(20, 20 + 5) - at(20, 20 - 5)) < 1e-6);
  assert.ok(Math.abs(at(20 + 5, 20) - at(20, 20 + 5)) < 1e-6);
  // The disturbance has reached cells away from the origin.
  assert.ok(Math.abs(at(20 + 4, 20)) > 1e-4);
  // It has not travelled faster than one cell per step.
  assert.equal(at(20 + 11, 20), 0);
  assert.equal(at(20, 20 - 11), 0);
});

test('the scheme is stable at the maximum Courant number', () => {
  const f = new WaveField(30, 30, { courant: MAX_COURANT });
  f.poke(15, 15, 1);
  for (let i = 0; i < 2000; i++) f.step();
  assert.ok(Number.isFinite(f.energy()));
  assert.ok(f.peak() < 10, `peak ${f.peak()} blew up`);
});

test('damping removes energy over time', () => {
  const lossy = new WaveField(30, 30, { damping: 0.05 });
  const lossless = new WaveField(30, 30, { damping: 0 });
  lossy.poke(15, 15, 1);
  lossless.poke(15, 15, 1);
  for (let i = 0; i < 40; i++) {
    lossy.step();
    lossless.step();
  }
  assert.ok(lossy.energy() < lossless.energy() * 0.5);
});

test('walls block propagation and hold zero displacement', () => {
  const f = new WaveField(41, 21);
  f.fillWall(20, 0, 20, 20);
  f.poke(10, 10, 1);
  for (let i = 0; i < 60; i++) f.step();
  const u = f.cur;
  let right = 0;
  for (let y = 0; y < 21; y++) {
    for (let x = 21; x < 41; x++) right += Math.abs(u[f.index(x, y)]);
  }
  assert.equal(right, 0, 'nothing leaked past the wall');
  for (let y = 0; y < 21; y++) assert.equal(u[f.index(20, y)], 0);
  // The left side still carries the (reflected) wave.
  let left = 0;
  for (let y = 0; y < 21; y++) {
    for (let x = 0; x < 20; x++) left += Math.abs(u[f.index(x, y)]);
  }
  assert.ok(left > 0);
});

test('removing a wall lets waves through again', () => {
  const f = new WaveField(21, 21);
  f.setWall(10, 10);
  assert.equal(f.wall[f.index(10, 10)], 1);
  f.setWall(10, 10, false);
  assert.equal(f.wall[f.index(10, 10)], 0);
  f.fillWall(0, 0, 20, 20);
  f.clearMedium();
  assert.equal(f.wall.reduce((a, b) => a + b, 0), 0);
});

test('a slower medium delays the wavefront', () => {
  const fast = new WaveField(61, 11);
  const slow = new WaveField(61, 11);
  slow.fillSpeed(20, 0, 60, 10, 0.5);
  fast.poke(5, 5, 1);
  slow.poke(5, 5, 1);
  const arrival = (f) => {
    for (let t = 0; t < 200; t++) {
      f.step();
      if (Math.abs(f.cur[f.index(50, 5)]) > 1e-3) return t;
    }
    return Infinity;
  };
  const tFast = arrival(fast);
  const tSlow = arrival(slow);
  assert.ok(Number.isFinite(tFast));
  assert.ok(tSlow > tFast * 1.3, `slow ${tSlow} vs fast ${tFast}`);
});

test('fillSpeedDisc clamps values and only touches the disc', () => {
  const f = new WaveField(31, 31);
  f.fillSpeedDisc(15, 15, 5, 2);
  assert.equal(f.speed[f.index(15, 15)], 1);
  f.fillSpeedDisc(15, 15, 5, 0.4);
  assert.ok(Math.abs(f.speed[f.index(15, 15)] - 0.4) < 1e-6);
  assert.ok(Math.abs(f.speed[f.index(15, 19)] - 0.4) < 1e-6);
  assert.equal(f.speed[f.index(15, 21)], 1);
  assert.equal(f.speed[f.index(0, 0)], 1);
});

test('an oscillating source keeps injecting energy', () => {
  const f = new WaveField(41, 41, { damping: 0.01 });
  const s = f.addSource(20, 20, { frequency: 0.05, amplitude: 1 });
  for (let i = 0; i < 100; i++) f.step();
  const e1 = f.energy();
  assert.ok(e1 > 0);
  s.enabled = false;
  for (let i = 0; i < 300; i++) f.step();
  assert.ok(f.energy() < e1 * 0.2, 'energy decays once the source is off');
  assert.throws(() => f.addSource(100, 100), RangeError);
});

test('a source at a fractional position is split between neighbouring cells', () => {
  const f = new WaveField(21, 21);
  f.addSource(10.5, 10, { frequency: 0.25, amplitude: 1 }); // sin(pi/2) = 1 on step 1
  f.step();
  const a = f.cur[f.index(10, 10)];
  const b = f.cur[f.index(11, 10)];
  assert.ok(Math.abs(a - 0.5) < 1e-6 && Math.abs(b - 0.5) < 1e-6, `${a} ${b}`);
  assert.equal(f.cur[f.index(10, 11)], 0);
});

test('a drifting source moves each step and bounces off the border', () => {
  const f = new WaveField(41, 21);
  const s = f.addSource(35, 10, { vx: 1, vy: 0 });
  f.step();
  assert.equal(s.x, 36);
  for (let i = 0; i < 100; i++) {
    f.step();
    assert.ok(s.x >= 1 && s.x <= 39, `source left the tank at x=${s.x}`);
    assert.equal(s.y, 10);
  }
  assert.ok(s.vx < 0 || s.x < 35, 'the source turned around');
  const t = f.addSource(20, 2, { vx: 0, vy: -0.5 });
  for (let i = 0; i < 10; i++) f.step();
  assert.ok(t.y >= 1);
  assert.ok(t.vy > 0);
});

test('a drifting source reflects off walls', () => {
  const f = new WaveField(41, 21);
  f.fillWall(30, 0, 31, 20);
  const s = f.addSource(20, 10, { vx: 1 });
  for (let i = 0; i < 15; i++) {
    f.step();
    assert.ok(s.x < 30, `source entered the wall at x=${s.x}`);
  }
  assert.ok(s.vx < 0 && s.x < 29, `source did not turn back: x=${s.x} vx=${s.vx}`);
  // A still source is left alone.
  const r = f.addSource(5, 5);
  f.step();
  assert.equal(r.x, 5);
  assert.equal(r.y, 5);
});

// Count sign changes of the displacement along a row segment.
function zeroCrossings(field, y, x0, x1) {
  let n = 0;
  let last = 0;
  for (let x = x0; x <= x1; x++) {
    const v = field.cur[field.index(x, y)];
    if (v !== 0 && last !== 0 && Math.sign(v) !== Math.sign(last)) n++;
    if (v !== 0) last = v;
  }
  return n;
}

test('a moving source shows a Doppler shift: shorter waves ahead, longer behind', () => {
  const f = new WaveField(321, 61, { spongeWidth: 16 });
  const s = f.addSource(60, 30, { frequency: 0.05, vx: 0.3 });
  for (let t = 0; t < 200; t++) f.step();
  const x = Math.round(s.x);
  assert.ok(Math.abs(x - 120) <= 1);
  const ahead = zeroCrossings(f, 30, x + 10, x + 70);
  const behind = zeroCrossings(f, 30, x - 70, x - 10);
  assert.ok(ahead > behind * 1.8, `ahead ${ahead} vs behind ${behind}`);
});

test('sources can be removed and cleared', () => {
  const f = new WaveField(11, 11);
  const a = f.addSource(3, 3);
  const b = f.addSource(5, 5);
  f.removeSource(a);
  assert.deepEqual(f.sources, [b]);
  f.clearSources();
  assert.equal(f.sources.length, 0);
});

test('clear resets displacement but keeps the medium', () => {
  const f = new WaveField(11, 11);
  f.setWall(2, 2);
  f.setSpeed(3, 3, 0.5);
  f.poke(5, 5, 1);
  f.step();
  f.clear();
  assert.equal(f.energy(), 0);
  assert.equal(f.time, 0);
  assert.equal(f.wall[f.index(2, 2)], 1);
  assert.ok(Math.abs(f.speed[f.index(3, 3)] - 0.5) < 1e-6);
});

// With hard borders the reflected waves interfere with the outgoing ones and
// the amplitude around a ring centred on the source becomes very uneven. A
// working sponge leaves the ring close to uniform.
function ringUniformity(field, cx, cy, radius, settle, sample) {
  for (let t = 0; t < settle; t++) field.step();
  const env = new Float32Array(field.width * field.height);
  for (let t = 0; t < sample; t++) {
    field.step();
    for (let i = 0; i < env.length; i++) env[i] = Math.max(env[i], Math.abs(field.cur[i]));
  }
  let lo = Infinity;
  let hi = 0;
  for (let a = 0; a < 360; a += 5) {
    const x = Math.round(cx + radius * Math.cos((a * Math.PI) / 180));
    const y = Math.round(cy + radius * Math.sin((a * Math.PI) / 180));
    const v = env[field.index(x, y)];
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  return lo / hi;
}

test('the sponge layer absorbs waves reaching the border', () => {
  const hard = new WaveField(81, 81, { spongeWidth: 0 });
  const soft = new WaveField(81, 81, { spongeWidth: 16, spongeStrength: 0.3 });
  hard.addSource(40, 40, { frequency: 0.04 });
  soft.addSource(40, 40, { frequency: 0.04 });
  const uHard = ringUniformity(hard, 40, 40, 15, 700, 100);
  const uSoft = ringUniformity(soft, 40, 40, 15, 700, 100);
  assert.ok(uHard < 0.5, `hard-border ring uniformity ${uHard}`);
  assert.ok(uSoft > 0.8, `sponge ring uniformity ${uSoft}`);
});
