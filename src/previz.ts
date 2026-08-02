import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execa } from "execa";
import ffmpeg from "ffmpeg-static";
import { readArchive, writeArchive } from "./archive.js";
import { exportMovie } from "./export.js";
import { hash, loadMsb, renderMovie, type RenderOptions } from "./render.js";
import { msboOutputSchema, type MsboOutput } from "./schema.js";

export interface PrevizOptions extends Omit<RenderOptions, "kind"> {
  storyboard?: string;
}

async function approvedStoryboardHash(
  file: string,
  sourceHash: string,
): Promise<string> {
  const entries = await readArchive(file);
  const raw = entries.get("msbo.json");
  if (!raw) throw new Error("storyboard msbo.json is required");
  const output = msboOutputSchema.parse(JSON.parse(raw.toString()));
  if (output.kind !== "storyboard" || !output.storyboard)
    throw new Error("--storyboard requires a storyboard .msbo");
  if (output.source.hash !== sourceHash)
    throw new Error("storyboard is stale: source hash changed");
  const approval = output.storyboard.approval;
  if (!approval)
    throw new Error("storyboard must be approved before previz generation");
  if (approval.creativeInputHash !== output.storyboard.creativeInputHash)
    throw new Error("storyboard approval is stale: creative inputs changed");
  const artifactHash = hash(
    JSON.stringify({
      movie: output.storyboard.movieHash,
      contactSheet: output.storyboard.contactSheetHash,
      panels: output.shots.map((shot) => shot.mediaHash),
    }),
  );
  if (artifactHash !== approval.artifactHash)
    throw new Error("storyboard approval is stale: artifact hashes changed");
  const artifacts = [
    [output.storyboard.movie, output.storyboard.movieHash],
    [output.storyboard.contactSheet, output.storyboard.contactSheetHash],
    ...output.shots.flatMap((shot) => [
      [shot.panelPath ?? shot.mediaPath, shot.panelHash ?? shot.mediaHash],
      [shot.timingAudioPath, shot.timingAudioHash],
    ]),
  ] as Array<[string | undefined, string | undefined]>;
  for (const [name, expected] of artifacts) {
    const bytes = name ? entries.get(name) : undefined;
    if (!name || !expected || !bytes || hash(bytes) !== expected)
      throw new Error(`storyboard artifact hash mismatch: ${name}`);
  }
  return approval.artifactHash;
}

