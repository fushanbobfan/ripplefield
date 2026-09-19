import { WaveField } from './wave.js';
import { SCENES, loadScene } from './scenes.js';
import { IntensityAccumulator, paintField } from './render.js';

const GRID_W = 240;
const GRID_H = 160;
const SHALLOW_SPEED = 0.5;
const POKE_AMPLITUDE = 4;
const DEFAULT_SCENE = 'two-source';

const $ = (id) => document.getElementById(id);

const canvas = $('tank');
const ctx = canvas.getContext('2d');
const buffer = document.createElement('canvas');
buffer.width = GRID_W;
buffer.height = GRID_H;
const bctx = buffer.getContext('2d');
const image = bctx.createImageData(GRID_W, GRID_H);

const field = new WaveField(GRID_W, GRID_H, { spongeWidth: 24 });
const intensity = new IntensityAccumulator(GRID_W * GRID_H, { rate: 0.01 });

const ui = {
  scene: $('scene'),
  sceneDescription: $('scene-description'),
  frequency: $('frequency'),
  frequencyValue: $('frequency-value'),
  damping: $('damping'),
  dampingValue: $('damping-value'),
  steps: $('steps'),
  stepsValue: $('steps-value'),
  brightness: $('brightness'),
  brightnessValue: $('brightness-value'),
  view: $('view'),
  brush: $('brush'),
  brushValue: $('brush-value'),
  pause: $('pause'),
  step: $('step'),
  clearWaves: $('clear-waves'),
  clearSources: $('clear-sources'),
  reset: $('reset'),
  status: $('status'),
  tools: Array.from(document.querySelectorAll('input[name="tool"]')),
};

const state = {
  paused: false,
  stepsPerFrame: Number(ui.steps.value),
  brightness: Number(ui.brightness.value),
  view: ui.view.value,
  brush: Number(ui.brush.value),
  tool: 'source',
  sceneId: DEFAULT_SCENE,
  frames: 0,
  fps: 0,
  lastFpsTime: performance.now(),
};

// Slider value (10..90) -> cycles per step.
function sliderFrequency() {
  return Number(ui.frequency.value) / 1000;
}

function currentTool() {
  return ui.tools.find((t) => t.checked)?.value ?? 'source';
}

// ---- scenes -------------------------------------------------------------

for (const scene of SCENES) {
  const opt = document.createElement('option');
  opt.value = scene.id;
  opt.textContent = scene.name;
  ui.scene.append(opt);
}

function applyScene(id) {
  const scene = loadScene(field, id, { frequency: sliderFrequency() });
  if (!scene) return;
  state.sceneId = id;
  ui.scene.value = id;
  ui.sceneDescription.textContent = scene.description;
  intensity.reset();
}

// ---- controls -----------------------------------------------------------

ui.scene.addEventListener('change', () => applyScene(ui.scene.value));

ui.frequency.addEventListener('input', () => {
  const f = sliderFrequency();
  ui.frequencyValue.textContent = ui.frequency.value;
  // Shift each source's phase so the oscillation stays continuous when the
  // frequency changes mid-run instead of jumping.
  for (const src of field.sources) {
    src.phase += 2 * Math.PI * (src.frequency - f) * field.time;
    src.frequency = f;
  }
  intensity.reset();
});

ui.damping.addEventListener('input', () => {
  field.damping = Number(ui.damping.value);
  ui.dampingValue.textContent = field.damping.toFixed(4);
});

ui.steps.addEventListener('input', () => {
  state.stepsPerFrame = Number(ui.steps.value);
  ui.stepsValue.textContent = ui.steps.value;
});

ui.brightness.addEventListener('input', () => {
  state.brightness = Number(ui.brightness.value);
  ui.brightnessValue.textContent = state.brightness.toFixed(1);
});

ui.view.addEventListener('change', () => {
  state.view = ui.view.value;
});

ui.brush.addEventListener('input', () => {
  state.brush = Number(ui.brush.value);
  ui.brushValue.textContent = ui.brush.value;
});

function setPaused(paused) {
  state.paused = paused;
  ui.pause.textContent = paused ? 'Play' : 'Pause';
  ui.pause.setAttribute('aria-pressed', String(paused));
}

ui.pause.addEventListener('click', () => setPaused(!state.paused));
ui.step.addEventListener('click', () => {
  setPaused(true);
  advance(1);
  draw();
});
ui.clearWaves.addEventListener('click', () => {
  field.clear();
  intensity.reset();
});
ui.clearSources.addEventListener('click', () => {
  field.clearSources();
  intensity.reset();
});
ui.reset.addEventListener('click', () => applyScene(state.sceneId));

for (const radio of ui.tools) {
  radio.addEventListener('change', () => {
    state.tool = currentTool();
  });
}

function switchView() {
  state.view = state.view === 'displacement' ? 'intensity' : 'displacement';
  ui.view.value = state.view;
}

