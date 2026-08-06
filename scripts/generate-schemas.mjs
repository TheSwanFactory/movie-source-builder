import { mkdir, writeFile } from "node:fs/promises";
import { format } from "prettier";
import { z } from "zod";
import {
  dailiesSchema,
  msbHeaderSchema,
  msbcFileSchema,
  referencesIndexSchema,
  screenplaySchema,
  shootSchema,
  shotlistSchema,
} from "../dist/schema.js";

await mkdir("schemas", { recursive: true });
const writeSchema = async (file, schema) =>
  writeFile(
    file,
    await format(JSON.stringify(z.toJSONSchema(schema)), { parser: "json" }),
  );

await writeSchema("schemas/msb-header.schema.json", msbHeaderSchema);
await writeSchema("schemas/msb-screenplay.schema.json", screenplaySchema);
await writeSchema("schemas/msb-references.schema.json", referencesIndexSchema);
await writeSchema("schemas/msb-shotlist.schema.json", shotlistSchema);
await writeSchema("schemas/msb-shoot.schema.json", shootSchema);
await writeSchema("schemas/msb-dailies.schema.json", dailiesSchema);
await writeSchema("schemas/msbc-configuration.schema.json", msbcFileSchema);
