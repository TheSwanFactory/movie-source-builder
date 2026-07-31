# Technical Decisions

## Package and executable identity

**Decision:** Publish `movie-source-builder` with an `msb` binary.  
**Rationale:** The repository/package describes the product; the short binary names the artifact workflow.  
**Alternatives considered:** Renaming the repository to `msb` or `sockstage`, which obscures discovery and conflicts with the clarified identity.

## Container handling

**Decision:** Treat `.msb` and `.msbo` as ZIP containers but validate all central-directory entries before reading payloads. Treat `.msbc` as a separately validated JSON configuration.
**Rationale:** Portable and inspectable while permitting traversal, duplicate, link, and expansion defenses.  
**Alternatives considered:** Directory-only formats and custom binary containers.

## Output lifecycle

**Decision:** Build output in a work directory with atomic JSON checkpoints, then package a self-contained `.msbo`.
**Rationale:** ZIP mutation is poorly suited to durable incremental state; atomic workspace state provides clean recovery.  
**Alternatives considered:** Rewriting the archive after every shot.

## Media runtime

**Decision:** Bundle FFmpeg and keep provider calls outside export.  
**Rationale:** Repeatable installs and re-encoding without cost or credentials.  
**Alternatives considered:** System FFmpeg and provider-side stitching.
