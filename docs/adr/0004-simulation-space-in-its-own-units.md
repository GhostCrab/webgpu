# Simulation space in its own units, drawn through a camera

Simulation space is measured in its own units, set only by the boundary circle's radius and the particle radii, and is fitted to the canvas by a camera transform. Particles are drawn straight to the canvas at its native resolution. We chose this over the fixed 3840 x 2160 simulation target, where one unit equalled one texel, because that tied the size of the simulation to an image resolution, made every display pay for a 4K multisampled target, and left no way to change the size of simulation space without changing the picture.

## Consequences

- The simulation target and its multisampled attachments go away; disc edges are smoothed in the fragment shader instead.
- An effect that needs the previous frame's image (trails, blur) would need an offscreen target again. None exists today.
