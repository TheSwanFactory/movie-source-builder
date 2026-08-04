---
step: 3
role: author
---

# Review the storyboard

Run:

```bash
msb storyboard movie.msb --out storyboard.msbo
msb inspect storyboard.msbo
```

Add `--timing-voices` (macOS) for disposable local narration, or generate temporary timing speech with an AI voice model using the canonical storyboard audio prompt template (`scripts/prompts/storyboard-audio.md`) per dialogue/narration event.

Watch the review MP4. Check whether cast, setting, shot order, and pacing match intent. Flag any shot whose reference image or continuity notes need revision before anything paid happens.
