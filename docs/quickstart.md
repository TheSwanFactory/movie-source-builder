# Quickstart

```bash
npm install
npm run build
node dist/cli.js pack examples/compound-interest --out sample.msb
node dist/cli.js validate sample.msb
node dist/cli.js render sample.msb --config msbc/mock.msbc --out sample.msbo --dry-run
node dist/cli.js render sample.msb --config msbc/mock.msbc --out sample.msbo
node dist/cli.js export sample.msbo --out sample.mp4
```
