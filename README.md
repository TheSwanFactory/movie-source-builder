# movie-source-builder

`movie-source-builder` is the npm package for portable, inspectable AI movie
builds. Its executable is `msb`, and its production pipeline is:

```text
source folder → Movie Source Bundle (.msb) + Configuration (.msbc) → Builder Output (.msbo) → movie (.mp4)
```

## Install

Requires Node.js 24 or later. FFmpeg is bundled; Homebrew, apt, and a system
FFmpeg are not required.

```bash
npm install -g movie-source-builder
msb --help
```

Or run it project-local with `npx msb --help`, or develop it from source:

```bash
npm install
npm run build
node dist/cli.js --help
```

The package is available on npm at `https://www.npmjs.com/package/movie-source-builder`.

## Documentation

- **[Quick start: producing a movie](docs/01-quick-start.md)** — the complete
  pipeline end to end: authoring a bundle, storyboard review, rendering, and
  export.
- **[Adding a provider](docs/02-adding-providers.md)** — registering a new fal
  model or a new renderer provider entirely.
- **[Contributing](docs/CONTRIBUTING.md)** — repository layout, project
  invariants, technical decisions, development workflow, and open design work.
- **[fal rendering setup](msbc/README.fal.md)** and **[engine configurations](msbc/README.md)**
  — API-key setup and the ready-to-use Hailuo/Veo/LTX profiles.

Release history is maintained in the [`CHANGELOG`](CHANGELOG.md).

MIT licensed.
