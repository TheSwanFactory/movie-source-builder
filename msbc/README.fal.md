# fal Renderer Setup

One `FAL_KEY` with API scope authenticates calls to all fal Model APIs, including the Hailuo, Veo, and LTX profiles in this directory. Actual calls are still subject to the fal account's model access, balance, quotas, and current model availability.

## Create a key

1. Sign in to the [fal dashboard](https://fal.ai/dashboard/keys).
2. Select the personal or team account that should own requests and billing.
3. Create a key with **API** scope. Admin scope is unnecessary for calling ready-to-use models.
4. Copy the key immediately; fal does not display it again.

See fal's official [authentication guide](https://fal.ai/docs/documentation/setting-up/authentication) for current details.

## Configure your shell

Set the key in the environment that launches Movie Source Builder:

```bash
export FAL_KEY="your-key"
```

Do not place the value in an `.msbc`, commit it, pass it as a CLI argument, or write it to logs. The engine profiles declare only the required variable name:

```json
"requiredEnvironmentVariables": ["FAL_KEY"]
```

To persist the key, use a shell startup file or secret manager appropriate to your environment. CI should inject it from the platform's encrypted secret store.

## Verify authentication without rendering

Movie Source Builder can verify the key through the configured renderer adapter without submitting a generation request:

```bash
msb verify-auth --config msbc/fal-hailuo-02-standard.msbc
```

Omit `--config` to verify the packaged default profile. A successful response confirms authentication. It does not confirm that a particular model is enabled, funded, or callable for the account. The command never prints the key.

## Shoot: image-to-video

Each `image-to-video` fal shot must declare exactly one explicit PNG, JPEG, WebP, or AVIF path as `references.composition` in the shot list.

That composition reference is the **only image uploaded for the request**. Cast model sheets are not composited and are not separately sent to fal. For a multi-character shot, use one board containing the complete cast and setting, then place its path in the shot's `references.composition`:

```json
{
  "characters": ["agent-86", "agent-99", "agent-13"],
  "location": "ai-control-center",
  "references": { "composition": "references/t0000.0-rally.png" }
}
```

Do not use an isolated prop, location plate, or single-character model sheet as the composition reference when the generated frame must contain an ensemble.

```bash
msb shoot path/to/project --config msbc/fal-hailuo-02-standard.msbc --dry-run
msb shoot path/to/project \
  --config msbc/fal-hailuo-02-standard.msbc \
  --max-cost 1.00
```

The dry run plans and estimates with zero provider requests and zero writes; the real shoot appends `shoots/NNNN-fal-hailuo-02-standard.json` and renders takes into `takes/`.

## Render: reference-to-video (Veo 3.1 Fast)

`fal-ai/veo3.1/fast/reference-to-video` generates a shot from **one to three** explicit raster identity references — typically one per recurring character — instead of a single composited opening frame. Declare them in `shot.references.identity`, and do not also declare `composition` or `endFrame`; this mode does not accept them:

```json
{
  "characters": ["agent-86", "agent-99", "agent-13"],
  "location": "ai-control-center",
  "span": [0, 8],
  "references": {
    "identity": [
      "references/agent-86.png",
      "references/agent-99.png",
      "references/agent-13.png"
    ]
  }
}
```

Veo 3.1 Fast reference-to-video only supports 8-second shots — a shot list whose spans are not all 8 seconds fails at plan time with a recorded `engine-compatibility` finding. Every identity image is uploaded and sent as `image_urls`; the endpoint generates native audio by default. See [`examples/smoke-test-reference`](../examples/smoke-test-reference) for a minimal example.

```bash
msb shoot path/to/project --config msbc/fal-veo-3.1-fast-reference.msbc --dry-run
msb shoot path/to/project \
  --config msbc/fal-veo-3.1-fast-reference.msbc \
  --max-cost 1.00
```

Uploading three faces to one request improves per-shot identity consistency over independently generated image-to-video shots, but it is still **not cross-shot continuity**: each shot remains an independent generation request. Reference-to-video does not extract or reuse the previous shot's final frame; read the honest continuity discussion in the [quick start guide](../docs/01-quick-start.md#designing-for-continuity-todays-real-limits) before a paid render.

## Preflight and failure ordering

Every shoot's plan checks the selected renderer's registered capabilities before doing anything paid: that the msbc-declared `renderer.mode` matches the model's registered mode, that every reference role provided by a shot is accepted by that mode with an in-range count, that every reference file extension is supported and its bytes match the declared raster format, and that the model adapter is registered. Any mismatch fails at plan creation — before authentication, pricing, upload, or generation. A shot list whose spans fall outside the engine's duration menu also fails at plan time, and that failure is itself recorded to the ledger as a shoot with a structured `engine-compatibility` finding (`msb inspect <folder> --findings`).

Each shot is an independent request regardless of mode, unless it opts into chaining (`chainFrom`, `image-to-video` only), which verifies the predecessor's real last frame against the shot's own composition board. `continuity` is added to the prompt; it is guidance, not an identity lock. Reusing consistent identity references or a canonical ensemble board, and stating concrete identity invariants in `continuity`, improves consistency but does not guarantee it. Read the [quick start](../docs/01-quick-start.md) before a paid shoot.

## Engine profiles

- [`fal-hailuo-02-standard.msbc`](fal-hailuo-02-standard.msbc)
- [`fal-veo-3.1-fast.msbc`](fal-veo-3.1-fast.msbc)
- [`fal-ltx-2.3-fast.msbc`](fal-ltx-2.3-fast.msbc)
- [`fal-veo-3.1-fast-reference.msbc`](fal-veo-3.1-fast-reference.msbc)

Each profile links to its current official model documentation in the [engine configuration index](README.md).
