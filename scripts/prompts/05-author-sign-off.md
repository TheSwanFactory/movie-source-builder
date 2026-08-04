---
step: 5
role: author
---

# Sign off

Run:

```bash
msb approve storyboard.msbo --source movie.msb
```

This records sign-off, hash-bound to the exact source — not an enforced gate (`msb render` doesn't check it). Treat it as your explicit go/no-go checkpoint before real spend.
