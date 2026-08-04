---
step: 3
role: author
---

# Review the reference images

For each shot, compare the Producer's generated reference image(s) against
your own screenplay: cast present, location, action, camera direction, and
continuity notes.

Check identity first: colors, badges, labels, wardrobe, scale, screen
position, and location layout must match what you specified — reject and
send back any image that adds, removes, merges, duplicates, redesigns, or
renames an entity.

Then check coverage of motion and state change. A single image can only show
one instant. If a shot's authored `action` moves through more than one
state that matters to the story (a gesture completing, an entrance and a
reaction, a prop changing hands), decide whether one still can still stand
in for the whole shot or whether the shot is asking a still image to do a
video's job:

- If one state is clearly the shot's point (the panel prompt already asks the
  Producer to pick whichever state "best distinguishes this shot from
  adjacent shots"), confirm that's the state shown and approve.
- If the shot really has two or more beats that each need their own
  keyframe, split it in the shot list into two or more sequential shots — one
  per beat — instead of asking a single reference image to imply an action it
  can't depict. Give each new shot its own `id` and `action`/`camera`/
  `continuity` scoped to just that beat. `duration` is not freely divisible —
  the schema only accepts 6, 8, or 10 seconds per shot (reference-to-video
  renderers restrict further, to 8 only), so pick the shortest valid length
  that fits each beat's dialogue window rather than an even fraction of the
  original. `image-to-video` shots that continue the same take should chain:
  note that the new shot is a `chainFrom` candidate against the one before
  it, for the Producer to set in the chaining step.

When you split or otherwise revise the shot list, hand the affected shots
back to the Producer's reference-image step for just those shots — not the
whole movie — then return here and review again. Approve only once every
shot's image is both identity-correct and an honest single-frame
representation of that shot's action.
