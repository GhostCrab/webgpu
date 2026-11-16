# Parallel work in worktrees

For several agents working at once, each in its own git worktree of this repo.

## Setting up a worktree

- Worktrees go under `.claude/worktrees/`, which git and ESLint ignore.
- A new worktree has no `node_modules`. Run `npm ci` in it first; that also enables the pre-commit hook there.
- Work only inside the worktree. The main checkout belongs to whoever is integrating.

## While working

- **Keep unfinished work in commits on the worktree's own branch.** `git stash` is one stack shared by every worktree of the repo, so one agent's stash lands in another's.
- **Refer to an issue as `#N` in a commit message, without a closing keyword.** `Closes #N` closes the issue when the commit reaches `main`, before anyone has decided the ticket is done. The integrator closes issues.
- **Report results; the integrator writes to the issue tracker.** When a ticket asks for a comment on an issue, hand back the text.
- **GPU timings taken while another agent uses the GPU are noisy.** Say so when reporting them, and re-run a benchmark alone before relying on it.

## Before reporting done

Merge the integration branch's tip into the worktree's branch, then run `npm run lint`, `npm run typecheck` and `npm test` on the result. Tests written before the merge can pass while meaning something else after it: re-read any test that calls an interface the merge changed.
