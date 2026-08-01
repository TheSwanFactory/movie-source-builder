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

## Render

Each fal image-to-video shot must declare exactly one explicit PNG, JPEG, WebP, or AVIF path in its `references` array. Pack the source and render it with any fal profile:

That explicit shot reference is the **only image uploaded for the request**. Character, location, and prop `reference` fields are not composited and are not separately sent to fal. For a multi-character shot, create one canonical image containing the complete cast and setting, then place its path in `shot.references`:

```json
{
  "characters": ["agent-86", "agent-99", "agent-13"],
  "location": "ai-control-center",
  "references": ["references/control-center-ensemble.png"]
}
```

Do not use an isolated prop, location plate, or single-character sheet as the shot reference when the generated frame must contain an ensemble.

```bash
msb pack path/to/source --out movie.msb
msb validate movie.msb --config msbc/fal-hailuo-02-standard.msbc
msb render movie.msb \
  --config msbc/fal-hailuo-02-standard.msbc \
  --out movie.msbo \
  --max-cost 1.00
```

Use `--dry-run` first to inspect planned requests and estimated cost without uploading assets or calling fal.

Configured validation and every render preflight verify that each fal shot has exactly one explicit reference, that its extension is supported, that its bytes match the declared raster format, that the model adapter is registered, and that the shot duration is supported. Failure occurs before authentication, pricing, upload, or generation.

Each shot is currently an independent image-to-video request. `continuity` is added to the prompt, but the renderer does not pass the last frame of one shot into the next. Reusing a canonical ensemble image and stating concrete identity invariants improves consistency but does not guarantee it. Read the complete [MSB authoring and continuity guide](../docs/msb-authoring.md) before a paid render.

## Engine profiles

- [`fal-hailuo-02-standard.msbc`](fal-hailuo-02-standard.msbc)
- [`fal-veo-3.1-fast.msbc`](fal-veo-3.1-fast.msbc)
- [`fal-ltx-2.3-fast.msbc`](fal-ltx-2.3-fast.msbc)

Each profile links to its current official model documentation in the [engine configuration index](README.md).
