# Changelog

All notable changes to this project are documented in this file.

## [0.6.0] - 2026-08-04

### Added

- Added opt-in shot chaining (Tier A, #11): a shot's `chainFrom: <earlier-shot-id>` field chains it to an earlier shot in the same manifest. `image-to-video` only; the shot must still author its own `references.composition`, which chaining verifies against rather than replaces.
- Added `src/chain.ts`: `extractLastFrame` (ffmpeg) pulls a rendered shot's last frame; `compareFrameSimilarity` (ffmpeg SSIM, scaled to a common size first) scores it against another image in `[0, 1]`.
- At render time, once a chained shot's predecessor completes, its last frame is compared against the chained shot's own authored composition. A close match (`CHAIN_SIMILARITY_THRESHOLD`, currently `0.6`) promotes the real extracted frame as the actual render input in place of the authored still; a miss fails the shot with a message naming the shot, predecessor, and measured score. There is no silent fallback and no automatic retry — a producer edits the predecessor or the shot and reruns.
- Chained cache keys fold the predecessor's already-computed cache key into their own hash, so `msb render --dry-run` resolves and prices a chain with zero provider requests, and an authored change to a predecessor correctly cascades to everything chained after it.
- Chained rendering serializes correctly under concurrency: a worker holding a chained shot polls its predecessor's status rather than racing ahead, while unrelated shots keep parallelizing under `--concurrency`.

### Changed

- The mock renderer never consumes `references.composition`, so chained mock shots wait for ordering but skip the similarity check entirely; the real gate only runs on the `fal` path.
- Documented shot chaining's design, implementation, and known limitations (a deterministic pixel/structural heuristic, not semantic drift detection; Tier B and previz remain proposed) in `docs/CONTRIBUTING.md` and `docs/01-quick-start.md`.

### Validation

- Added unit and integration coverage for chaining: unknown/self/forward-referencing `chainFrom`, a chained shot with no authored composition, chaining under `reference-to-video`, cache-key cascade on a predecessor's content change, correct ordering under concurrency with the mock provider, and resuming a completed chain without hanging.
- Manual, cost-capped smoke test with the mock provider confirmed correct dependency ordering end to end via the built CLI.

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
- Ran a manual, cost-capped Veo 3.1 Fast reference-to-video render of the Agent Autonomy skit. Identity (color/badge) held across all three independently-generated shots. The held-still collapse shot initially failed — characters rose and spoke, with an extra hallucinated puppet — because reference-to-video has no starting-frame anchor for a static pose; rewriting that shot's `action`/`continuity` to lead with the no-movement constraint fixed it on retry. Documented this honestly in `msb-authoring.md`.

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
