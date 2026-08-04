---
step: 6
role: producer
---

# Render

Run:

```bash
msb render movie.msb --config <engine.msbc> --out movie.msbo --max-cost <usd>
```

Set `--max-cost` to the dry-run estimate plus a small margin.
