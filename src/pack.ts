import path from "node:path";
import { writeArchiveFromDirectory } from "./archive.js";
import { ingestProject } from "./project.js";

/** Ledger and output paths excluded by --source-only packs. */
const OUTPUT_PREFIXES = ["takes/", "shoots/", "dailies/", "cuts/"];

/**
 * Pack a project folder into a transport `.msb` archive. The archive is a
 * format optimization, not the format: every operation works against the
 * folder, and packing is only for transport or pinning. The project is
 * ingest-validated first so a packed snapshot is always a valid project.
 */
export async function packProject(
  folder: string,
  output: string,
  options: { sourceOnly?: boolean } = {},
): Promise<void> {
  await ingestProject(path.resolve(folder));
  await writeArchiveFromDirectory(folder, output, {
    exclude: (name) =>
      path.basename(name) === ".DS_Store" ||
      (options.sourceOnly === true &&
        OUTPUT_PREFIXES.some((prefix) => name.startsWith(prefix))),
  });
}