document.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) {
    if (e.key === ' ' || e.key === '.') return;
  }
  const key = e.key.toLowerCase();
  if (e.key === ' ') {
    e.preventDefault();
    setPaused(!state.paused);
  } else if (e.key === '.') {
    setPaused(true);
    advance(1);
    draw();
  } else if (key === 'c') {
    field.clear();
    intensity.reset();
  } else if (key === 'r') {
    applyScene(state.sceneId);
  } else if (key === 'v') {
    switchView();
  } else if (/^[1-5]$/.test(e.key)) {
    const radio = ui.tools[Number(e.key) - 1];
    if (radio) {
      radio.checked = true;
      state.tool = radio.value;
    }
  }
});

// ---- pointer tools --------------------------------------------------------

function cellFromEvent(e) {
  const rect = canvas.getBoundingClientRect();
  const x = Math.floor(((e.clientX - rect.left) / rect.width) * GRID_W);
  const y = Math.floor(((e.clientY - rect.top) / rect.height) * GRID_H);
  return [Math.min(GRID_W - 1, Math.max(0, x)), Math.min(GRID_H - 1, Math.max(0, y))];
}

function paintBrush(x, y, fn) {
  const r = state.brush - 1;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy <= r * r + r) fn(x + dx, y + dy);
    }
  }
}

function nearestSource(x, y, radius = 3) {
  let best = null;
  let bestD = radius * radius;
  for (const src of field.sources) {
    const d = (src.x - x) ** 2 + (src.y - y) ** 2;
    if (d <= bestD) {
      best = src;
      bestD = d;
    }
  }
  return best;
}

function applyTool(x, y, isFirst) {
  switch (state.tool) {
    case 'source': {
      if (!isFirst) return;
      const hit = nearestSource(x, y);
      if (hit) {
        field.removeSource(hit);
      } else if (!field.wall[field.index(x, y)]) {
        field.addSource(x, y, { frequency: sliderFrequency() });
      }
      intensity.reset();
      break;
    }
    case 'poke':
      field.poke(x, y, POKE_AMPLITUDE);
      break;
    case 'wall':
      paintBrush(x, y, (px, py) => field.setWall(px, py, true));
      break;
    case 'erase':
      paintBrush(x, y, (px, py) => {
        field.setWall(px, py, false);
        field.setSpeed(px, py, 1);
      });
      break;
    case 'shallow':
      paintBrush(x, y, (px, py) => {
        if (!field.wall[field.index(px, py)]) field.setSpeed(px, py, SHALLOW_SPEED);
      });
      break;
    default:
      break;
  }
}

let dragging = false;
let lastCell = null;

function strokeTo(x, y, isFirst) {
  if (lastCell && !isFirst) {
    // Fill in the gap between pointer samples so fast strokes stay continuous.
    const [lx, ly] = lastCell;
    const n = Math.max(Math.abs(x - lx), Math.abs(y - ly));
    for (let i = 1; i <= n; i++) {
      applyTool(Math.round(lx + ((x - lx) * i) / n), Math.round(ly + ((y - ly) * i) / n), false);
    }
  } else {
    applyTool(x, y, isFirst);
  }
  lastCell = [x, y];
}

canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  canvas.setPointerCapture(e.pointerId);
  dragging = true;
  lastCell = null;
  const [x, y] = cellFromEvent(e);
  strokeTo(x, y, true);
  if (state.paused) draw();
});

canvas.addEventListener('pointermove', (e) => {
  if (!dragging || state.tool === 'source') return;
  const [x, y] = cellFromEvent(e);
  strokeTo(x, y, false);
  if (state.paused) draw();
});

function endStroke() {
  dragging = false;
  lastCell = null;
}
canvas.addEventListener('pointerup', endStroke);
canvas.addEventListener('pointercancel', endStroke);
canvas.addEventListener('lostpointercapture', endStroke);

// ---- animation loop -------------------------------------------------------

function advance(n) {
  for (let i = 0; i < n; i++) {
    field.step();
    if (state.view === 'intensity') intensity.update(field.cur);
  }
}

function draw() {
  const scale =
    state.view === 'intensity'
      ? Math.max(intensity.reference(), 1e-9) / state.brightness
      : 1 / state.brightness;
  paintField(field, image.data, {
    mode: state.view,
    scale,
    intensity: intensity.values,
  });
  bctx.putImageData(image, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(buffer, 0, 0, canvas.width, canvas.height);
}

function updateStatus(now) {
  state.frames++;
  if (now - state.lastFpsTime >= 500) {
    state.fps = Math.round((state.frames * 1000) / (now - state.lastFpsTime));
    state.frames = 0;
    state.lastFpsTime = now;
  }
  const n = field.sources.length;
  ui.status.textContent = `t = ${field.time} · ${n} source${n === 1 ? '' : 's'} · ${state.fps} fps${state.paused ? ' · paused' : ''}`;
}

function frame(now) {
  if (!state.paused) advance(state.stepsPerFrame);
  draw();
  updateStatus(now);
  requestAnimationFrame(frame);
}

applyScene(DEFAULT_SCENE);
ui.frequencyValue.textContent = ui.frequency.value;
ui.dampingValue.textContent = Number(ui.damping.value).toFixed(4);
requestAnimationFrame(frame);
