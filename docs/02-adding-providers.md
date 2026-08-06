# Adding a Provider

A "provider" is a renderer adapter — today, `mock` (local, free, used by every
automated test) and `fal` (paid, real generation). Most new work in this area
is adding a **new fal model**, not a new provider from scratch; that's the
common path below. Adding a genuinely new provider (a different API entirely)
is the less common path at the end.

## The capability contract

Every renderer model is declared once, centrally, in `falModelCapabilities` in
[`src/render.ts`](../src/render.ts):

```ts
export interface RendererCapabilities {
  mode: "image-to-video" | "reference-to-video";
  roles: Partial<Record<ReferenceRole, ReferenceRoleLimits>>; // identity | composition | endFrame
  mediaTypes: readonly string[];
  durations: readonly number[];
  audio: boolean;
}
```

`.msbc` configuration declares `renderer.mode`; plan creation rejects a model
whose registered capabilities don't match that declared mode, and rejects any
shot whose `references` use an unsupported role or an out-of-range count for
that mode — all before credentials, pricing, upload, or generation. A shot
list whose spans fall outside the model's `durations` menu is not a hard
error but a plan-time `engine-compatibility` finding, recorded to the shoot
ledger. This is the single source of truth: nothing else in the codebase
decides what a shot is allowed to send a given renderer.

## Add a new fal model

1. **Confirm the official API contract.** Read the model's page at
   `https://fal.ai/models/<model-id>/api` — its exact endpoint identifier,
   required/optional inputs, accepted media types, supported durations, and
   whether it produces audio.
2. **Register its capabilities** in `falModelCapabilities`
   ([`src/render.ts`](../src/render.ts)): mode, accepted reference roles and
   their min/max counts, supported media types, supported durations, and audio
   support.
3. **Add its input mapping** — `falInput` for an `image-to-video` model,
   `falReferenceInput` for a `reference-to-video` model — so the adapter builds
   the correct request shape for that endpoint.
4. **Cover both the capability contract and the mapping** in
   [`test/renderer-contract.test.ts`](../test/renderer-contract.test.ts) and
   [`test/shoot.test.ts`](../test/shoot.test.ts). An unregistered model is
   always rejected during plan creation; a test should assert that rejection
   for at least one invalid shot, alongside the happy path.
5. **Write a `.msbc` profile** for it under [`msbc/`](../msbc/README.md). See
   that directory's own README for the mechanics of writing and inheriting
   configuration files — `renderer.provider`, `renderer.model`,
   `renderer.mode`, `requiredEnvironmentVariables`, and the `extends` chain for
   output settings.
6. **Smoke-test it** against the single-shot example projects
   (`examples/smoke-test` for `image-to-video`,
   `examples/smoke-test-reference` for `reference-to-video`) — dry-run
   first, then a real, cost-capped shoot. See
   [`msbc/README.md`](../msbc/README.md#smoke-test-a-configuration) for the
   exact commands.
7. `npm test` discovers every `.msbc` file in `msbc/` and rejects invalid
   profiles automatically — run it before opening a PR.

An unregistered model is always rejected during plan creation, before any
credentials, pricing, upload, or generation request — you cannot accidentally
ship a shot that reaches a provider with an unvalidated input shape.

## Add a genuinely new provider

`runShoot`'s worker loop in [`src/shoot.ts`](../src/shoot.ts) branches on
`configuration.renderer.provider === "fal"`, calling either `renderFalClip`
(real generation, applies live pricing, uploads references) or
`renderMockClip` (synthesizes a tiny valid H.264/AAC clip locally, zero
cost, no network) from [`src/render.ts`](../src/render.ts). A new provider
needs:

- Its own `render<Provider>Clip` function following that same contract: take
  the clip request and output path, produce a media file at that path,
  return a request identifier.
- Its own capability-registration structure analogous to
  `falModelCapabilities`, wired into `rendererCapabilities` and
  `validateShotReferences` so the same before-any-request preflight applies.
- Its own credential contract: declare required environment-variable names via
  `requiredEnvironmentVariables` in `.msbc`, verify them through `verify-auth`
  without submitting a generation request, and never persist or log a
  credential value — this is a hard project invariant, see
  [Contributing](CONTRIBUTING.md#project-invariants).
- Automated tests that exercise it without paid requests — the mock renderer
  exists specifically so CI never needs real credentials; a new provider should
  follow the same split between a free/local test double and the real adapter.
