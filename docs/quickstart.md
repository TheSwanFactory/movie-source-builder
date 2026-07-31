# Quickstart

```bash
npm install
npm run build
node dist/cli.js validate examples/compound-interest/compound-interest.msb
node dist/cli.js render examples/compound-interest/compound-interest.msb --config examples/compound-interest.msbc --out sample.msbo --dry-run
node dist/cli.js render examples/compound-interest/compound-interest.msb --config examples/compound-interest.msbc --out sample.msbo
node dist/cli.js export sample.msbo --out sample.mp4
```
