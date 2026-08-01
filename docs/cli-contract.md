# CLI Contract

```text
msb validate <bundle.msb> [--config <config.msbc>]
msb inspect <bundle.msb|config.msbc|output.msbo> [--json]
msb verify-auth [--config <config.msbc>] [--json]
msb render <bundle.msb> [--config <config.msbc>] [--out <output.msbo>] [--dry-run] [--work-dir <path>]
           [--concurrency <n>] [--max-cost <usd>] [--force] [--keep-work-dir]
msb export <output.msbo> --out <movie.mp4> [--force]
msb make <bundle.msb> [--config <config.msbc>] [--out <movie.mp4>] [render options]
```

When `--out` is omitted, `render` writes `build/<msb>-<msbc>/<timestamp>/output.msbo`; `make` writes `output.msbo` and `movie.mp4` in that directory. An explicit path remains stable for resume/cache reuse.

When `--config` is omitted, the packaged `msbc/default.msbc` is used.

`validate` always checks the manifest schema, referenced-file presence, unique entity and shot IDs, entity relationships, dialogue cast membership, and dialogue timing. With `--config`, it also applies the selected renderer's input contract without authenticating, pricing, uploading, or generating. For example:

```bash
msb validate movie.msb --config msbc/fal-hailuo-02-standard.msbc
```

Render and make perform the same renderer-input preflight before credentials, pricing, work-directory creation, uploads, or provider requests.

`verify-auth` resolves the configuration, checks its declared environment variables, and asks the renderer adapter to verify credentials without submitting a generation request. It never prints credential values.

Exit codes: `0` success, `2` usage, `3` validation, `4` credentials, `5` cost limit, `6` provider/render, `7` media/export, `130` interrupted.
