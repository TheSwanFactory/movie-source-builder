# movie-source-builder

`movie-source-builder` is the npm package for portable, inspectable AI movie builds. Its executable is `msb`, and its pipeline is:

```text
source folder → Movie Source Bundle (.msb) + Configuration (.msbc) → Builder Output (.msbo) → movie (.mp4)
```

- `.msb` is immutable creative source: structured shots, screenplay, characters, locations, props, and reference assets.
- `.msbc` is content-independent engine configuration: renderer provider/model, required environment-variable names, and technical output settings. It is JSON and never contains credential values.
- `.msbo` is self-contained builder output: generated scenes and audio, rendering notes, hashes, configuration snapshot, costs, status, and provenance.
- `.mp4` is a repeatable delivery export. Export never calls an AI provider.

## Install and use

Requires Node.js 24 or later. FFmpeg is bundled; Homebrew, apt, and a system FFmpeg are not required.

Install from npm:

```bash
npm install -g movie-source-builder
```

The global installation exposes `msb` directly:

```bash
msb --help
```

Or install locally in a project:

```bash
npm install movie-source-builder
```

Run a project-local installation with `npx`:

```bash
npx msb --help
```

To develop this repository from source:

```bash
npm install
npm run build

node dist/cli.js pack examples/compound-interest --out compound-interest.msb
node dist/cli.js validate compound-interest.msb
node dist/cli.js inspect compound-interest.msb
node dist/cli.js inspect msbc/mock.msbc
node dist/cli.js render compound-interest.msb --config msbc/mock.msbc --out compound-interest.msbo --dry-run
node dist/cli.js render compound-interest.msb --config msbc/mock.msbc --out compound-interest.msbo
node dist/cli.js inspect compound-interest.msbo
node dist/cli.js export compound-interest.msbo --out compound-interest.mp4
```

The package is available on npm at `https://www.npmjs.com/package/movie-source-builder`.

Without `--out`, each invocation writes to a gitignored, timestamped build directory:

```text
build/<msb-name>-<msbc-name>/<UTC-timestamp>/
├── output.msbo
└── movie.mp4  # `msb make` only
```

For example, `msb render source.msb --config msbc/mock.msbc` writes `output.msbo` under `build/source-mock/<timestamp>/`. `msb make` writes both artifacts there. The CLI prints the resolved paths, including during dry runs.

Pass an explicit `--out` when a stable path is useful for cache reuse or resuming: `msb make source.msb --config render.msbc --out movie.mp4` retains `movie.msbo` beside the MP4.

`--config` is also optional. When omitted, the CLI loads its packaged [`msbc/default.msbc`](msbc/default.msbc), which inherits the cheapest configured paid engine. Pass `--config msbc/mock.msbc` for a provider-free render.

## Containers and schemas

An `.msb` is ZIP-compatible and begins with `msb.json`. It can include `screenplay.md`, `characters/`, `locations/`, `props/`, `audio/`, and `references/`. The manifest contains creative project metadata, stable entities, and ordered generation-sized shots. A source folder is packed into this portable container with `msb pack`.

An `.msbc` is a JSON document validated independently from the source. It defines a reusable rendering engine and cannot contain style, character, voice, shot, duration, or other content-specific instructions. Configurations may inherit another `.msbc` through a safe relative `extends` path, allowing output formats and engines to be composed. `renderer.requiredEnvironmentVariables` lists the environment-variable names that must be present before the renderer is called; their values remain outside every artifact. The same engine configuration can render any compatible `.msb`.

An `.msbo` is ZIP-compatible. It contains `msbo.json`, `source/msb.json`, the effective `configuration.msbc`, and generated `shots/`. Each shot records a deterministic cache key, content hash, status, provider/model/request identity, attempts, timestamps, and estimated/actual cost. The output records hashes for both its source bundle and configuration.

Generated schemas are published under [`schemas/`](schemas/) after `npm run build`.

Ready-to-use mock, Hailuo 02 Standard, Veo 3.1 Fast, and LTX 2.3 Fast engine profiles are documented under [`msbc/`](msbc/README.md). The three paid profiles use the fal adapter and require `FAL_KEY`; the mock profile stays entirely local.

Design context, implementation planning, contracts, and other project notes are collected under [`docs/`](docs/README.md).

## Safety and cost controls

Archive reads reject absolute paths, traversal, links, duplicate normalized entries, oversized entries, excessive entry counts, and excessive expansion. All referenced assets and entity IDs are verified before rendering.

`--dry-run` plans work without provider requests. It reports missing renderer environment variables without exposing their values. `--max-cost <usd>` rejects a render before new work begins if its estimated cost is too high. Cache keys include the shot, complete engine configuration, and referenced asset hashes. Render state is checkpointed atomically in the work directory after every completed shot.

Credentials are read only from the environment by provider adapters and must never be stored in source, configuration, output, reports, caches, or logs. The CLI loads a repository-local `.env` when present. The mock and fal renderers share the same validated, resumable output path; automated tests use only the mock renderer and never submit paid requests.

Verify credentials through the selected engine adapter without submitting a generation request:

```bash
msb verify-auth --config msbc/fal-hailuo-02-standard.msbc
# or verify the packaged default configuration
msb verify-auth
```

The command resolves inherited configuration, checks every declared environment variable, and never prints credential values. Successful fal authentication does not by itself guarantee model access, balance, or quota.

## Example

[`examples/compound-interest`](examples/compound-interest) contains “The Marshmallow Investment”: two stable sock puppets, one location, a prop, timed alternating dialogue, continuity constraints, and three 10-second shots. Placeholder SVG references are safe to redistribute.

[`examples/smoke-test.msb`](examples/smoke-test.msb) is a provider-ready single-shot bundle for testing engine configurations. See the [`msbc` authoring and testing guide](msbc/README.md).

## Development

```bash
npm run format
npm run lint
npm run typecheck
npm test
npm run build
npm run smoke
# all CI-equivalent checks
npm run check
```

The complete check validates and resolves every runnable `.msbc`, dry-runs each profile against the checked-in smoke-test `.msb`, independently validates representative `.msb`, `.msbc`, and `.msbo` documents against the published JSON Schemas, exercises the mock `.msb → .msbo → .mp4` pipeline, and rejects stale generated schemas.

## Publishing

Merges to `main` run [`.github/workflows/publish.yml`](.github/workflows/publish.yml). The workflow verifies the package and publishes the version in `package.json` when that version does not already exist on npm. It uses npm trusted publishing through GitHub OIDC; no long-lived `NPM_TOKEN` is required.

Configure the npm trusted publisher with:

- Organization or user: `TheSwanFactory`
- Repository: `movie-source-builder`
- Workflow filename: `publish.yml`
- Allowed action: `npm publish`

The release job uses a GitHub-hosted runner, Node.js 24, npm 11.5.1 or later, and `id-token: write`. Trusted publishing automatically attaches provenance for eligible public packages. Increment `package.json` before merging a release that should publish a new version.

Tests use only the mock renderer, which synthesizes tiny valid H.264/AAC clips with the bundled FFmpeg. They never submit paid requests.

## fal rendering

See [`msbc/README.fal.md`](msbc/README.fal.md) for API-key setup, authentication verification, source-reference requirements, dry runs, and real rendering commands. `ffmpeg-static` redistributes platform binaries; downstream distributors should review its GPL/LGPL licensing notes for their chosen build.

Release history is maintained in the [`CHANGELOG`](CHANGELOG.md).

MIT licensed.
