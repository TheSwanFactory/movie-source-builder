# Quickstart

Read [Authoring Movie Source Bundles](msb-authoring.md) before creating or paying to render a source bundle. In particular, entity reference sheets are not automatically sent to the provider: each fal-rendered shot needs exactly one explicit raster in `shot.references` showing the complete intended opening composition.

```bash
npm install
npm run build
node dist/cli.js pack examples/skit-poc --out sample.msb
node dist/cli.js validate sample.msb
node dist/cli.js render sample.msb --config msbc/mock.msbc --out sample.msbo --dry-run
node dist/cli.js render sample.msb --config msbc/mock.msbc --out sample.msbo
node dist/cli.js export sample.msbo --out sample.mp4
```
