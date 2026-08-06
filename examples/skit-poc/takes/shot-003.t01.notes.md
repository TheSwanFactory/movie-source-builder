# shot-003.t01 — agent review (claude, 2026-08-06)

Unjudged; diagnosis recorded for the Author's dailies pass.

- **The collapse itself reads**: three empty socks draped limp across the
  console, matching the board's composition and the "hands withdraw" beat.
- **Continuity violations**:
  - Badge corruption: the red sock reads "88" (should be 86) and the blue
    sock reads "16"/"1B" (should be 99); only green "13" survives. Violates
    "Agent 86 remains red with badge 86, Agent 99 blue with badge 99…".
  - Off-model socks: the collapsed socks gain gray heels and orange
    athletic-stripe toes not present in any model sheet.
  - A live puppeteer hand and forearm drift through the upper-left of the
    early frames *after* the withdrawal — the shot's whole premise is that
    the hands are gone.
- Chained from shot-002.t02's defective empty-console last frame, so the
  socks were re-invented by the model rather than carried over — the same
  identity-drift failure mode as the v1 "6 puppets" case, in the opposite
  direction.

Recommendation: respin with identity references or a stronger per-engine
prompt (the shot list's `prompts` map exists for exactly this).
