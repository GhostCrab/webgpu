# Coding Standards

Rules a review enforces on a diff. Each is a judgement call that no automated check covers; anything a tool can check belongs in the tool instead.

## GPU resources

**The module that creates a GPU texture or buffer destroys it.**
A class that calls `createTexture` or `createBuffer` keeps a reference to the result and has a `destroy()` that releases it. When it replaces a resource (for example on resize), it destroys the old one in the same method. GPU memory is not reclaimed promptly by garbage collection, and a 4x multisampled 4K texture is over 100 MB.

**Values that size a GPU resource are validated where they enter the module.**
A count, a dimension or a radius that ends up in a buffer size, a texture size, a dispatch count or a divisor is checked at the constructor or public method that receives it. The error names the caller's mistake ("seed returned no particles"), because the WebGPU error that follows otherwise names only a size.

## Interfaces

**A parameter whose unit or meaning changes gets a new name.**
When a function keeps its signature but its argument starts to mean something else (frames become substeps, units per substep become units per second), rename the parameter, the function or the option, so every existing caller fails to compile and is read again. With the name unchanged, old callers still type-check and still pass while testing something else: a test that stepped one frame steps one substep.

## Tests

**Test helpers call the app's functions.**
When a test needs the app's behaviour (its start state, its projection, its packing), it calls the function the app calls, with a seam for determinism if needed (an injected random source, a seed). A copy of the formula in the test tree stops describing the app the first time the app changes.
