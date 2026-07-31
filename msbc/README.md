# Engine Configurations

Reusable Movie Source Builder Configuration (`.msbc`) profiles:

| Configuration                                                | Renderer                                                                                                 | Environment | Status                  |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- | ----------- | ----------------------- |
| [`mock.msbc`](mock.msbc)                                     | Local FFmpeg mock                                                                                        | None        | Supported               |
| [`fal-hailuo-02-standard.msbc`](fal-hailuo-02-standard.msbc) | [MiniMax Hailuo 02 Standard](https://fal.ai/models/fal-ai/minimax/hailuo-02/standard/image-to-video/api) | `FAL_KEY`   | Adapter not implemented |
| [`fal-veo-3.1-fast.msbc`](fal-veo-3.1-fast.msbc)             | [Veo 3.1 Fast](https://fal.ai/models/fal-ai/veo3.1/fast/image-to-video/api)                              | `FAL_KEY`   | Adapter not implemented |
| [`fal-ltx-2.3-fast.msbc`](fal-ltx-2.3-fast.msbc)             | [LTX 2.3 Fast](https://fal.ai/models/fal-ai/ltx-2.3/image-to-video/fast/api)                             | `FAL_KEY`   | Adapter not implemented |

The fal configurations are schema-valid, but this release does not implement their renderer adapter. Only `mock.msbc` can currently render.

All fal profiles use the same `FAL_KEY`. See [fal renderer setup](README.fal.md) for key creation, safe configuration, authentication testing, and the current adapter limitation.

Configurations define engines, never content. They may specify technical output properties, renderer identity, and required environment-variable names. Do not add projects, prompts, styles, characters, voices, shots, durations, environment-variable values, or credentials.
