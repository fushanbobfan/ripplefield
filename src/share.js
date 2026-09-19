// Permalinks. The tank's set-up is written into the URL hash as ordinary
// query parameters so a link can be pasted anywhere:
//
//   #s=double-slit&f=50&d=0.001&b=2&v=i&src=30,80,1,0,0,0;...&m=<runs>
//
// The medium (walls and shallows) is run-length encoded per cell. Each run is
// a decimal length followed by a type: `w` water, `b` barrier, or `s` plus two
// hex digits giving the wave speed as a fraction of the maximum (00..ff).
// Only the medium and sources are stored, never the moving surface itself.

const HEX2 = /^[0-9a-f]{2}$/;

/** Classify one cell of a field as a run type token. */
function cellType(field, i) {
  if (field.wall[i]) return 'b';
  const sp = field.speed[i];
  if (sp >= 1) return 'w';
  return 's' + Math.round(sp * 255).toString(16).padStart(2, '0');
}

/** Run-length encode walls and speed into a compact URL-safe string. */
export function encodeMedium(field) {
  const n = field.width * field.height;
  let out = '';
  let i = 0;
  while (i < n) {
    const type = cellType(field, i);
    let j = i + 1;
    while (j < n && cellType(field, j) === type) j++;
    out += String(j - i) + type;
    i = j;
  }
  return out;
}

/**
 * Parse a run-length string into an array of [length, type] pairs, or null if
 * it is malformed or does not cover exactly `size` cells.
 */
export function parseMedium(text, size) {
  const runs = [];
  let total = 0;
  let i = 0;
  while (i < text.length) {
    let j = i;
    while (j < text.length && text[j] >= '0' && text[j] <= '9') j++;
    if (j === i || j >= text.length) return null;
    const length = Number(text.slice(i, j));
    if (!Number.isFinite(length) || length <= 0) return null;
    const t = text[j];
    let type;
    if (t === 'w' || t === 'b') {
      type = t;
      i = j + 1;
    } else if (t === 's') {
      const hex = text.slice(j + 1, j + 3);
      if (!HEX2.test(hex)) return null;
      type = 's' + hex;
      i = j + 3;
    } else {
      return null;
    }
    runs.push([length, type]);
    total += length;
    if (total > size) return null;
  }
  return total === size ? runs : null;
}

/** Apply parsed runs to a field's walls and speed map. Returns false if invalid. */
export function applyMedium(field, text) {
  const runs = parseMedium(text, field.width * field.height);
  if (!runs) return false;
  field.wall.fill(0);
  field.speed.fill(1);
  let i = 0;
  for (const [length, type] of runs) {
    if (type === 'b') {
      field.wall.fill(1, i, i + length);
    } else if (type[0] === 's') {
      field.speed.fill(parseInt(type.slice(1), 16) / 255, i, i + length);
    }
    i += length;
  }
  // Walls hold zero displacement; clear anything that was there.
  for (let k = 0; k < field.wall.length; k++) {
    if (field.wall[k]) {
      field.prev[k] = 0;
      field.cur[k] = 0;
    }
  }
  return true;
}

function num(v, digits = 3) {
  return Number(v.toFixed(digits)).toString();
}

/** Encode the list of sources as `x,y,amplitude,phase,vx,vy;...`. */
export function encodeSources(sources) {
  return sources
    .map((s) => [num(s.x, 2), num(s.y, 2), num(s.amplitude, 2), num(s.phase, 3), num(s.vx ?? 0, 3), num(s.vy ?? 0, 3)].join(','))
    .join(';');
}

/** Decode sources; entries that do not parse or fall outside the grid are dropped. */
export function decodeSources(text, width, height) {
  if (!text) return [];
  const out = [];
  for (const chunk of text.split(';')) {
    const parts = chunk.split(',').map(Number);
    if (parts.length !== 6 || parts.some((p) => !Number.isFinite(p))) continue;
    const [x, y, amplitude, phase, vx, vy] = parts;
    if (x < 0 || y < 0 || x > width - 1 || y > height - 1) continue;
    out.push({ x, y, amplitude, phase, vx, vy });
  }
  return out;
}

/**
 * Build the hash fragment (without the leading '#') for the current state.
 * `settings` carries scene id and slider values; the medium is included only
 * when it differs from what the scene itself lays down (`baseMedium`).
 */
export function encodeState({ scene, frequency, damping, brightness, view }, field, baseMedium = null) {
  const params = new URLSearchParams();
  params.set('s', scene);
  params.set('f', String(frequency));
  if (damping) params.set('d', num(damping, 4));
  if (brightness !== 1) params.set('b', num(brightness, 2));
  if (view === 'intensity') params.set('v', 'i');
  params.set('src', encodeSources(field.sources));
  const medium = encodeMedium(field);
  if (medium !== baseMedium) params.set('m', medium);
  return params.toString();
}

/**
 * Parse a hash fragment into a plain settings object. Missing or malformed
 * values are left undefined so the caller can fall back to defaults.
 * Returns null when the fragment carries no scene at all.
 */
export function decodeState(hash) {
  const text = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!text) return null;
  const params = new URLSearchParams(text);
  const scene = params.get('s');
  if (!scene) return null;
  const numOr = (key, min, max) => {
    if (!params.has(key)) return undefined;
    const v = Number(params.get(key));
    return Number.isFinite(v) && v >= min && v <= max ? v : undefined;
  };
  return {
    scene,
    frequency: numOr('f', 1, 500),
    damping: numOr('d', 0, 1),
    brightness: numOr('b', 0.01, 100),
    view: params.get('v') === 'i' ? 'intensity' : params.has('v') ? undefined : 'displacement',
    sources: params.has('src') ? params.get('src') : undefined,
    medium: params.has('m') ? params.get('m') : undefined,
  };
}
