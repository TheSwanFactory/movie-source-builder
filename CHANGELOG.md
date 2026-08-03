# Changelog

All notable changes to this project are documented in this file.

## [0.5.0] - 2026-08-03

### Added

- Added renderer-neutral, role-based shot references: `shots[].references` is now an object with `identity` (0-3 rasters), `composition` (one optional starting-frame raster), and `endFrame` (one optional ending-frame raster) roles, replacing the single untyped array.
- Added an explicit `renderer.mode` (`image-to-video` or `reference-to-video`) to `.msbc`, so the configuration selects a renderer capability independently of creative content.
- Added a shared renderer capability registry (`falModelCapabilities` in `src/render.ts`) that declares each fal model's mode, accepted reference roles and counts, supported durations, media types, and audio support; every future renderer or model must register capabilities there or plan creation rejects it.
- Added the `fal-ai/veo3.1/fast/reference-to-video` adapter and `msbc/fal-veo-3.1-fast-reference.msbc` profile: uploads one to three explicit raster identity references as `image_urls`, generates native audio, and only supports 8-second shots.
- Added `8` as a supported shot duration alongside `6` and `10`.
- Added `examples/smoke-test-reference.msb` and `examples/skit-poc-reference.msb`, reference-to-video counterparts of the existing image-to-video smoke test and Agent Autonomy skit fixtures.

### Changed

- Renderer input validation now enforces role-based reference counts and a `renderer.mode`/model capability match during plan creation, before credentials, pricing, upload, or generation — the prior "exactly one reference" rule is now `image-to-video`-specific.
- Updated `msb-authoring.md`, `data-model.md`, `specification.md`, `quickstart.md`, and the fal renderer guides for the new reference roles, `renderer.mode`, and Veo 3.1 Fast reference-to-video usage, while continuing to state honestly that no adapter passes frames or video context between independently generated shots.

### Validation

- Added contract tests covering valid inputs and every rejected reference-role shape (missing/extra/out-of-range roles, unsupported durations, `renderer.mode` mismatches, and unregistered fal models) for both renderer modes.

## [0.4.0] - 2026-08-01

### Added

- Added the provider-free `msb storyboard` workflow with deterministic local panels, timing audio, a contact sheet, a review MP4, complete source and artifact hashes, and typed storyboard metadata in `.msbo`.
- Added optional disposable macOS timing voices with authored dialogue and narration placement through `--timing-voices`.
- Added `msb approve` with immutable creative-input and artifact hash binding; changed sources or embedded artifacts invalidate approval.
- Added canonical, versioned storyboard image and timing-audio prompt templates plus a deterministic prompt-plan generator and strict shot-reference validation.
- Added three shot-specific skit reference images covering the upright, mid-collapse, and fully collapsed visual states.

### Changed

- `msb inspect` now reports storyboard kind, duration, warnings, and approval status.
- Builder outputs explicitly identify render or storyboard kind while retaining compatibility with existing `.msbo` files.
- `msb export` now directs storyboard outputs to their already-embedded review MP4.

### Validation

- Added offline storyboard, timing overflow, approval invalidation, canonical prompt hashing, strict duplicate-reference, stable ordering, and npm package-content coverage.
- Automated storyboard tests prohibit network calls and use no paid generation providers.

## [0.3.0] - 2026-08-01

### Added

- Replaced the compound-interest fixture with the Agent Autonomy practical sock-puppet skit POC, including canonical ensemble and entity reference assets.
- Added semantic MSB validation for unique identities, entity relationships, dialogue cast membership, and timing.
- Added renderer input contracts and fal preflight validation before authentication, pricing, uploads, or provider requests.
- Added an MSB authoring guide covering provider references, multi-character compositions, continuity limitations, and paid-render preflight.

### Changed

- `msb validate` now accepts `--config` to verify that a bundle satisfies the selected renderer's input requirements.
- Published schema descriptions now distinguish packaged entity assets from explicit shot provider inputs.

## [0.2.1] - 2026-07-31

### Fixed

- Updated package metadata and documentation for the 0.2.1 patch release.

## [0.2.0] - 2026-07-31

### Added

- Added the content-independent Movie Source Builder Configuration (`.msbc`) format, including strict JSON Schema validation, safe inheritance, reusable output formats, environment-variable declarations, and packaged mock, Hailuo, Veo, and LTX profiles.
- Added production fal rendering with credential verification, live pricing and cost limits, asset upload, model-specific requests, normalized output, provenance, and atomic failure checkpoints.
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

[0.4.0]: https://github.com/TheSwanFactory/movie-source-builder/releases/tag/v0.4.0
[0.3.0]: https://github.com/TheSwanFactory/movie-source-builder/releases/tag/v0.3.0
[0.2.1]: https://github.com/TheSwanFactory/movie-source-builder/releases/tag/v0.2.1
[0.2.0]: https://github.com/TheSwanFactory/movie-source-builder/releases/tag/v0.2.0
[0.1.0]: https://github.com/TheSwanFactory/movie-source-builder/releases/tag/v0.1.0
