# Verlet Particle Simulation

A 2D simulation of many colliding balls inside a circle, computed on the GPU and steered with the mouse.

## Language

### Simulation

**Particle**:
One simulated ball, with a position, a velocity, a radius and a particle id. Its mass is proportional to its area. It also has a colour, which only drawing uses and which follows it by its particle id.
_Avoid_: Verlet object, object, ball

**Disabled particle**:
A particle with radius 0, which neither collides nor draws.

**Bin**:
One square cell of the grid laid over simulation space, holding the particles whose centres fall in it.
_Avoid_: Cell, bucket, grid square

**Particle id**:
A number that identifies one particle for its whole life, wherever it sits in memory.

**Capacity**:
The most particles the simulation can hold at once, fixed when it starts.

**Spawn**:
To add a particle while the simulation is running.

**Erase**:
To remove a particle while the simulation is running.
_Avoid_: Delete, kill

**Bin grid**:
The grid of bins laid over simulation space, used to find the particles near a given particle.
_Avoid_: Spatial hash, hash grid

**Substep**:
One advance of every particle by a constant span of simulated time. A frame runs as many substeps as the time since the last frame calls for.
_Avoid_: Step, iteration, tick

**Speed limit**:
The furthest a particle may move in one substep: the smallest particle's radius. It keeps particles from passing through each other.

**Substep rate**:
The number of substeps per second of simulated time. Raising it makes the simulation more accurate and changes its results.

**Impact**:
Two particles, or a particle and the boundary circle, in contact and closing.

**Restitution**:
The fraction of the closing speed along the contact that an impact gives back as parting speed. Particle impacts and the boundary circle each have their own.
_Avoid_: Bounciness, elasticity

**Damping**:
The fraction of speed along the contact surface lost in an impact. Particle impacts and the boundary circle each have their own.

**Relaxation factor**:
The factor the collision solve scales each particle's averaged correction by.

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
The coordinate space particles live in, measured in its own units, with its origin at the centre and y pointing down. Its size is set by the boundary circle's radius; it does not change with the window or the display.
_Avoid_: World space, sim resolution

**Camera**:
The mapping between simulation space and the canvas: it fits simulation space to the canvas with its proportions kept, and maps the pointer back.
_Avoid_: Viewport, letterbox

### Modules

**Particle layout**:
The arrangement of one particle's fields in memory, shared by the shaders and the code that reads and writes particles.

**Simulation input**:
Everything outside the simulation that affects one frame of it: the click force and its point, the boundary circle's radius and behaviour, whether particles collide, and the substep rate.
_Avoid_: Params, sim params

**Simulation controls**:
The user-adjustable state of the simulation and the rules that turn mouse and keyboard actions into simulation input.
