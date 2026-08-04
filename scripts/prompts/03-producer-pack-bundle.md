---
step: 3
role: producer
---

# Pack the bundle

Structure the author's screenplay into a Movie Source Bundle: write `msb.json` with `characters`/`locations`/`props`/`shots` matching the schema, referencing the reference images generated in the previous step — one isolated, neutral-backdrop image per character/location (no ensemble), plus one ensemble composition image per `image-to-video` shot, or identity sheets for `reference-to-video`.

Then run:

```bash
msb pack <folder> --out movie.msb
```
