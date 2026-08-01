# Data Model

## Movie Source Bundle (`.msb`)

ZIP-compatible immutable creative source containing `msb.json`, screenplay, characters, locations, props, references, and other source assets. Stable IDs are unique and every referenced path is relative and present.

## Movie Source Builder Configuration (`.msbc`)

Content-independent JSON engine definition containing its format version, technical output settings, renderer provider/model, and the names of environment variables required to call that renderer. It never references a project, style, character, voice, shot, or duration, and it contains no environment-variable values or credentials.

## Shot

Stable ID, 6- or 10-second duration, character/location references, timed dialogue or narration, visual action, camera direction, asset references, and continuity.

`characters` and `location` refer to manifest entities; their entity-level reference images are packaged source documentation and cache inputs. `references` is different: it is the explicit provider input for the shot. The current fal adapter accepts exactly one raster image and sends only that image as `image_url`. It does not composite entity references. See [Authoring Movie Source Bundles](msb-authoring.md).

`continuity` is prompt text. It does not lock identity or pass the previous shot's final frame into the next request; current video requests are independent.

## RenderPlanUnit

Shot identity, normalized provider inputs, deterministic cache key, reuse status, provider/model, estimated cost, and required credentials.

## Movie Source Builder Output (`.msbo`)

ZIP-compatible output containing version, source identity/hash, configuration hash and snapshot, tool version, normalized settings, rendering notes, status, timestamps, totals, generated media, and ordered shot results. Status moves from `rendering` to `complete` or `failed`; completed shots are immutable unless their cache key changes.

## ShotResult

Cache key, status, media path/hash, provider request provenance, estimated/actual cost, attempts, warnings, error, and timestamps.
