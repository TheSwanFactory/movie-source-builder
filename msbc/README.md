# Engine Configurations

Reusable Movie Source Builder Configuration (`.msbc`) profiles:

| Configuration                                                | Renderer                                                                                                 | Environment | Status       |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- | ----------- | ------------ |
| [`mock.msbc`](mock.msbc)                                     | Local FFmpeg mock                                                                                        | None        | Supported    |
| [`fal-hailuo-02-standard.msbc`](fal-hailuo-02-standard.msbc) | [MiniMax Hailuo 02 Standard](https://fal.ai/models/fal-ai/minimax/hailuo-02/standard/image-to-video/api) | `FAL_KEY`   | Catalog only |
| [`fal-veo-3.1-fast.msbc`](fal-veo-3.1-fast.msbc)             | [Veo 3.1 Fast](https://fal.ai/models/fal-ai/veo3.1/fast/image-to-video/api)                              | `FAL_KEY`   | Catalog only |
| [`fal-ltx-2.3-fast.msbc`](fal-ltx-2.3-fast.msbc)             | [LTX 2.3 Fast](https://fal.ai/models/fal-ai/ltx-2.3/image-to-video/fast/api)                             | `FAL_KEY`   | Catalog only |

“Catalog only” means the configuration is schema-valid and ready for its adapter, but this release intentionally rejects paid providers. Only `mock.msbc` can currently render.

Configurations define engines, never content. They may specify technical output properties, renderer identity, and required environment-variable names. Do not add projects, prompts, styles, characters, voices, shots, durations, environment-variable values, or credentials.
