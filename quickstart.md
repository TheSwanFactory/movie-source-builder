# Quickstart

```bash
npm install
npm run build
node dist/cli.js validate examples/compound-interest/compound-interest.msb
node dist/cli.js render examples/compound-interest/compound-interest.msb --out sample.mso --dry-run
node dist/cli.js render examples/compound-interest/compound-interest.msb --out sample.mso --provider mock
node dist/cli.js export sample.mso --out sample.mp4
```
