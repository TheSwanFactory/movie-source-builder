# Quickstart

Read [Authoring Movie Source Bundles](msb-authoring.md) before creating or paying to render a source bundle. In particular, entity reference sheets are not automatically sent to the provider: each shot must explicitly list the rasters a renderer mode requires under `shot.references` — one `composition` raster showing the complete intended opening composition for `image-to-video` engines, or one to three `identity` rasters for `reference-to-video` engines such as Veo 3.1 Fast.

```bash
npm install
npm run build
node dist/cli.js pack examples/skit-poc --out sample.msb
node dist/cli.js validate sample.msb
node dist/cli.js render sample.msb --config msbc/mock.msbc --out sample.msbo --dry-run
node dist/cli.js render sample.msb --config msbc/mock.msbc --out sample.msbo
node dist/cli.js export sample.msbo --out sample.mp4
```
