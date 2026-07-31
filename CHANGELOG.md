# Changelog

All notable changes to this project are documented in this file.

## [0.2.0] - 2026-07-31

### Added

- Added the content-independent Movie Source Builder Configuration (`.msbc`) format for renderer provider/model, required environment-variable names, and technical output settings.
- Added generated JSON schemas for `.msbc` configuration and `.msbo` output documents.
- Added configuration inspection and reusable engine configurations.
- Added mock, MiniMax Hailuo 02 Standard, Veo 3.1 Fast, and LTX 2.3 Fast profiles under `msbc/`.
- Added fal key setup and authentication guidance for the fal engine profiles.
- Added real fal rendering with asset upload, model-specific request mapping, output download and normalization, request provenance, and atomic failure checkpoints.
- Added a provider-ready six-second smoke-test bundle and an MSBC authoring and testing guide.
- Added gitignored timestamped default outputs under `build/<msb>-<msbc>/`, while preserving explicit stable output paths for resume and reuse.
- Added MSBC inheritance, reusable output-format profiles, `version` naming, and an optional CLI configuration that defaults to the cheapest configured paid engine.
- Embedded the effective configuration and its hash in every builder output for reproducibility.

### Changed

- **Breaking:** Renamed Movie Source Output (`.mso`) to Movie Source Builder Output (`.msbo`).
- **Breaking:** Provider selection moved from CLI flags into `.msbc`; `--config` is optional and resolves to the packaged `default.msbc` when omitted.
- **Breaking:** Removed rendering and delivery settings from `.msb` manifests so bundles contain only creative source and assets.
- `.msbc` rejects style, duration, voice, shot, and other content-specific fields and validates required environment-variable names without storing their values.
- Updated schemas, CLI contracts, examples, tests, and documentation for the three-format pipeline.

[0.2.0]: https://github.com/TheSwanFactory/movie-source-builder/releases/tag/v0.2.0
