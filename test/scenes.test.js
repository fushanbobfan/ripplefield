import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WaveField } from '../src/wave.js';
import { SCENES, findScene, loadScene } from '../src/scenes.js';

test('scene ids are unique and every scene has a name and description', () => {
  const ids = new Set();
  for (const scene of SCENES) {
    assert.ok(scene.id && !ids.has(scene.id), `duplicate or missing id ${scene.id}`);
    ids.add(scene.id);
    assert.ok(scene.name.length > 0);
    assert.ok(scene.description.length > 0);
    assert.equal(typeof scene.apply, 'function');
  }
  assert.equal(findScene('does-not-exist'), null);
  assert.equal(findScene('single').name, 'Single source');
});

test('every scene loads on small and large grids without leaving the field', () => {
  for (const [w, h] of [[40, 30], [240, 160], [300, 120]]) {
    for (const scene of SCENES) {
      const f = new WaveField(w, h, { spongeWidth: 4 });
      const applied = loadScene(f, scene.id, { frequency: 0.03 });
      assert.equal(applied, scene);
      for (const s of f.sources) {
        assert.ok(f.inBounds(s.x, s.y), `${scene.id}: source at ${s.x},${s.y} outside ${w}x${h}`);
        assert.equal(f.wall[f.index(s.x, s.y)], 0, `${scene.id}: source inside a wall`);
        assert.equal(s.frequency, 0.03);
      }
      for (let i = 0; i < 20; i++) f.step();
      assert.ok(Number.isFinite(f.energy()));
    }
  }
});

test('loadScene replaces the previous set-up', () => {
  const f = new WaveField(60, 40);
  loadScene(f, 'double-slit');
  assert.ok(f.wall.some((v) => v === 1));
  assert.equal(f.sources.length, 1);
  loadScene(f, 'two-source');
  assert.ok(f.wall.every((v) => v === 0));
  assert.equal(f.sources.length, 2);
  assert.equal(f.time, 0);
  assert.equal(loadScene(f, 'nope'), null);
});

test('the double slit barrier has exactly two openings', () => {
  const f = new WaveField(200, 100);
  loadScene(f, 'double-slit');
  // Find the barrier column: the one with the most wall cells.
  let bestX = -1;
  let bestCount = -1;
  for (let x = 0; x < f.width; x++) {
    let c = 0;
    for (let y = 0; y < f.height; y++) c += f.wall[f.index(x, y)];
    if (c > bestCount) {
      bestCount = c;
      bestX = x;
    }
  }
  let openings = 0;
  let inGap = false;
  for (let y = 0; y < f.height; y++) {
    const open = f.wall[f.index(bestX, y)] === 0;
    if (open && !inGap) openings++;
    inGap = open;
  }
  assert.equal(openings, 2);
  assert.ok(bestCount > f.height * 0.8);
});

test('the antiphase pair produces a node on the midline where the in-phase pair has a crest', () => {
  const run = (id) => {
    const f = new WaveField(121, 121, { spongeWidth: 16 });
    loadScene(f, id, { frequency: 0.04 });
    for (let t = 0; t < 400; t++) f.step();
    // Envelope along the midline between the two sources, off to one side.
    let env = 0;
    for (let t = 0; t < 60; t++) {
      f.step();
      env = Math.max(env, Math.abs(f.cur[f.index(85, 60)]));
    }
    return env;
  };
  const inPhase = run('two-source');
  const antiPhase = run('antiphase');
  assert.ok(antiPhase < inPhase * 0.1, `antiphase ${antiPhase} vs in-phase ${inPhase}`);
});

test('the lens slows waves inside the disc only', () => {
  const f = new WaveField(200, 100);
  loadScene(f, 'lens');
  assert.ok(f.speed[f.index(100, 50)] < 1);
  assert.equal(f.speed[f.index(10, 10)], 1);
  assert.equal(f.speed[f.index(190, 50)], 1);
});
