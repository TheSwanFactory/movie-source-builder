# CLI Contract

```text
msb validate <bundle.msb>
msb inspect <bundle.msb|config.msbc|output.msbo> [--json]
msb render <bundle.msb> [--config <config.msbc>] [--out <output.msbo>] [--dry-run] [--work-dir <path>]
           [--concurrency <n>] [--max-cost <usd>] [--force] [--keep-work-dir]
msb export <output.msbo> --out <movie.mp4> [--force]
msb make <bundle.msb> [--config <config.msbc>] [--out <movie.mp4>] [render options]
```

When `--out` is omitted, `render` writes `build/<msb>-<msbc>/<timestamp>/output.msbo`; `make` writes `output.msbo` and `movie.mp4` in that directory. An explicit path remains stable for resume/cache reuse.

When `--config` is omitted, the packaged `msbc/default.msbc` is used.

Exit codes: `0` success, `2` usage, `3` validation, `4` credentials, `5` cost limit, `6` provider/render, `7` media/export, `130` interrupted.
