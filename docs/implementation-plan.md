# Implementation Plan: Movie Source Builder

## Technical Context

- Current Node.js LTS, ESM, strict TypeScript
- Commander CLI exposed as `msb`
- Zod schemas with generated JSON Schema
- Streaming ZIP reads and safe normalized entry validation
- `@fal-ai/client` behind narrow provider interfaces; mocked provider is the automated default
- Bundled `ffmpeg-static` executed with `execa`
- Vitest unit and end-to-end tests

## Constitution Check

- Package identity remains `movie-source-builder`; `msb` is the CLI and format.
- No provider secrets are persisted.
- No paid request occurs in tests, dry-run, validation, inspection, or export.
- Input archives are never trusted or extracted without complete entry validation.
- Render state is recoverable and written atomically.

## Project Structure

```text
src/cli/           command entry and error mapping
src/schema/        MSB/MSO schemas and public types
src/archive/       safe ZIP reader/writer
src/render/        planning, providers, cache, state
src/media/         FFmpeg normalization and export
examples/          distributable sample source
test/              unit and end-to-end coverage
schemas/           generated JSON Schemas
```

## Delivery Phases

1. Package and command contract.
2. Schemas and safe archives.
3. Deterministic planning and cost controls.
4. Mocked/provider rendering and atomic MSO state.
5. Provider-free FFmpeg export.
6. Example, documentation, and CI verification.

## Gates

- Formatting, lint, typecheck, tests, build, and CLI smoke test must pass.
- Sample must validate, dry-run at zero actual cost, render with mocks, export, and probe successfully.
- Real fal.ai generation remains an explicit manual operation requiring credentials.
