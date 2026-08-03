# Product Specification: Movie Source Builder

## Problem Statement

1. **Movie intent is not portable.** AI movie inputs are commonly trapped in prompts and provider-specific scripts, making them hard to inspect, share, or render elsewhere.
2. **Long renders are fragile and expensive.** Interrupted generation and untracked provider calls waste money and make results difficult to audit.
3. **Source and rendered output are conflated.** Creators need a clean boundary between immutable creative source, resumable generated media, and repeatable delivery encoding.
4. **Automation lacks a stable contract.** Coding agents and CI need schemas, deterministic validation, dry runs, cost limits, and stable exit behavior.

## User Scenarios & Testing

### Story 1 — Build and validate a source bundle (P1)

A creator or coding agent packages a screenplay, structured shots, character definitions, and source assets into a portable `.msb`, then validates and inspects it before any paid work.

Acceptance: a valid bundle reports metadata and referenced assets; unsafe archives, missing assets, invalid manifests, and unsupported major versions are rejected without provider calls.

### Story 2 — Plan and render safely (P1)

A creator selects a versioned `.msbc`, previews normalized work, credentials, cache reuse, and maximum estimated cost, then renders into a recoverable `.msbo` with bounded concurrency.

Acceptance: dry-run makes no paid requests; cost limits are enforced before scheduling; completed work is reusable; interruption leaves valid state.

### Story 3 — Export repeatedly (P1)

A creator exports a completed `.msbo` into a playable MP4 without contacting generation providers.

Acceptance: export verifies hashes, normalizes media, and produces the same delivery result for the same output and settings.

### Story 4 — Audit output (P2)

A creator inspects output status, failures, costs, retries, provider request IDs, and provenance.

Acceptance: all recorded data is machine-readable and excludes credentials.

## Edge Cases

- Archives containing absolute paths, traversal, links, duplicate normalized names, or excessive expansion.
- Provider-sized duration splitting, unsupported durations, missing credentials, a reference role unsupported by or out of count range for the configured renderer mode, a configured mode that does not match the model's registered capability, cancellation, retries, and partially completed state.
- Missing or tampered generated assets and export from incomplete output.

## Functional Requirements

- FR-001: The npm package is named `movie-source-builder` and exposes the `msb` executable.
- FR-002: The system validates versioned ZIP-compatible `.msb` and `.msbo` containers plus JSON `.msbc` configurations against published schemas.
- FR-003: The CLI provides `validate`, `inspect`, `render`, `export`, and `make` commands with stable nonzero failures.
- FR-004: Every source asset reference is relative, safe, present, and verified before generation.
- FR-005: Planning is deterministic, reports estimated cost and cache reuse, detects missing credentials, and supports a zero-cost dry run.
- FR-006: Rendering records hashes, settings, provenance, costs, retries, timestamps, and per-shot completion atomically.
- FR-007: A maximum cost is enforced before newly scheduled work can exceed it, including concurrent work.
- FR-008: Completed work is reusable by deterministic cache key and renders can resume after interruption.
- FR-009: Export never invokes an AI provider and rejects incomplete, missing, or tampered output.
- FR-010: Provider credentials never appear in bundles, configurations, output, reports, caches, or logs; `.msbc` records only required environment-variable names.
- FR-013: A `.msbc` describes a reusable rendering engine and contains no project, style, character, voice, shot, duration, or other content-specific fields.
- FR-011: A distributable 30-second, three-shot example demonstrates validation, planning, mocked rendering, and export.
- FR-012: Automated tests never issue paid requests.

## Key Entities

- **Movie Source Bundle**: immutable creative intent, manifest, screenplay, and source assets.
- **Movie Source Builder Configuration**: portable, content-independent engine definition with renderer identity, technical output settings, and required environment-variable names.
- **Shot**: stable generation-sized unit with timing, cast, location, dialogue, action, camera, references, and continuity.
- **Movie Source Builder Output**: self-contained generated media, effective configuration, and recoverable render state derived from a source bundle.
- **Render Plan**: normalized units, cache keys, estimated costs, requirements, and reuse decisions.
- **Provider Record**: provider/model, request ID, retry history, cost, timing, and hashes.

## Success Criteria

- SC-001: A user can validate and inspect the included example in under five seconds on a typical development machine.
- SC-002: Dry-run completes with zero provider requests and reports all planned units and estimated cost.
- SC-003: Killing and restarting a render reuses every previously completed valid unit.
- SC-004: A completed output can be exported repeatedly with zero provider requests.
- SC-005: All malicious archive fixtures are rejected before extraction outside the work area.
- SC-006: The complete quality suite and end-to-end mocked movie build pass in CI.

## Assumptions

- Version 1 targets coding agents and technically comfortable creators.
- Version 1 uses generation-sized shots and is not a screenplay compiler or nonlinear editor.
- One reference image per video request is supported initially; ambiguous multi-reference input fails clearly.
- Paid provider behavior is covered by contract tests plus an explicit manual smoke test.

## Out of Scope

GUI editing, screenplay compilation, local inference, a provider marketplace, and general-purpose nonlinear editing.
