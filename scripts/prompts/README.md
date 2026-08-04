# Prompts

This directory holds two different kinds of canonical prompt:

- A **numbered sequence** driving the end-to-end quick-start loop
  (see [`docs/01-quick-start.md`](../../docs/01-quick-start.md)), meant to be
  fed to an orchestrator running two agents — **Author** and **Producer** —
  until a movie is done.
- **Unnumbered templates** for specific sub-tasks (e.g. generating reference
  imagery or timing audio), referenced by relative path from within whichever
  numbered step's prompt needs them. These aren't part of the sequence and
  aren't dispatched on their own.

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
4. Dispatch steps strictly in order. Advance to the next numbered file only
   once the current step is done:
   - For a **producer** step, done means the command(s) it specifies
     completed successfully and produced the artifact the step describes.
   - For an **author** step, done means the agent has delivered its actual
     output for that step (a script, a review decision, a sign-off) — not
     just acknowledged the prompt.
5. Stop when there is no next numbered file after the one that just
   completed. There is no separate "finished" signal to look for.
6. If a step's prompt references another file in this directory by path, that
   file is read and used by the agent handling that step, not by the
   orchestrator directly.
