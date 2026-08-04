---
step: 11
role: producer
---

# Render

Run:

```bash
msb render build/movie.msb --config <engine.msbc> --out build/movie.msbo --max-cost <usd>
```

Set `--max-cost` to the dry-run estimate plus a small margin.
