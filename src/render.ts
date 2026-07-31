import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { readArchive, writeArchive } from "./archive.js";
import {
  msbManifestSchema,
  msoOutputSchema,
  type MsbManifest,
  type MsoOutput,
} from "./schema.js";

export const DEFAULT_MODEL = "fal-ai/minimax/hailuo-02/standard/image-to-video";
const COST_PER_SECOND = 0.05;
export const hash = (value: Buffer | string) =>
  createHash("sha256").update(value).digest("hex");

export interface RenderPlanUnit {
  id: string;
  duration: 6 | 10;
  cacheKey: string;
  estimatedCost: number;
  reused: boolean;
}
export interface RenderPlan {
  manifest: MsbManifest;
  sourceHash: string;
  units: RenderPlanUnit[];
  estimatedCost: number;
}

export function referencedAssets(manifest: MsbManifest): string[] {
  return [
    ...new Set([
      ...(manifest.screenplay ? [manifest.screenplay] : []),
      ...manifest.characters.map((item) => item.reference),
      ...manifest.locations.flatMap((item) =>
        item.reference ? [item.reference] : [],
      ),
      ...manifest.props.flatMap((item) =>
        item.reference ? [item.reference] : [],
      ),
      ...manifest.shots.flatMap((item) => item.references),
    ]),
  ];
}

export async function loadMsb(file: string): Promise<{
  entries: Map<string, Buffer>;
  manifest: MsbManifest;
  sourceHash: string;
}> {
  const bytes = await readFile(file);
  const entries = await readArchive(file);
  const raw = entries.get("manifest.json");
  if (!raw) throw new Error("manifest.json is required");
  const manifest = msbManifestSchema.parse(JSON.parse(raw.toString("utf8")));
  for (const asset of referencedAssets(manifest))
    if (!entries.has(asset))
      throw new Error(`referenced asset is missing: ${asset}`);
  const characterIds = new Set(manifest.characters.map((item) => item.id));
  const locationIds = new Set(manifest.locations.map((item) => item.id));
  const shotIds = new Set<string>();
  for (const shot of manifest.shots) {
    if (shotIds.has(shot.id)) throw new Error(`duplicate shot id: ${shot.id}`);
    shotIds.add(shot.id);
    for (const id of shot.characters)
      if (!characterIds.has(id))
        throw new Error(`shot ${shot.id} references unknown character: ${id}`);
    if (shot.location && !locationIds.has(shot.location))
      throw new Error(
        `shot ${shot.id} references unknown location: ${shot.location}`,
      );
    for (const line of shot.dialogue)
      if (line.end > shot.duration)
        throw new Error(`dialogue exceeds shot ${shot.id} duration`);
  }
  return { entries, manifest, sourceHash: hash(bytes) };
}

export async function createPlan(
  file: string,
  previous?: MsoOutput,
): Promise<RenderPlan> {
  const loaded = await loadMsb(file);
  const completed = new Map(
    previous?.shots
      .filter((shot) => shot.status === "complete")
      .map((shot) => [shot.cacheKey, shot]) ?? [],
  );
  const units = loaded.manifest.shots.map((shot) => {
    const refs = referencedAssets({ ...loaded.manifest, shots: [shot] }).map(
      (name) => [name, hash(loaded.entries.get(name) ?? "")],
    );
    const cacheKey = hash(
      JSON.stringify({
        shot,
        refs,
        style: loaded.manifest.style,
        output: loaded.manifest.output,
        model: shot.provider?.model ?? DEFAULT_MODEL,
      }),
    );
    return {
      id: shot.id,
      duration: shot.duration,
      cacheKey,
      estimatedCost: shot.duration * COST_PER_SECOND,
      reused: completed.has(cacheKey),
    };
  });
  return {
    manifest: loaded.manifest,
    sourceHash: loaded.sourceHash,
    units,
    estimatedCost: units
      .filter((unit) => !unit.reused)
      .reduce((sum, unit) => sum + unit.estimatedCost, 0),
  };
}

async function atomicJson(file: string, value: unknown): Promise<void> {
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, file);
}

export interface RenderOptions {
  output: string;
  dryRun?: boolean;
  maxCost?: number;
  workDir?: string;
  force?: boolean;
}

