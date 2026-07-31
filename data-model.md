# Data Model

## MovieSourceManifest

Version, project metadata, output settings, style, characters, locations, props, and ordered shots. Stable IDs are unique and every referenced path is relative and present.

## Shot

Stable ID, 6- or 10-second duration, character/location references, timed dialogue or narration, visual action, camera direction, asset references, continuity, and provider overrides.

## RenderPlanUnit

Shot identity, normalized provider inputs, deterministic cache key, reuse status, provider/model, estimated cost, and required credentials.

## MovieSourceOutput

Version, source identity/hash, tool version, normalized settings, status, timestamps, totals, and ordered shot results. Status moves from `rendering` to `complete` or `failed`; completed shots are immutable unless their cache key changes.

## ShotResult

Cache key, status, media path/hash, provider request provenance, estimated/actual cost, attempts, warnings, error, and timestamps.
