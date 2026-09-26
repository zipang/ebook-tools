# Agent rules for scripts/

These rules take precedence over the rules of the parent directories.

- Keep every tool out of `src/` and out of the command-line interface. Put a finished experiment in this directory.
- Give every tool its own command-line entry point, guarded by `if (import.meta.main)`.
- Declare a JSDoc block for every function.
- Do not add a unit test for a one-off tool.
- Import the shared code from `src/`. Do not duplicate it.
- Add the tool to `package.json` only if a short command name helps.
