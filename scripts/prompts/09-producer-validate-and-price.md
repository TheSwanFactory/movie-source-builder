---
step: 9
role: producer
---

# Validate and price

Run:

```bash
msb shoot <folder> --config <engine.msbc> --dry-run
```

This plans with zero provider requests and zero writes: it validates the shot list's tiling against the screenplay and against the engine's duration menu, resolves prompts and reuse, and prints the per-shot estimate. Confirm `planValid` is true (a false plan lists the engine-compatibility findings — fix the shot list's spans or pick another engine) and that the estimated cost is acceptable before proceeding.
