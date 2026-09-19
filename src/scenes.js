// Built-in tank set-ups. Each scene is a function that takes a WaveField and
// arranges walls, media and sources on it; positions are given as fractions
// of the grid so the same scene works at any resolution.

function px(field, fx) {
  return Math.round(fx * (field.width - 1));
}

function py(field, fy) {
  return Math.round(fy * (field.height - 1));
}

/** A vertical barrier at fractional x spanning the full height, with gaps. */
function barrier(field, fx, gaps, thickness = 2) {
  const x = px(field, fx);
  field.fillWall(x, 0, x + thickness - 1, field.height - 1);
  for (const [fy0, fy1] of gaps) {
    field.fillWall(x, py(field, fy0), x + thickness - 1, py(field, fy1), false);
  }
}

export const SCENES = [
  {
    id: 'single',
    name: 'Single source',
    description: 'One oscillator in open water: circular wavefronts spreading outward.',
    apply(field, { frequency }) {
      field.addSource(px(field, 0.5), py(field, 0.5), { frequency });
    },
  },
  {
    id: 'two-source',
    name: 'Two-source interference',
    description: 'Two in-phase oscillators. Crests meet crests along hyperbolic lines of constructive interference; between them the water stays still.',
    apply(field, { frequency }) {
      field.addSource(px(field, 0.5), py(field, 0.38), { frequency });
      field.addSource(px(field, 0.5), py(field, 0.62), { frequency });
    },
  },
  {
    id: 'antiphase',
    name: 'Two sources, opposite phase',
    description: 'The same pair, half a cycle apart. The line midway between them is now a node instead of a crest.',
    apply(field, { frequency }) {
      field.addSource(px(field, 0.5), py(field, 0.38), { frequency });
      field.addSource(px(field, 0.5), py(field, 0.62), { frequency, phase: Math.PI });
    },
  },
  {
    id: 'double-slit',
    name: 'Double slit',
    description: 'Plane-ish waves from a distant source hit a barrier with two narrow slits. Beyond it the two openings act as new sources and interfere.',
    apply(field, { frequency }) {
      field.addSource(px(field, 0.12), py(field, 0.5), { frequency, amplitude: 1.5 });
      barrier(field, 0.45, [
        [0.44, 0.47],
        [0.53, 0.56],
      ]);
    },
  },
  {
    id: 'single-slit',
    name: 'Single slit diffraction',
    description: 'One opening a few wavelengths wide. The wave fans out behind it and a central bright lobe forms with dimmer side lobes.',
    apply(field, { frequency }) {
      field.addSource(px(field, 0.12), py(field, 0.5), { frequency, amplitude: 1.5 });
      barrier(field, 0.45, [[0.44, 0.56]]);
    },
  },
  {
    id: 'reflection',
    name: 'Reflection off a wall',
    description: 'A source near a flat wall. The reflected wave behaves like a mirror-image source behind the wall and interferes with the direct one.',
    apply(field, { frequency }) {
      field.addSource(px(field, 0.35), py(field, 0.5), { frequency });
      barrier(field, 0.7, []);
    },
  },
  {
    id: 'corner',
    name: 'Corner reflector',
    description: 'Two walls at right angles. Waves bouncing off both come straight back toward the source.',
    apply(field, { frequency }) {
      field.addSource(px(field, 0.4), py(field, 0.5), { frequency });
      const x = px(field, 0.72);
      const y0 = py(field, 0.2);
      const y1 = py(field, 0.8);
      field.fillWall(x, y0, x + 1, y1);
      field.fillWall(px(field, 0.5), y0, x + 1, y0 + 1);
      field.fillWall(px(field, 0.5), y1 - 1, x + 1, y1);
    },
  },
  {
    id: 'lens',
    name: 'Shallow-water lens',
    description: 'A round patch of shallower water where waves travel slower. The wavefronts bend inward and converge behind it, like light through a convex lens.',
    apply(field, { frequency }) {
      field.addSource(px(field, 0.1), py(field, 0.5), { frequency, amplitude: 1.5 });
      const r = Math.round(Math.min(field.width, field.height) * 0.22);
      field.fillSpeedDisc(px(field, 0.5), py(field, 0.5), r, 0.55);
    },
  },
  {
    id: 'refraction',
    name: 'Refraction at a boundary',
    description: 'The right half of the tank is shallower, so waves slow down and their wavelength shortens as they cross the line.',
    apply(field, { frequency }) {
      field.addSource(px(field, 0.2), py(field, 0.3), { frequency });
      field.fillSpeed(px(field, 0.5), 0, field.width - 1, field.height - 1, 0.5);
    },
  },
  {
    id: 'empty',
    name: 'Empty tank',
    description: 'Nothing but water. Click to drop sources, drag to draw walls.',
    apply() {},
  },
];

export function findScene(id) {
  return SCENES.find((s) => s.id === id) ?? null;
}

/**
 * Wipe the field and lay out the named scene on it.
 * Returns the scene that was applied, or null if the id is unknown.
 */
export function loadScene(field, id, options = {}) {
  const scene = findScene(id);
  if (!scene) return null;
  field.clear();
  field.clearMedium();
  field.clearSources();
  scene.apply(field, { frequency: options.frequency ?? 0.02 });
  return scene;
}