export async function renderMock(
  source: string,
  options: RenderOptions,
): Promise<RenderPlan> {
  let previous: MsoOutput | undefined;
  let previousEntries: Map<string, Buffer> | undefined;
  try {
    previousEntries = await readArchive(options.output);
    const raw = previousEntries.get("output.json");
    if (raw) previous = msoOutputSchema.parse(JSON.parse(raw.toString()));
  } catch {
    previous = undefined;
  }
  const plan = await createPlan(source, previous);
  if (options.maxCost !== undefined && plan.estimatedCost > options.maxCost)
    throw new Error(
      `estimated cost $${plan.estimatedCost.toFixed(2)} exceeds --max-cost $${options.maxCost.toFixed(2)}`,
    );
  if (options.dryRun) return plan;
  const work = path.resolve(options.workDir ?? `${options.output}.work`);
  await mkdir(path.join(work, "shots"), { recursive: true });
  const now = new Date().toISOString();
  const output: MsoOutput = {
    formatVersion: "1.0.0",
    source: {
      hash: plan.sourceHash,
      projectId: plan.manifest.project.id,
      title: plan.manifest.project.title,
    },
    tool: { name: "movie-source-builder", version: "0.1.0" },
    settings: {
      width: plan.manifest.output.width,
      height: plan.manifest.output.height,
      frameRate: plan.manifest.output.frameRate,
    },
    status: "rendering",
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
    estimatedCost: plan.estimatedCost,
    actualCost: 0,
    warnings: [],
    shots: plan.units.map((unit) => ({
      id: unit.id,
      cacheKey: unit.cacheKey,
      status: "pending",
      provider: "mock",
      model: "lavfi-color",
      estimatedCost: unit.estimatedCost,
      actualCost: 0,
      attempts: 0,
      warnings: [],
    })),
  };
  await atomicJson(path.join(work, "output.json"), output);
  const { execa } = await import("execa");
  const ffmpeg = (await import("ffmpeg-static")).default as unknown as
    string | null;
  if (!ffmpeg) throw new Error("bundled ffmpeg is unavailable");
  for (let index = 0; index < plan.units.length; index++) {
    const unit = plan.units[index]!;
    const result = output.shots[index]!;
    const media = path.join(work, "shots", `${unit.id}.mp4`);
    const reusable = previous?.shots.find(
      (shot) => shot.status === "complete" && shot.cacheKey === unit.cacheKey,
    );
    const reusableBytes = reusable?.mediaPath
      ? previousEntries?.get(reusable.mediaPath)
      : undefined;
    if (
      reusable &&
      reusableBytes &&
      reusable.mediaHash === hash(reusableBytes)
    ) {
      await writeFile(media, reusableBytes);
      Object.assign(result, {
        ...reusable,
        id: unit.id,
        mediaPath: `shots/${unit.id}.mp4`,
        estimatedCost: 0,
        actualCost: 0,
        warnings: [...reusable.warnings, "reused from prior output"],
      });
      output.updatedAt = new Date().toISOString();
      await atomicJson(path.join(work, "output.json"), output);
      continue;
    }
    await execa(ffmpeg, [
      "-y",
      "-f",
      "lavfi",
      "-i",
      `color=c=0x273043:s=${output.settings.width}x${output.settings.height}:r=${output.settings.frameRate}:d=${unit.duration}`,
      "-f",
      "lavfi",
      "-i",
      `anullsrc=r=48000:cl=stereo:d=${unit.duration}`,
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-shortest",
      media,
    ]);
    const bytes = await readFile(media);
    Object.assign(result, {
      status: "complete",
      mediaPath: `shots/${unit.id}.mp4`,
      mediaHash: hash(bytes),
      requestId: `mock-${randomUUID()}`,
      attempts: 1,
      completedAt: new Date().toISOString(),
    });
    output.updatedAt = new Date().toISOString();
    await atomicJson(path.join(work, "output.json"), output);
  }
  output.status = "complete";
  output.updatedAt = new Date().toISOString();
  await atomicJson(path.join(work, "output.json"), output);
  const sourceManifest = Buffer.from(JSON.stringify(plan.manifest, null, 2));
  const archive = new Map<string, Buffer>([
    ["output.json", await readFile(path.join(work, "output.json"))],
    ["source/manifest.json", sourceManifest],
  ]);
  for (const shot of output.shots)
    archive.set(
      shot.mediaPath!,
      await readFile(path.join(work, shot.mediaPath!)),
    );
  await writeArchive(archive, options.output);
  if (!options.workDir) await rm(work, { recursive: true, force: true });
  return plan;
}
