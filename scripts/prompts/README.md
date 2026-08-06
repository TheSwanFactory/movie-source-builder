# Prompts

A numbered sequence driving the end-to-end quick-start loop (see
[`docs/01-quick-start.md`](../../docs/01-quick-start.md)), meant to be fed to
an orchestrator running two agents — **Author** and **Producer** — until a
movie is done. Every file in this directory is part of the sequence; there
are no separate, un-numbered steps. See
[`docs/03-prompt-architecture.md`](../../docs/03-prompt-architecture.md) for
how these files, the scripts that read them, and image-generating vs.
non-image-generating agents are meant to interact.

Two of these files (the model-sheet and board templates, steps 4 and 5) are
also read directly (and hashed for provenance) by
`scripts/generate-storyboard-prompts.mjs`, which strips each file's
frontmatter before embedding its instruction, verbatim, into the generated
reference-image request plan for a project folder. That mechanism is
independent of the orchestrator protocol below — it doesn't change how those
files are discovered or dispatched as steps.

## Orchestrator protocol

1. Discover the numbered files directly in this directory and sort them by
   their leading number, or by the `step` value in each file's frontmatter —
   both give the same order. Don't hardcode a count or a specific set of
   names; read whatever is present.
2. Each numbered file starts with frontmatter identifying its `step` and
   `role` (`author` or `producer`), followed by the literal prompt to hand to
   that role's agent.
3. Keep exactly two persistent agents for the whole run — one Author, one
   Producer — and reuse the same one across every step tagged for that role,
   rather than spinning up a fresh one per step. Later steps depend on earlier
   context (a review step needs to know what an earlier step intended).
4. Dispatch steps in order by default. Advance to the next numbered file only
   once the current step is done (see rule 7 for the non-linear exception):
   - For a **producer** step, done means the command(s) or generation task it
     specifies completed successfully and produced the artifact the step
     describes.
   - For an **author** step, done means the agent has delivered its actual
     output for that step (a script, a review decision, a sign-off) — not
     just acknowledged the prompt.
5. Stop when there is no next numbered file after the one that just
   completed. There is no separate "finished" signal to look for.
6. A step's own instructions take precedence over its number's default
   framing — e.g. an asset-generation step may need to run once per
   character, location, or shot rather than once for the whole movie; read
   what the step actually says, not just its title.
7. Dispatch is only linear on the happy path. A review step (any `author`
   step whose job is to check earlier work — reference images, storyboard,
   finished cut) can come back with "revise," not just "approved." When it
   does, its own text says what to redo and how far back to go — jump the
   cursor there instead of advancing to the next number. Re-run a producer
   step narrowly, for only the shots/characters/locations actually flagged,
   not the whole movie, unless the step's instructions say otherwise. This
   includes splitting one shot into several when a renderer needs more
   keyframes than a single reference image can honestly represent (see the
   reference-image review step): treat the resulting new shots as newly
   inserted work items that still need their own reference-image generation
   and review before the sequence can proceed to packing.
