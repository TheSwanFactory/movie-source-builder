---
step: 13
role: producer
---

# Cut

Run:

```bash
msb cut <folder>
```

This assembles the deliverable from the pool — each shot's circled take, else its newest never-rejected rendered take — verifies every hash, writes `cuts/<shoot>.mp4`, and never contacts a provider. If it fails naming a shot, that shot has no eligible take: send it back to dailies review or reshoot.

The movie is done.
