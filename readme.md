# WebGPU Verlet Particle Simulation

15,000 colliding balls in a circle, simulated entirely on the GPU with WebGPU compute shaders and steered with the mouse.

Each frame runs 20 substeps. In each substep the particles are sorted into a grid of bins, pushed apart where they overlap, kept inside the boundary circle, and advanced with Verlet integration. Collisions are resolved in four interleaved passes over the grid so that no two GPU threads move the same particle at once.

## Running it

You need [Node.js](https://nodejs.org/) 21 or newer and a browser with WebGPU (current Chrome or Edge).

```bash
npm install
npm run dev
```

Then open http://localhost:8080. Webpack rebuilds on save; refresh the page to see changes.

## Controls

| Input | Effect |
| --- | --- |
| Left mouse button | Pull particles toward the pointer |
| Right mouse button | Push particles away from the pointer |
| `R` | Reset |
| `C` | Toggle collisions |
| `T` | Toggle between stopping at the boundary and bouncing off it |
| `P` | Pause |
| `L` | Click lock: keep the force active after releasing the button |

The same settings are in the panel at the top right.

## Tests

```bash
npm test
npm run typecheck
```

The tests run the real shaders in Node through [Dawn](https://github.com/dawn-gpu/node-webgpu), so they need a machine with a GPU; without one, the GPU tests skip. Both commands also run before every commit.

## How the code is organised

See [docs/architecture.md](docs/architecture.md) for the modules and the compute pipeline, and [docs/testing.md](docs/testing.md) for how the tests work. [GLOSSARY.md](GLOSSARY.md) defines the project's terms.

## Credits

Started from [webgpu-seed](https://github.com/alaingalvan/webgpu-seed) by Alain Galvan. Released under the [Unlicense](license.md).
