# Scripts

This directory holds one-off tools. These tools are not part of the shipped command-line interface. Their work is done, or their code is an experiment that we want to keep.

## benchmark-translate.ts

The tool compares candidate translation models on one extracted document. It calls each model once per unit, stores one translation per model, measures the time and the cost, and writes a review report for a human reviewer. The tool chose the default translation model (`gpt-6-luna`).

```bash
# Estimate the cost without calling a model
bun scripts/benchmark-translate.ts --document example-book --to fr --only 11 --dry-run

# Compare every candidate model on one unit
bun scripts/benchmark-translate.ts --document example-book --to fr --only 11
```

The tool writes `roadmap/T0002/benchmark.md` (review tables), `roadmap/T0002/benchmark.json` (raw rows), and the stored translations under `roadmap/T0002/benchmark-output/<model>/`.

## Conventions

- Run a tool with `bun scripts/<tool>.ts`.
- The tool imports the shared code from `src/`.
- A tool has no unit test. It is an experiment, not a shipped feature.
