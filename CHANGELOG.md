# Changelog

All notable changes to this project are documented in this file.

## [0.2.0] - 2026-07-31

### Added

- Added the content-independent Movie Source Builder Configuration (`.msbc`) format, including strict JSON Schema validation, safe inheritance, reusable output formats, environment-variable declarations, and packaged mock, Hailuo, Veo, and LTX profiles.
- Added production fal rendering with live pricing and cost limits, asset upload, model-specific requests, normalized output, provenance, and atomic failure checkpoints.
- Added a provider-ready smoke-test bundle plus guides for authoring, testing, and authenticating engine configurations.
- Added gitignored timestamped builds under `build/<msb>-<msbc>/<timestamp>/`; explicit output paths remain stable for reuse.

### Changed

- **Breaking:** Split the artifact model into creative source (`.msb`), content-independent engine configuration (`.msbc`), and reproducible builder output (`.msbo`, renamed from `.mso`). Their primary documents are now self-identifying as `msb.json` and `msbo.json`; rendering and delivery settings no longer belong to source manifests, and provider selection moved from CLI flags into an optional `--config` that defaults to the packaged Hailuo profile.
- Builder outputs now embed the resolved configuration and its hash, and dry runs plan every renderer without provider calls.
- Standardized development, CI, and publishing on Node.js 24 or later and consolidated project documentation under `docs/`.

### Validation

- CI validates every checked-in `.msbc`, resolves and dry-runs every runnable profile against the smoke-test `.msb`, independently checks all three published JSON Schemas, exercises the mock `.msb → .msbo → .mp4` pipeline, and rejects stale generated schemas.

## [0.1.0] - 2026-07-31

### Added

- Introduced the `msb` CLI with `pack`, `validate`, `inspect`, `render`, `export`, and `make` commands for the original `.msb → .mso → .mp4` workflow.
- Added versioned source/output schemas, safe ZIP-compatible artifact handling, deterministic render planning and cache keys, cost limits, atomic checkpoints, and bundled FFmpeg export.
- Added the local mock renderer, the compound-interest example, automated unit and end-to-end tests, and generated JSON Schemas.
- Added GitHub Actions quality checks and npm trusted publishing with GitHub OIDC provenance.

[0.2.0]: https://github.com/TheSwanFactory/movie-source-builder/releases/tag/v0.2.0
[0.1.0]: https://github.com/TheSwanFactory/movie-source-builder/releases/tag/v0.1.0
