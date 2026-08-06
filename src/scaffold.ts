import { copyFile, mkdir, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { toJson } from "./project.js";

export const PROJECT_DIRECTORIES = [
  "drafts",
  "references",
  "shotlists",
  "takes",
  "shoots",
  "dailies",
  "cuts",
] as const;

const PROJECT_GITIGNORE = `# Take media and cut movies are the only large, regenerable binaries;
# everything else in a project folder is small, diffable, and worth tracking.
takes/*.mp4
cuts/
`;

export interface CreateResult {
  root: string;
  draft: string;
}

/**
 * Scaffold a v2 project folder and copy the author's draft screenplay in
 * verbatim — whatever its name and format. The tool never parses a draft; a
 * Producer canonicalizes it into screenplay.json, and `msb ingest` gates the
 * result.
 */
export async function createProject(
  folder: string,
  draftFile: string,
): Promise<CreateResult> {
  const root = path.resolve(folder);
  const existing = await stat(root).catch(() => null);
  if (existing !== null) {
    if (!existing.isDirectory()) throw new Error(`not a directory: ${folder}`);
    const entries = await readdir(root);
    if (entries.length > 0) throw new Error(`folder is not empty: ${folder}`);
  }
  const draftInfo = await stat(draftFile).catch(() => null);
  if (!draftInfo?.isFile())
    throw new Error(`draft is not a file: ${draftFile}`);
  await mkdir(root, { recursive: true });
  for (const directory of PROJECT_DIRECTORIES)
    await mkdir(path.join(root, directory), { recursive: true });
  const draftName = path.basename(draftFile);
  const draft = `drafts/${draftName}`;
  await copyFile(draftFile, path.join(root, "drafts", draftName));
  const projectId = path
    .basename(root)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[^a-z0-9]+/, "");
  await writeFile(
    path.join(root, "msb.json"),
    toJson({
      formatVersion: "2.0.0",
      project: {
        id: projectId || "project",
        title: path.basename(root),
      },
      cast: [],
    }),
  );
  await writeFile(
    path.join(root, "references", "references.json"),
    toJson({ formatVersion: "2.0.0", images: [] }),
  );
  await writeFile(path.join(root, ".gitignore"), PROJECT_GITIGNORE);
  return { root, draft };
}
