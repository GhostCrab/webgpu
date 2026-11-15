# Verlet Particle Simulation

A 2D simulation of many colliding balls inside a circle, computed on the GPU and steered with the mouse.

## Language

### Simulation

**Particle**:
One simulated ball, with a position, a previous position, a colour and a radius.
_Avoid_: Verlet object, object, ball

**Disabled particle**:
A particle with radius 0, which neither collides nor draws.

**Bin**:
One square cell of the grid laid over simulation space, holding the particles whose centres fall in it.
_Avoid_: Cell, bucket, grid square

**Substep**:
One advance of every particle by a fraction of the frame time. A frame is a fixed number of substeps.
_Avoid_: Step, iteration, tick

**Boundary circle**:
The circle particles are kept inside.
_Avoid_: Constraint, bounds, wall

**Classic constrain**:
The boundary behaviour that stops a particle at the edge of the boundary circle.

**Reflective constrain**:
The boundary behaviour that bounces a particle off the edge of the boundary circle.

**Click force**:
The pull toward, or push away from, the pointer while a mouse button is held. It replaces gravity while active.
_Avoid_: Impulse, mouse force

**Click lock**:
A mode in which the click force stays active after the mouse button is released.

**Simulation space**:
The fixed-size coordinate space particles live in, with its origin at the centre and y pointing down. It does not change with the window.
_Avoid_: World space, sim resolution

### Modules

**Particle layout**:
The arrangement of one particle's fields in memory, shared by the shaders and the code that reads and writes particles.

**Simulation input**:
Everything outside the simulation that affects one frame of it: the click force and its point, the boundary circle's radius and behaviour, and whether particles collide.
_Avoid_: Params, sim params

**Simulation controls**:
The user-adjustable state of the simulation and the rules that turn mouse and keyboard actions into simulation input.

**Simulation target**:
The fixed-size image the simulation is drawn into before being fitted to the window.
_Avoid_: Render texture, offscreen target
