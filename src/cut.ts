import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { execa } from "execa";
import ffmpegStatic from "ffmpeg-static";
import {
  currentTake,
  flattenShots,
  hash,
  latestCompleteShoot,
  listDailies,
  listShoots,
  loadShotlist,
  resolveInside,
  takeStandings,
  type LedgerTake,
} from "./project.js";

export interface CutResult {
  file: string;
  shootId: string;
  takes: Array<{ shot: string; take: string }>;
}

/**
 * Assemble a deliverable cut from the pool: for each shot in the realized
 * shoot's shot list, the circled take if one exists, else the newest
 * rendered, never-rejected take. Verifies every take's media hash against
 * the ledger and never contacts a provider.
 */
export async function createCut(
  root: string,
  options: { shootId?: string; out?: string } = {},
): Promise<CutResult> {
  const ffmpeg = ffmpegStatic as unknown as string | null;
  if (!ffmpeg) throw new Error("bundled ffmpeg is unavailable");
  const shoots = await listShoots(root);
  const target =
    options.shootId !== undefined
      ? shoots.find((record) => record.shoot.shoot.id === options.shootId)
      : await latestCompleteShoot(root, shoots);
  if (!target)
    throw new Error(
      options.shootId !== undefined
        ? `no such shoot: ${options.shootId}`
        : "no complete shoot to cut; run msb shoot first",
    );
  const { shotlist, shotlistHash } = await loadShotlist(
    root,
    target.shoot.shotlist.id,
  );
  if (shotlistHash !== target.shoot.shotlist.hash)
    throw new Error(
      `shot list ${target.shoot.shotlist.id} changed after shoot ${target.shoot.shoot.id} cited it; shot lists are immutable once shot`,
    );
  const standings = takeStandings(await listDailies(root));
  const chosen: Array<{ shot: string; take: LedgerTake }> = [];
  for (const shot of flattenShots(shotlist)) {
    const take = currentTake(shot.id, shoots, standings);
    if (!take)
      throw new Error(
        `cannot cut: shot ${shot.id} has no circled or unrejected rendered take`,
      );
    chosen.push({ shot: shot.id, take });
  }
  const outputFile = options.out
    ? path.resolve(options.out)
    : resolveInside(root, `cuts/${target.shoot.shoot.id}.mp4`);
  await mkdir(path.dirname(outputFile), { recursive: true });
  const list = `${outputFile}.concat-${process.pid}.txt`;
  try {
    const lines: string[] = [];
    for (const { shot, take } of chosen) {
      const media = take.media ?? `takes/${take.take}.mp4`;
      const absolute = resolveInside(root, media);
      const bytes = await readFile(absolute).catch(() => null);
      if (bytes === null)
        throw new Error(`missing take media for shot ${shot}: ${media}`);
      if (take.mediaHash !== undefined && hash(bytes) !== take.mediaHash)
        throw new Error(`take media hash mismatch: ${media}`);
      lines.push(`file '${absolute.replaceAll("'", "'\\''")}'`);
    }
    await writeFile(list, `${lines.join("\n")}\n`);
    await execa(ffmpeg, [
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
    await rm(list, { force: true });
  }
  return {
    file: outputFile,
    shootId: target.shoot.shoot.id,
    takes: chosen.map(({ shot, take }) => ({ shot, take: take.take })),
  };
}
