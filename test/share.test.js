import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WaveField } from '../src/wave.js';
import { loadScene } from '../src/scenes.js';
import {
  encodeMedium,
  parseMedium,
  applyMedium,
  encodeSources,
  decodeSources,
  encodeState,
  decodeState,
} from '../src/share.js';

test('an empty tank encodes as a single run of water', () => {
  const f = new WaveField(12, 10);
  assert.equal(encodeMedium(f), '120w');
  assert.deepEqual(parseMedium('120w', 120), [[120, 'w']]);
});

test('walls and shallows round-trip through the run-length encoding', () => {
  const f = new WaveField(30, 20);
  f.fillWall(10, 0, 11, 19);
  f.fillSpeedDisc(22, 10, 4, 0.55);
  f.fillSpeed(0, 18, 5, 19, 0.5);
  const text = encodeMedium(f);
  assert.match(text, /^(\d+(w|b|s[0-9a-f]{2}))+$/);
  const g = new WaveField(30, 20);
  assert.equal(applyMedium(g, text), true);
  assert.deepEqual(Array.from(g.wall), Array.from(f.wall));
  for (let i = 0; i < f.speed.length; i++) {
    assert.ok(Math.abs(g.speed[i] - f.speed[i]) < 1 / 255, `speed mismatch at ${i}`);
  }
  // Encoding the decoded field reproduces the same string.
  assert.equal(encodeMedium(g), text);
});

test('a random medium survives a round trip', () => {
  let seed = 12345;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const f = new WaveField(40, 25);
  for (let i = 0; i < f.wall.length; i++) {
    const r = rand();
    if (r < 0.2) f.wall[i] = 1;
    else if (r < 0.4) f.speed[i] = Math.round(rand() * 255) / 255;
  }
  const g = new WaveField(40, 25);
  assert.equal(applyMedium(g, encodeMedium(f)), true);
  assert.deepEqual(Array.from(g.wall), Array.from(f.wall));
  assert.deepEqual(Array.from(g.speed), Array.from(f.speed));
});

test('malformed or wrongly sized medium strings are rejected', () => {
  const f = new WaveField(10, 10);
  for (const bad of ['', '99w', '101w', '50w50x', '100', 'w100', '50w50s1', '50w50szz', '0w100w', '50w-50w', '50W50W']) {
    assert.equal(parseMedium(bad, 100), null, `accepted ${JSON.stringify(bad)}`);
    assert.equal(applyMedium(f, bad), false);
  }
  // A rejected medium leaves the field untouched.
  f.setWall(3, 3);
  applyMedium(f, '99w');
  assert.equal(f.wall[f.index(3, 3)], 1);
});

test('applying a medium clears displacement inside the new walls', () => {
  const f = new WaveField(10, 10);
  f.poke(5, 5, 1);
  f.step();
  f.step();
  const g = new WaveField(10, 10);
  g.fillWall(4, 4, 6, 6);
  applyMedium(f, encodeMedium(g));
  for (let y = 4; y <= 6; y++) for (let x = 4; x <= 6; x++) assert.equal(f.cur[f.index(x, y)], 0);
});

test('sources round-trip, and bad or out-of-range entries are dropped', () => {
  const f = new WaveField(50, 40);
  f.addSource(10, 20, { amplitude: 1.5, phase: Math.PI, vx: 0.3 });
  f.addSource(30.5, 5, { amplitude: 1 });
  const text = encodeSources(f.sources);
  assert.equal(text, '10,20,1.5,3.142,0.3,0;30.5,5,1,0,0,0');
  const back = decodeSources(text, 50, 40);
  assert.equal(back.length, 2);
  assert.equal(back[0].x, 10);
  assert.ok(Math.abs(back[0].phase - Math.PI) < 1e-3);
  assert.equal(back[0].vx, 0.3);
  assert.equal(back[1].x, 30.5);
  assert.deepEqual(decodeSources('', 50, 40), []);
  assert.deepEqual(decodeSources('1,2,3;nope;60,5,1,0,0,0;5,5,1,0,0,0', 50, 40), [
    { x: 5, y: 5, amplitude: 1, phase: 0, vx: 0, vy: 0 },
  ]);
});

test('encodeState omits the medium when it matches the scene and includes it when it differs', () => {
  const f = new WaveField(60, 40);
  loadScene(f, 'double-slit', { frequency: 0.05 });
  const base = encodeMedium(f);
  const settings = { scene: 'double-slit', frequency: 50, damping: 0, brightness: 2, view: 'intensity' };
  const plain = decodeState('#' + encodeState(settings, f, base));
  assert.equal(plain.scene, 'double-slit');
  assert.equal(plain.frequency, 50);
  assert.equal(plain.damping, undefined);
  assert.equal(plain.brightness, 2);
  assert.equal(plain.view, 'intensity');
  assert.equal(plain.medium, undefined);
  assert.equal(plain.sources, encodeSources(f.sources));

  f.setWall(5, 5);
  const edited = decodeState(encodeState({ ...settings, damping: 0.0015, view: 'displacement' }, f, base));
  assert.equal(edited.medium, encodeMedium(f));
  assert.equal(edited.damping, 0.0015);
  assert.equal(edited.view, 'displacement');
});

test('the encoded state is a valid query string without unsafe characters', () => {
  const f = new WaveField(60, 40);
  loadScene(f, 'lens', { frequency: 0.04 });
  f.addSource(3, 3, { phase: 1.5 });
  const text = encodeState({ scene: 'lens', frequency: 40, damping: 0, brightness: 1, view: 'displacement' }, f);
  assert.doesNotMatch(text, /[#\s]/);
  const params = new URLSearchParams(text);
  assert.equal(params.get('s'), 'lens');
  assert.equal(params.get('b'), null, 'default brightness is left out');
});

test('decodeState tolerates missing and malformed values', () => {
  assert.equal(decodeState(''), null);
  assert.equal(decodeState('#'), null);
  assert.equal(decodeState('#f=50'), null, 'no scene means no state');
  const s = decodeState('#s=single&f=abc&d=-1&b=0&v=x');
  assert.equal(s.scene, 'single');
  assert.equal(s.frequency, undefined);
  assert.equal(s.damping, undefined);
  assert.equal(s.brightness, undefined);
  assert.equal(s.view, undefined);
  assert.equal(s.sources, undefined);
  assert.equal(s.medium, undefined);
  assert.equal(decodeState('s=single').view, 'displacement');
});