export async function createPreviz(
  source: string,
  options: PrevizOptions,
): Promise<Awaited<ReturnType<typeof renderMovie>>> {
  const loaded = await loadMsb(source);
  const storyboardHash = options.storyboard
    ? await approvedStoryboardHash(options.storyboard, loaded.sourceHash)
    : undefined;
  const plan = await renderMovie(source, { ...options, kind: "previz" });
  if (options.dryRun) return plan;

  const ffmpegPath = ffmpeg as unknown as string | null;
  if (!ffmpegPath) throw new Error("bundled ffmpeg is unavailable");
  const work = await mkdtemp(path.join(tmpdir(), "msb-previz-"));
  try {
    const rawMovie = path.join(work, "raw.mp4");
    const reviewMovie = path.join(work, "previz.mp4");
    await exportMovie(options.output, rawMovie);
    await execa(ffmpegPath, [
      "-y",
      "-i",
      rawMovie,
      "-vf",
      "drawbox=x=0:y=0:w=iw:h=54:color=black@0.70:t=fill,drawtext=text='PREVIZ — NOT PRODUCTION':x=(w-text_w)/2:y=14:fontsize=24:fontcolor=white",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "copy",
      "-map_metadata",
      "-1",
      reviewMovie,
    ]);
    const entries = await readArchive(options.output);
    const raw = entries.get("msbo.json");
    if (!raw) throw new Error("previz msbo.json is required");
    const output = msboOutputSchema.parse(JSON.parse(raw.toString()));
    const movie = await readFile(reviewMovie);
    const moviePath = "previz/previz.mp4";
    entries.set(moviePath, movie);
    const creativeInputHash = hash(
      JSON.stringify({
        sourceHash: output.source.hash,
        storyboardHash,
        configurationHash: output.configuration.hash,
        providerInputs: output.shots.map((shot) => shot.providerInputHash),
        outputs: output.shots.map((shot) => shot.mediaHash),
      }),
    );
    output.previz = {
      movie: moviePath,
      movieHash: hash(movie),
      storyboardHash,
      creativeInputHash,
      nonProduction: true,
    };
    output.warnings.push(
      "Previz is non-production output; identity, composition, audio, and continuity require human review.",
    );
    output.updatedAt = new Date().toISOString();
    entries.set(
      "msbo.json",
      Buffer.from(`${JSON.stringify(output, null, 2)}\n`),
    );
    await writeArchive(entries, options.output);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
  return plan;
}

export async function approvePreviz(
  file: string,
  source: string,
): Promise<void> {
  const entries = await readArchive(file);
  const raw = entries.get("msbo.json");
  if (!raw) throw new Error("msbo.json is required");
  const output: MsboOutput = msboOutputSchema.parse(JSON.parse(raw.toString()));
  if (output.kind !== "previz" || !output.previz)
    throw new Error("previz approval requires a previz .msbo");
  if ((await loadMsb(source)).sourceHash !== output.source.hash)
    throw new Error(
      "previz approval invalid: source or creative inputs changed",
    );
  const movie = entries.get(output.previz.movie);
  if (!movie || hash(movie) !== output.previz.movieHash)
    throw new Error("previz approval invalid: review movie hash mismatch");
  for (const shot of output.shots) {
    const media = shot.mediaPath ? entries.get(shot.mediaPath) : undefined;
    if (!media || hash(media) !== shot.mediaHash)
      throw new Error(
        `previz approval invalid: artifact hash mismatch: ${shot.mediaPath}`,
      );
  }
  const artifactHash = hash(
    JSON.stringify({
      movie: output.previz.movieHash,
      shots: output.shots.map((shot) => shot.mediaHash),
    }),
  );
  output.previz.approval = {
    approvedAt: new Date().toISOString(),
    creativeInputHash: output.previz.creativeInputHash,
    artifactHash,
  };
  output.updatedAt = output.previz.approval.approvedAt;
  entries.set("msbo.json", Buffer.from(`${JSON.stringify(output, null, 2)}\n`));
  await writeArchive(entries, file);
}

export async function validateApprovedPreviz(
  file: string,
  source: string,
): Promise<void> {
  const entries = await readArchive(file);
  const raw = entries.get("msbo.json");
  if (!raw) throw new Error("approved previz msbo.json is required");
  const output = msboOutputSchema.parse(JSON.parse(raw.toString()));
  if (output.kind !== "previz" || !output.previz?.approval)
    throw new Error("production requires an approved previz .msbo");
  if ((await loadMsb(source)).sourceHash !== output.source.hash)
    throw new Error(
      "approved previz is stale: source or creative inputs changed",
    );
  if (
    output.previz.approval.creativeInputHash !== output.previz.creativeInputHash
  )
    throw new Error("approved previz is stale: creative-input hash changed");
  const movie = entries.get(output.previz.movie);
  if (!movie || hash(movie) !== output.previz.movieHash)
    throw new Error("approved previz is stale: review movie hash changed");
  const artifactHash = hash(
    JSON.stringify({
      movie: output.previz.movieHash,
      shots: output.shots.map((shot) => shot.mediaHash),
    }),
  );
  if (artifactHash !== output.previz.approval.artifactHash)
    throw new Error("approved previz is stale: artifact hashes changed");
  for (const shot of output.shots) {
    const media = shot.mediaPath ? entries.get(shot.mediaPath) : undefined;
    if (!media || hash(media) !== shot.mediaHash)
      throw new Error(
        `approved previz is stale: artifact hash changed: ${shot.mediaPath}`,
      );
  }
}
