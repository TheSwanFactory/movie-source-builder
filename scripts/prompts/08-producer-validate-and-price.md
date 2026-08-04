---
step: 8
role: producer
---

# Validate and price

Run:

```bash
msb validate movie.msb --config <engine.msbc>
msb render movie.msb --config <engine.msbc> --dry-run
```

Confirm zero validation errors and that the estimated cost is acceptable before proceeding.
