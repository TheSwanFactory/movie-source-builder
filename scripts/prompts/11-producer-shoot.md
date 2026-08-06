---
step: 11
role: producer
---

# Shoot

Run:

```bash
msb shoot <folder> --config <engine.msbc> --max-cost <usd>
```

Set `--max-cost` to the dry-run estimate plus a small margin. Takes land in `takes/` (media plus extracted last frame), and the shoot is appended to `shoots/` as one JSON linking the shot list and engine hashes, reused takes, new takes, findings, and costs. Unchanged shots reuse earlier takes automatically; pass `--fresh` only when you deliberately want new draws of everything.

If the shoot fails, the ledger entry records what happened — report the findings and take errors rather than deleting anything.
