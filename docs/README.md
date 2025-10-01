# Project Documentation

This directory contains exploratory refactoring documentation, technical analysis, and implementation notes for the WebGPU Verlet Physics project.

## Documentation Structure

Documentation files are indexed numerically for easy reference and chronological tracking:

- **Format**: `XX_descriptive_name.md` where XX is a two-digit index (01, 02, 03, etc.)
- **Purpose**: Each document captures a specific refactoring task, architectural decision, or technical exploration
- **Intended Use**: These documents serve as context for future Claude Code sessions and as reference material for understanding the evolution of the codebase

## Usage for Claude Code Sessions

When starting a new conversation about this project, reference relevant documentation files to provide context about previous architectural decisions and implementation details. This helps maintain consistency and builds on prior work.

## Documentation Style Guidelines

### General Principles
- **Avoid line-specific references**: Use general code location descriptions (e.g., "in `ClassName.methodName()`" or "in the collision response section") instead of line numbers
- **Reason**: Line numbers become stale quickly as code evolves. General references remain useful even as files change
- **When to use specific references**: File paths and function/class names are acceptable since they're more stable

### Examples

❌ **Avoid**:
- `[collide.wgsl:72](../src/verlet/shaders/collide.wgsl:72)`
- "Line 65-66 in collide.wgsl"
- "See line 100 in verlet.ts"

✅ **Prefer**:
- "`collide.wgsl` in the collision response calculation"
- "In the mass calculation section of `collide.wgsl`"
- "In `Verlet.initBuffers()` method"
- "In the `VerletBinComputer.compute()` loop"

## Contributing

When adding new documentation:
1. Use the next available numeric index
2. Use descriptive, lowercase filenames with underscores
3. Update the Index section in this README
4. Include clear sections: Context, Analysis, Recommendations, and Implementation (if applicable)
5. **Use general code references** that won't become stale over time
6. Reference functions, classes, and code sections rather than specific line numbers