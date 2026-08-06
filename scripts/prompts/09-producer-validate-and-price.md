---
step: 9
role: producer
---

# Validate and price

Run:

```bash
msb validate build/movie.msb --config <engine.msbc>
msb render build/movie.msb --config <engine.msbc> --dry-run
```

Confirm zero validation errors and that the estimated cost is acceptable before proceeding.
