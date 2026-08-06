---
step: 7
role: author
---

# Review the storyboard

Run:

```bash
msb storyboard build/movie.msb --out build/storyboard.msbo
msb inspect build/storyboard.msbo
```

Add `--timing-voices` (macOS) for disposable local narration, or hand the next
step's prompt to the Producer first to generate temporary timing speech with
an AI voice model instead.

Watch the review MP4. Check whether cast, setting, shot order, and pacing match intent. Flag any shot whose reference image or continuity notes need revision before anything paid happens — send it back to the reference-image review step, or further back to the script itself, rather than approving and moving on.
