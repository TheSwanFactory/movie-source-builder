import { writeFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { execa } from "execa";
import ffmpeg from "ffmpeg-static";
import { readArchive } from "./archive.js";
import { hash } from "./render.js";
import { msboOutputSchema } from "./schema.js";

export async function exportMovie(
  input: string,
  outputFile: string,
): Promise<void> {
  const ffmpegPath = ffmpeg as unknown as string | null;
  if (!ffmpegPath) throw new Error("bundled ffmpeg is unavailable");
  const entries = await readArchive(input);
  const raw = entries.get("msbo.json");
  if (!raw) throw new Error("msbo.json is required");
  const output = msboOutputSchema.parse(JSON.parse(raw.toString()));
  if (output.kind === "storyboard")
    throw new Error(
      "storyboard outputs already contain a review MP4; use inspect to locate it",
    );
  if (
    output.status !== "complete" ||
    output.shots.some((shot) => shot.status !== "complete")
  )
    throw new Error("cannot export an incomplete .msbo");
  const work = path.resolve(`${outputFile}.export-${process.pid}`);
  await mkdir(work, { recursive: true });
  try {
    const lines: string[] = [];
    for (const shot of output.shots) {
      const bytes = entries.get(shot.mediaPath!);
      if (!bytes) throw new Error(`missing generated asset: ${shot.mediaPath}`);
      if (hash(bytes) !== shot.mediaHash)
        throw new Error(`generated asset hash mismatch: ${shot.mediaPath}`);
      const file = path.join(work, `${shot.id}.mp4`);
      await writeFile(file, bytes);
      lines.push(`file '${file.replaceAll("'", "'\\''")}'`);
    }
    const list = path.join(work, "concat.txt");
    await writeFile(list, `${lines.join("\n")}\n`);
    await mkdir(path.dirname(path.resolve(outputFile)), { recursive: true });
    await execa(ffmpegPath, [
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      list,
      "-c",
      "copy",
      "-map_metadata",
      "-1",
      outputFile,
    ]);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
