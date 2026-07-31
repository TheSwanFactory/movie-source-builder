# CLI Contract

```text
msb validate <bundle.msb>
msb inspect <bundle.msb|config.msbc|output.msbo> [--json]
msb render <bundle.msb> --config <config.msbc> --out <output.msbo> [--dry-run] [--work-dir <path>]
           [--concurrency <n>] [--max-cost <usd>] [--force] [--keep-work-dir]
msb export <output.msbo> --out <movie.mp4> [--force]
msb make <bundle.msb> --config <config.msbc> --out <movie.mp4> [render options]
```

Exit codes: `0` success, `2` usage, `3` validation, `4` credentials, `5` cost limit, `6` provider/render, `7` media/export, `130` interrupted.
