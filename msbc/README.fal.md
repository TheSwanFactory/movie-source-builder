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

The fal Platform API can verify the key without submitting a generation request:

```bash
curl --fail-with-body \
  --get "https://api.fal.ai/v1/models" \
  --data-urlencode "limit=1" \
  --header "Authorization: Key $FAL_KEY"
```

A successful JSON response confirms authentication. It does not confirm that a particular model is enabled, funded, or callable for the account.

## Render

Each fal image-to-video shot must declare exactly one explicit PNG, JPEG, WebP, or AVIF path in its `references` array. Pack the source and render it with any fal profile:

```bash
msb pack path/to/source --out movie.msb
msb render movie.msb \
  --config msbc/fal-hailuo-02-standard.msbc \
  --out movie.msbo \
  --max-cost 1.00
```

Use `--dry-run` first to inspect planned requests and estimated cost without uploading assets or calling fal.

## Engine profiles

- [`fal-hailuo-02-standard.msbc`](fal-hailuo-02-standard.msbc)
- [`fal-veo-3.1-fast.msbc`](fal-veo-3.1-fast.msbc)
- [`fal-ltx-2.3-fast.msbc`](fal-ltx-2.3-fast.msbc)

Each profile links to its current official model documentation in the [engine configuration index](README.md).
