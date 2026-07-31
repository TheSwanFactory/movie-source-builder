import { mkdir, writeFile } from "node:fs/promises";
import { format } from "prettier";
import { z } from "zod";
import {
  msbManifestSchema,
  msbcFileSchema,
  msboOutputSchema,
} from "../dist/schema.js";

await mkdir("schemas", { recursive: true });
const writeSchema = async (file, schema) =>
  writeFile(
    file,
    await format(JSON.stringify(z.toJSONSchema(schema)), { parser: "json" }),
  );

await writeSchema("schemas/msb-manifest.schema.json", msbManifestSchema);
await writeSchema("schemas/msbc-configuration.schema.json", msbcFileSchema);
await writeSchema("schemas/msbo-output.schema.json", msboOutputSchema);
