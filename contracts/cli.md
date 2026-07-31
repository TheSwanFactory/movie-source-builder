# CLI Contract

```text
msb validate <bundle.msb>
msb inspect <bundle.msb|output.mso> [--json]
msb render <bundle.msb> --out <output.mso> [--dry-run] [--work-dir <path>]
           [--concurrency <n>] [--max-cost <usd>] [--force] [--keep-work-dir]
           [--provider mock|fal]
msb export <output.mso> --out <movie.mp4> [--force]
msb make <bundle.msb> --out <movie.mp4> [render options]
```

Exit codes: `0` success, `2` usage, `3` validation, `4` credentials, `5` cost limit, `6` provider/render, `7` media/export, `130` interrupted.
