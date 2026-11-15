# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

A GPU-driven 2D Verlet particle simulation running in WebGPU compute shaders. Commands are in `package.json` scripts; `npm run dev` builds, watches and serves on port 8080.

## Where to look

- `docs/architecture.md`: read before designing or changing anything under `src/`. Modules, their interfaces, the particle layout and the compute pipeline order.
- `docs/testing.md`: read before writing or debugging a test, or to check a claim about behaviour by running it. The harness, and what can and cannot be asserted about a GPU simulation.
- `GLOSSARY.md`: the project's terms. Use them in code, tests and issues.
- `CODING_STANDARDS.md`: the rules a review enforces.

## Gotchas

- The build transpiles without type-checking. `npm run typecheck` is the only type check; it covers `src/` and `test/`.
- A pre-commit hook runs `npm run lint`, `npm run typecheck` and `npm test`. A failing commit means one of those failed. CI runs the same three with `NO_GPU` set, which skips the GPU tests.
- `.gitignore` ignores every `*.js` and `*.sh` file except `webpack.*`. Name new config and script files `.mjs` or `.ts`.
- There is no dev-server reload: refresh the page after webpack rebuilds.
- `lil-gui` is the global `lil`, loaded from a CDN `<script>` tag in `index.html`, not an npm dependency.
- In Git Bash, run Vitest from an upper-case drive letter path (`cd "C:/Users/..."`).
- Simulation runs without user input are identical run to run on one machine, but differ between machines (GPUs, browsers). Assert run-twice equality within one test, never stored exact positions; see `docs/testing.md`.

## Agent skills

### Issue tracker

Issues live in GitHub Issues for `GhostCrab/webgpu`, accessed with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five default triage labels are used unchanged: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root, created lazily. See `docs/agents/domain.md`.
