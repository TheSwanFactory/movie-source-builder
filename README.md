# movie-source-builder

`movie-source-builder` is the npm package for portable, inspectable AI movie
projects. Its executable is `msb`, and its production loop runs against **one
project folder** — screenplay, references, shot lists, and every take ever
rendered, as an append-only, inspectable ledger:

```text
draft screenplay → canonical screenplay + boards → animatic → shot list → shoots (takes) → dailies → cut (.mp4)
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
  loop end to end: creating a project, canonicalizing the screenplay,
  boards and the animatic, shooting, dailies, and the cut.
- **[Adding a provider](docs/02-adding-providers.md)** — registering a new fal
  model or a new renderer provider entirely.
- **[Prompt architecture](docs/03-prompt-architecture.md)** — how the numbered
  prompts, the scripts that read them, and image-generating vs.
  non-image-generating agents are meant to interact.
- **[MSB format v2](docs/04-msb-format.md)** — the project-folder format
  design: the ledgers, retention model, and every schema.
- **[Contributing](docs/CONTRIBUTING.md)** — repository layout, project
  invariants, technical decisions, development workflow, and open design work.
- **[fal rendering setup](msbc/README.fal.md)** and **[engine configurations](msbc/README.md)**
  — API-key setup and the ready-to-use Hailuo/Veo/LTX profiles.

Release history is maintained in the [`CHANGELOG`](CHANGELOG.md).

MIT licensed.
