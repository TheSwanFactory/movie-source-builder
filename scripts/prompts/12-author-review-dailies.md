---
step: 12
role: author
---

# Review the dailies

Run:

```bash
msb dailies <folder>
```

Watch each unreviewed take against original creative intent: identity, continuity, pacing. `msb inspect <folder> --shot <id>` shows a shot's full take history across engines when you need context.

Record a verdict for every take you review:

```bash
msb circle <folder> --take <shot>.<tNN>            # the keeper for its shot
msb circle <folder> --take <shot>.<tNN> --reject --notes <file>
```

For a rejection, write the reasoning in the notes file — name the defect concretely (what violates the shot's own continuity, versus a stylistic difference) so a later session can tell them apart; it lands beside the frames as `takes/<take>.notes.md`. A shot whose takes are all rejected goes back to the Producer: revise the shot's prompts or references in the next shot-list version, or reshoot with a different engine.
