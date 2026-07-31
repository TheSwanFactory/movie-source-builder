# Changelog

All notable changes to this project are documented in this file.

## [0.2.0] - 2026-07-31

### Added

- Added the content-independent Movie Source Builder Configuration (`.msbc`) format for renderer provider/model, required environment-variable names, and technical output settings.
- Added generated JSON schemas for `.msbc` configuration and `.msbo` output documents.
- Added configuration inspection and an example render configuration.
- Added an `msbc/` catalog with mock, MiniMax Hailuo 02 Standard, Veo 3.1 Fast, and LTX 2.3 Fast engine profiles.
- Added fal key setup and authentication guidance for the fal engine profiles.
- Added real fal rendering with asset upload, model-specific request mapping, output download and normalization, request provenance, and resumable failure state.
- Added a provider-ready six-second smoke-test bundle and an MSBC authoring and testing guide.
- Embedded the effective configuration and its hash in every builder output for reproducibility.

### Changed

- **Breaking:** Renamed Movie Source Output (`.mso`) to Movie Source Builder Output (`.msbo`).
- **Breaking:** Rendering now requires `--config <file.msbc>`; provider selection moved from CLI flags into configuration.
- **Breaking:** Removed rendering and delivery settings from `.msb` manifests so bundles contain only creative source and assets.
- `.msbc` rejects style, duration, voice, shot, and other content-specific fields and validates required environment-variable names without storing their values.
- Updated schemas, CLI contracts, examples, tests, and documentation for the three-format pipeline.

[0.2.0]: https://github.com/TheSwanFactory/movie-source-builder/releases/tag/v0.2.0
