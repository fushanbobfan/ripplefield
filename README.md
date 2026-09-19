# ripplefield

An interactive ripple tank in the browser. Drop oscillating sources, draw
walls and slits, paint patches of shallow water, and watch interference,
diffraction, reflection and refraction unfold in real time.

Runs with no build step and no dependencies. The wave solver, scene
definitions and colour mapping are plain ES modules covered by a Node test
suite; only the page glue touches the DOM.

## Quick start

Open `index.html` in a browser, or serve the folder:

```bash
npm run serve
# then visit http://localhost:8080
```

The dev server is a ~40-line dependency-free static file server; any other
static server works too.

## What you can do

| Tool | Effect |
| --- | --- |
| Add source | Click to place an oscillator at the current frequency; click an existing one to remove it |
| Drop a pebble | Click (or drag) to disturb the surface once and watch a ring spread |
| Draw wall | Drag to paint reflecting barriers with the chosen brush size |
| Erase wall | Drag to remove walls and restore deep water |
| Paint shallows | Drag to paint slower, shallower water where waves bend and shorten |

| Control | Effect |
| --- | --- |
| Scene | Load one of ten built-in set-ups (see below) |
| Frequency | Oscillation rate of every source, in thousandths of a cycle per step |
| Damping | Uniform energy loss; useful to settle a busy tank |
| Speed | Simulation steps per animation frame |
| Brightness | Colour gain; raise it to see faint fringes |
| View | Instantaneous surface displacement, or a long-exposure time-averaged intensity |
| Wall brush size | Radius of the wall, erase and shallows brushes |
| Pause / Step | Freeze the tank, or advance it a single step |
| Calm water | Zero the surface but keep sources, walls and shallows |
| Remove sources | Drop every oscillator |
| Reset scene | Rebuild the selected scene from scratch |

Keyboard: <kbd>Space</kbd> pause, <kbd>.</kbd> step, <kbd>C</kbd> calm the
water, <kbd>R</kbd> reset, <kbd>V</kbd> switch view, <kbd>1</kbd>–<kbd>5</kbd>
pick a tool.

### Scenes

- **Single source** – circular wavefronts in open water.
- **Two-source interference** – two in-phase oscillators and the hyperbolic
  lines of constructive interference between them.
- **Two sources, opposite phase** – the same pair half a cycle apart; the
  midline becomes a node.
- **Double slit** – a distant source, a barrier with two narrow gaps, and the
  fringes behind it. Switch to the intensity view to see the classic pattern.
- **Single slit diffraction** – one opening a few wavelengths wide, with a
  central lobe and dimmer side lobes.
- **Reflection off a wall** – a source beside a flat barrier behaves like a
  pair of sources, one of them a mirror image.
- **Corner reflector** – two walls at right angles send waves straight back.
- **Shallow-water lens** – a round patch of slow water focuses plane waves.
- **Refraction at a boundary** – waves slow down and shorten as they cross
  into shallower water.
- **Empty tank** – start from nothing.

## How it works

The surface is a 240 × 160 grid of displacement values advanced with the
standard second-order leapfrog scheme for the 2D scalar wave equation:

```
u_next = (2u − (1 − σ) u_prev + (c·Δt/Δx)² ∇²u) / (1 + σ)
```

- `c` is a per-cell wave speed, so painted shallows (`c = 0.5`) slow and bend
  the wave. The Courant number is held at 0.7, under the 2D stability limit of
  1/√2.
- `σ` is a velocity-damping coefficient. The **Damping** slider sets it
  uniformly; a 24-cell sponge layer around the border ramps it up
  quadratically so outgoing waves are absorbed instead of bouncing back,
  making the tank behave as if it were much larger. Damping the velocity
  rather than scaling the displacement keeps the sponge itself from
  reflecting.
- Walls pin the displacement to zero, which reflects waves with a phase
  inversion.
- Sources add `A·sin(2πft + φ)` to their cell every step (a "soft" source), so
  waves pass through them instead of scattering off a clamped cell.

Colours: amber for crests, blue for troughs, dark slate for still water. The
intensity view keeps an exponential running average of `u²`, normalises it by
its 98th percentile (so a single bright source cell does not black out the
rest of the tank) and shows it on a square-root scale so faint fringes stay
visible next to bright ones.

## Project layout

```
index.html        page markup and controls
style.css         layout and theme
src/wave.js       WaveField: grid, stepping, walls, speed map, sources, sponge
src/scenes.js     built-in scene definitions
src/render.js     colour ramps, intensity accumulator, RGBA painting
src/main.js       DOM wiring, pointer tools and the animation loop
test/             node --test suites for the solver, scenes and renderer
scripts/serve.js  dependency-free static server for local development
```

## Development

```bash
npm test
```

## License

MIT
