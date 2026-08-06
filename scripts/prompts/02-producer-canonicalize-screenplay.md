---
step: 2
role: producer
---

# Create the project and canonicalize the screenplay

Create the project folder around the Author's draft, verbatim:

```bash
msb create <folder> --draft <the author's file>
```

Then write the canonical screenplay, `screenplay.json`, and fill `msb.json`'s cast. This is a judgment task, not a conversion: translate the draft's prose into cast ids, timed cues, and a declared total duration. Use point cues (`at`) for action beats and span cues (`span: [start, end]`) for dialogue and narration; give every cue a stable id; pace lines the draft left implicit so the whole piece fits the declared duration. Every speaker must be a cast member in `msb.json`; give each cast member a `modelSheet` path under `references/` (the image is generated in a later step) or flag it `needsModelSheet`.

Validate the result:

```bash
msb ingest <folder>
```

Fix anything it reports — unique monotonic cues within the duration, no same-speaker overlap, speakers resolving to cast — before handing to the Author for confirmation.
