# Engine Configurations

Reusable Movie Source Builder Configuration (`.msbc`) profiles:

| Configuration                                                | Renderer                                                                                                 | Environment | Status    |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- | ----------- | --------- |
| [`mock.msbc`](mock.msbc)                                     | Local FFmpeg mock                                                                                        | None        | Supported |
| [`previz-mock.msbc`](previz-mock.msbc)                       | Local FFmpeg non-production previz mock                                                                  | None        | Supported |
| [`fal-hailuo-02-standard.msbc`](fal-hailuo-02-standard.msbc) | [MiniMax Hailuo 02 Standard](https://fal.ai/models/fal-ai/minimax/hailuo-02/standard/image-to-video/api) | `FAL_KEY`   | Supported |
| [`fal-veo-3.1-fast.msbc`](fal-veo-3.1-fast.msbc)             | [Veo 3.1 Fast](https://fal.ai/models/fal-ai/veo3.1/fast/image-to-video/api)                              | `FAL_KEY`   | Supported |
| [`fal-ltx-2.3-fast.msbc`](fal-ltx-2.3-fast.msbc)             | [LTX 2.3 Fast](https://fal.ai/models/fal-ai/ltx-2.3/image-to-video/fast/api)                             | `FAL_KEY`   | Supported |

[`default.msbc`](default.msbc) inherits the cheapest configured paid engine, currently Hailuo 02 Standard. The CLI uses this packaged configuration when `--config` is omitted.

Previz always requires an explicit configuration. Use `previz-mock.msbc` for provider-free tests; it is never selected as a production default.

Reusable output profiles live under [`formats/`](formats/). Engine configurations inherit a compatible output profile instead of repeating dimensions and frame rate.

All fal profiles use the same `FAL_KEY`. See [fal renderer setup](README.fal.md) for key creation, safe configuration, authentication testing, and rendering commands.

Configurations define engines, never content. They may specify technical output properties, renderer identity, and required environment-variable names. Do not add projects, prompts, styles, characters, voices, shots, durations, environment-variable values, or credentials.

## Write a configuration

Create a descriptively named `.msbc` file in this directory:

```json
{
  "version": "1.0.0",
  "extends": "formats/landscape-720p-24fps.msbc",
  "renderer": {
    "provider": "fal",
    "model": "fal-ai/provider/model/image-to-video",
    "requiredEnvironmentVariables": ["FAL_KEY"]
  }
}
```

- `version` identifies the `.msbc` schema, not the renderer version.
- `extends` optionally names another `.msbc` relative to the current file. Parent output and renderer fields are merged first, then child fields override them. Cycles and unsafe paths are rejected.
- `output` defines the normalized MP4 dimensions, aspect ratio, and frame rate. Choose values supported by the engine.
- `renderer.provider` selects the adapter. This release supports `mock` and `fal`.
- `renderer.model` is the provider's exact endpoint identifier.
- `requiredEnvironmentVariables` contains names only. Use uppercase POSIX environment names, list each once, and never store values.

The schema is [`schemas/msbc-configuration.schema.json`](../schemas/msbc-configuration.schema.json). Base files may define only reusable output or renderer fields; the fully resolved configuration must contain both. The top-level object is strict, so content-specific or misspelled fields are rejected.

For a new fal endpoint, confirm that its official API accepts `prompt` and `image_url`. If its duration, resolution, aspect-ratio, frame-rate, or audio fields differ from the existing engines, add its mapping to `falInput` in [`src/render.ts`](../src/render.ts) and cover the mapping in [`test/render.test.ts`](../test/render.test.ts).

## Smoke-test a configuration

[`examples/smoke-test.msb`](../examples/smoke-test.msb) is a ready-to-render bundle with one six-second shot and one 16:9 PNG reference. Its unpacked source is under [`examples/smoke-test/`](../examples/smoke-test/).

First validate the configuration and bundle without provider calls:

```bash
msb inspect msbc/my-engine.msbc
msb validate examples/smoke-test.msb
msb render examples/smoke-test.msb \
  --config msbc/my-engine.msbc \
  --out smoke.msbo \
  --dry-run
```

The dry run loads live fal pricing but does not upload the image or submit a generation request. Review the estimate, then set an explicit ceiling for the real test:

```bash
msb render examples/smoke-test.msb \
  --config msbc/my-engine.msbc \
  --out smoke.msbo \
  --max-cost 1.00
msb inspect smoke.msbo
msb export smoke.msbo --out smoke.mp4
```

Finally run `npm test`. The schema suite discovers every `.msbc` file in this directory and rejects invalid profiles automatically.
