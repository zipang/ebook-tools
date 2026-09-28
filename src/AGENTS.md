# Agent rules for src/

These rules take precedence over the rules of the parent directories.

## Layers

The dependency arrows point inward. A module may import from the layers below it, never from a layer above it.

| Layer | Location | Role | May import |
|---|---|---|---|
| Adapters | `src/cli.ts`, `src/commands/`, `src/server/`, `src/render/` | Parse input, call services, format output | `src/services/`, `src/translate/`, `src/extract/`, `src/model/`, `src/shared/` |
| Services | `src/services/`, `src/extract/`, `src/translate/` | Business logic, orchestration, validation | `src/model/`, `src/shared/` |
| Domain | `src/model/` | Data shapes, invariants, pure functions | `src/shared/` only |
| Shared | `src/shared/` | Errors, paths, sanitizing, reporting, templates, escaping, image sniffing | nothing internal |

A service never imports a file from `src/server/`, `src/render/`, or `src/commands/`.

## Services

A service function is a port for an adapter. It takes plain values and returns a plain result object. It does not read the clock, the network, the terminal, or the current directory for itself.

Forbidden inside a service:

- `process.cwd()` as a default parameter value. The caller must pass the root.
- `console.log`, `console.warn`, or any write to a stream. Return the information and let the adapter print it.
- `process.exit` or a change to `process.exitCode`. A CLI exit code is a CLI decision.
- A read of `process.env` that the caller did not pass in.

## Adapters

An adapter converts a request into arguments, calls one service, and converts the result into a response. An adapter holds no business rule.

To add a new front end, write a new adapter. Change no file under `src/model/`, `src/shared/`, `src/services/`, `src/extract/`, or `src/translate/`. If a change is required there, a service leaked an adapter concern.

## Domain

The files under `src/model/` hold data shapes, invariants, and pure functions. They perform no I/O. A function in this layer takes values and returns a value.

## Errors

- Signal a failure by throwing an `AppError` or a subclass from `src/shared/errors.ts`.
- Give every error a stable `code` that a caller can branch on.
- Never match on an error message string. The message is for humans and may change.

## Duplication

The same code in two files is a missing shared module. Put the shared function in the lowest layer that both callers may import.

- A helper with no domain knowledge goes in `src/shared/`.
- A helper that encodes a domain convention, such as a unit identifier, goes in `src/model/`.

## Bun

- Prefer a Bun built-in over an npm package. Use `Bun.file` over `readFile` and `Bun.write` over `writeFile`.
- Act and handle the error rather than checking existence first. Bun recommends this over a pre-check, because the pre-check costs an extra system call.
- `Bun.file(path).exists()` returns **false for a directory**. Use `Bun.file(path).stat().isDirectory()` when you need to know that a path is a directory.

## Tests

A test file sits beside the file it tests and carries the same base name. `src/services/document.ts` is tested by `src/services/document.test.ts`. Do not add a test file under `tests/`.

Write unit tests for the core services. A unit test constructs its inputs, calls the function, and asserts the returned value. Where a function must touch the filesystem, point it at a directory the test creates, and pass the path in. Where a function calls a model, inject the `ModelRunner` seam. No test starts a server, and no test drives the command line.

## Documentation

Declare a full JSDoc block for every function, including the private helpers. A block explains why the function exists and what it guarantees, not what its body does.
