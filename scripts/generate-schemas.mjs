import { mkdir, writeFile } from "node:fs/promises";
import { z } from "zod";
import { msbManifestSchema, msoOutputSchema } from "../dist/schema.js";

await mkdir("schemas", { recursive: true });
await writeFile(
  "schemas/msb-manifest.schema.json",
  JSON.stringify(z.toJSONSchema(msbManifestSchema), null, 2) + "\n",
);
await writeFile(
  "schemas/mso-output.schema.json",
  JSON.stringify(z.toJSONSchema(msoOutputSchema), null, 2) + "\n",
);
