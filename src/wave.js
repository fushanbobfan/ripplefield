// Finite-difference solver for the 2D scalar wave equation on a regular grid.
//
// Three displacement buffers (previous, current, next) are advanced with the
// standard second-order leapfrog scheme:
//
//   u_next = 2u - u_prev + (c dt / dx)^2 * laplacian(u)
//
// Each cell carries its own wave speed so regions of a different "depth" bend
// the wavefronts (refraction). Wall cells hold the displacement at zero, which
// reflects waves with a phase inversion, and a sponge layer along the border
// soaks up outgoing energy so the tank behaves as if it were much larger.
//
// Damping enters as a velocity term sigma * du/dt, discretised as
//
//   u_next = (2u - (1 - sigma) u_prev + c2 lap) / (1 + sigma)
//
// which dissipates energy without reflecting the wave the way a plain
// per-step amplitude multiplier does. The sponge is a spatially varying sigma.

// Largest stable Courant number for the 2D scheme is 1/sqrt(2); stay below it.
export const MAX_COURANT = 0.7;

export class WaveField {
  constructor(width, height, options = {}) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 3 || height < 3) {
      throw new RangeError('grid must be at least 3x3');
    }
    this.width = width;
    this.height = height;
    const n = width * height;
    this.prev = new Float32Array(n);
    this.cur = new Float32Array(n);
    this.next = new Float32Array(n);
    // Fraction of the maximum speed, 0..1. Zero means the wave cannot enter.
    this.speed = new Float32Array(n).fill(1);
    this.wall = new Uint8Array(n);
    this.damping = options.damping ?? 0;
    this.courant = options.courant ?? MAX_COURANT;
    this.spongeWidth = options.spongeWidth ?? 0;
    this.spongeStrength = options.spongeStrength ?? 0.3;
    this.time = 0;
    this.sources = [];
    this._sponge = null;
    if (this.courant > MAX_COURANT) {
      throw new RangeError(`courant number ${this.courant} exceeds the stability limit ${MAX_COURANT}`);
    }
  }

  index(x, y) {
    return y * this.width + x;
  }

  inBounds(x, y) {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  /** Reset displacement and time, keeping walls, speed map and sources. */
  clear() {
    this.prev.fill(0);
    this.cur.fill(0);
    this.next.fill(0);
    this.time = 0;
  }

  /** Remove walls and restore uniform speed everywhere. */
  clearMedium() {
    this.wall.fill(0);
    this.speed.fill(1);
  }

  setWall(x, y, on = true) {
    if (!this.inBounds(x, y)) return;
    const i = this.index(x, y);
    this.wall[i] = on ? 1 : 0;
    if (on) {
      this.prev[i] = 0;
      this.cur[i] = 0;
    }
  }

  /** Mark every cell in the rectangle [x0,x1] x [y0,y1] (inclusive) as wall. */
  fillWall(x0, y0, x1, y1, on = true) {
    const ax = Math.max(0, Math.min(x0, x1));
    const bx = Math.min(this.width - 1, Math.max(x0, x1));
    const ay = Math.max(0, Math.min(y0, y1));
    const by = Math.min(this.height - 1, Math.max(y0, y1));
    for (let y = ay; y <= by; y++) {
      for (let x = ax; x <= bx; x++) this.setWall(x, y, on);
    }
  }

  setSpeed(x, y, value) {
    if (!this.inBounds(x, y)) return;
    this.speed[this.index(x, y)] = Math.min(1, Math.max(0, value));
  }

  fillSpeed(x0, y0, x1, y1, value) {
    const ax = Math.max(0, Math.min(x0, x1));
    const bx = Math.min(this.width - 1, Math.max(x0, x1));
    const ay = Math.max(0, Math.min(y0, y1));
    const by = Math.min(this.height - 1, Math.max(y0, y1));
    for (let y = ay; y <= by; y++) {
      for (let x = ax; x <= bx; x++) this.setSpeed(x, y, value);
    }
  }

  /** Fill a disc of the speed map, used for lenses. */
  fillSpeedDisc(cx, cy, radius, value) {
    const r2 = radius * radius;
    for (let y = Math.floor(cy - radius); y <= Math.ceil(cy + radius); y++) {
      for (let x = Math.floor(cx - radius); x <= Math.ceil(cx + radius); x++) {
        const dx = x - cx;
        const dy = y - cy;
        if (dx * dx + dy * dy <= r2) this.setSpeed(x, y, value);
      }
    }
  }

  /**
   * Add a continuously oscillating point source.
   * frequency is in cycles per step, phase in radians. Returns the source.
   */
  addSource(x, y, { frequency = 0.02, amplitude = 1, phase = 0 } = {}) {
    if (!this.inBounds(x, y)) throw new RangeError('source outside the grid');
    const source = { x, y, frequency, amplitude, phase, enabled: true };
    this.sources.push(source);
    return source;
  }

  removeSource(source) {
    const i = this.sources.indexOf(source);
    if (i >= 0) this.sources.splice(i, 1);
  }

  clearSources() {
    this.sources.length = 0;
  }

  /** Displace a single cell once, like a pebble hitting the water. */
  poke(x, y, amplitude = 1) {
    if (!this.inBounds(x, y)) return;
    const i = this.index(x, y);
    if (this.wall[i]) return;
    this.cur[i] += amplitude;
  }

  /** Precompute the border damping profile; called lazily by step(). */
  _buildSponge() {
    const { width, height, spongeWidth: w, spongeStrength: s } = this;
    const sponge = new Float32Array(width * height);
    if (w > 0) {
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const d = Math.min(x, y, width - 1 - x, height - 1 - y);
          if (d < w) {
            const t = (w - d) / w;
            sponge[y * width + x] = s * t * t;
          }
        }
      }
    }
    this._sponge = sponge;
  }

  /** Advance the field by one time step. */
  step() {
    const { width, height, prev, cur, next, speed, wall, courant, damping } = this;
    if (!this._sponge) this._buildSponge();
    const sponge = this._sponge;
    const c2 = courant * courant;

    for (let y = 1; y < height - 1; y++) {
      const row = y * width;
      for (let x = 1; x < width - 1; x++) {
        const i = row + x;
        if (wall[i]) {
          next[i] = 0;
          continue;
        }
        const s = speed[i];
        const lap = cur[i - 1] + cur[i + 1] + cur[i - width] + cur[i + width] - 4 * cur[i];
        const sigma = damping + sponge[i];
        next[i] = (2 * cur[i] - (1 - sigma) * prev[i] + c2 * s * s * lap) / (1 + sigma);
      }
    }

    // Fixed zero displacement along the outermost ring of cells.
    for (let x = 0; x < width; x++) {
      next[x] = 0;
      next[(height - 1) * width + x] = 0;
    }
    for (let y = 0; y < height; y++) {
      next[y * width] = 0;
      next[y * width + width - 1] = 0;
    }

    this.time += 1;
    for (const src of this.sources) {
      if (!src.enabled) continue;
      const i = this.index(src.x, src.y);
      if (wall[i]) continue;
      next[i] += src.amplitude * Math.sin(2 * Math.PI * src.frequency * this.time + src.phase);
    }

    this.prev = cur;
    this.cur = next;
    this.next = prev;
  }

  /** Total displacement energy proxy: sum of squared displacement. */
  energy() {
    let e = 0;
    const u = this.cur;
    for (let i = 0; i < u.length; i++) e += u[i] * u[i];
    return e;
  }

  /** Largest absolute displacement in the field. */
  peak() {
    let m = 0;
    const u = this.cur;
    for (let i = 0; i < u.length; i++) {
      const a = Math.abs(u[i]);
      if (a > m) m = a;
    }
    return m;
  }
}
