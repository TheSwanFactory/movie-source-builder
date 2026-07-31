import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { readArchive, writeArchive } from "./archive.js";
import {
  msbManifestSchema,
  msbcConfigurationSchema,
  msbcFileSchema,
  msboOutputSchema,
  type MsbManifest,
  type MsbcConfiguration,
  type MsbcFile,
  type MsboOutput,
} from "./schema.js";

const FALLBACK_COST_PER_SECOND = 0.05;
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
  entries: Map<string, Buffer>;
  configuration: MsbcConfiguration;
  configurationHash: string;
  sourceHash: string;
  units: RenderPlanUnit[];
  estimatedCost: number;
}

export async function loadMsbc(file: string): Promise<{
  configuration: MsbcConfiguration;
  configurationHash: string;
}> {
  const configuration = msbcConfigurationSchema.parse(
    await resolveMsbc(path.resolve(file), new Set()),
  );
  return {
    configuration,
    configurationHash: hash(`${JSON.stringify(configuration, null, 2)}\n`),
  };
}

type LoosePartial<T> = { [Key in keyof T]?: T[Key] | undefined };
type PartialMsbc = {
  version?: string;
  output?: LoosePartial<MsbcConfiguration["output"]> | undefined;
  renderer?: LoosePartial<MsbcConfiguration["renderer"]> | undefined;
};

async function resolveMsbc(
  file: string,
  ancestors: Set<string>,
): Promise<PartialMsbc> {
  if (ancestors.has(file))
    throw new Error(
      `cyclic MSBC inheritance: ${[...ancestors, file].join(" -> ")}`,
    );
  const nextAncestors = new Set(ancestors).add(file);
  const raw = msbcFileSchema.parse(
    JSON.parse((await readFile(file)).toString("utf8")),
  ) as MsbcFile;
  const parent = raw.extends
    ? await resolveMsbc(
        path.resolve(path.dirname(file), raw.extends),
        nextAncestors,
      )
    : {};
  return {
    version: raw.version,
    output:
      parent.output || raw.output
        ? { ...parent.output, ...raw.output }
        : undefined,
    renderer:
      parent.renderer || raw.renderer
        ? { ...parent.renderer, ...raw.renderer }
        : undefined,
  };
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
  configurationFile: string,
  previous?: MsboOutput,
): Promise<RenderPlan> {
  const loaded = await loadMsb(file);
  const configured = await loadMsbc(configurationFile);
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
        engine: configured.configuration,
      }),
    );
    return {
      id: shot.id,
      duration: shot.duration,
      cacheKey,
      estimatedCost:
        configured.configuration.renderer.provider === "mock"
          ? 0
          : shot.duration * FALLBACK_COST_PER_SECOND,
      reused: completed.has(cacheKey),
    };
  });
  return {
    manifest: loaded.manifest,
    entries: loaded.entries,
    configuration: configured.configuration,
    configurationHash: configured.configurationHash,
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
  configuration: string;
  dryRun?: boolean;
  maxCost?: number;
  workDir?: string;
  force?: boolean;
}

export async function renderMovie(
  source: string,
  options: RenderOptions,
): Promise<RenderPlan> {
  let previous: MsboOutput | undefined;
  let previousEntries: Map<string, Buffer> | undefined;
  try {
    previousEntries = await readArchive(options.output);
    const raw = previousEntries.get("output.json");
    if (raw) previous = msboOutputSchema.parse(JSON.parse(raw.toString()));
  } catch {
    previous = undefined;
  }
  const plan = await createPlan(source, options.configuration, previous);
  const missingEnvironmentVariables =
    plan.configuration.renderer.requiredEnvironmentVariables.filter(
      (name) => !process.env[name],
    );
  if (missingEnvironmentVariables.length > 0)
    throw new Error(
      `missing required renderer environment variables: ${missingEnvironmentVariables.join(", ")}`,
    );
  if (!new Set(["mock", "fal"]).has(plan.configuration.renderer.provider))
    throw new Error(
      `unsupported renderer provider: ${plan.configuration.renderer.provider}`,
    );
  if (plan.configuration.renderer.provider === "fal")
    await applyFalPricing(plan);
  if (options.maxCost !== undefined && plan.estimatedCost > options.maxCost)
    throw new Error(
      `estimated cost $${plan.estimatedCost.toFixed(2)} exceeds --max-cost $${options.maxCost.toFixed(2)}`,
    );
  if (options.dryRun) return plan;
  const work = path.resolve(options.workDir ?? `${options.output}.work`);
  await mkdir(path.join(work, "shots"), { recursive: true });
  const now = new Date().toISOString();
  const output: MsboOutput = {
    formatVersion: "1.0.0",
    source: {
      hash: plan.sourceHash,
      projectId: plan.manifest.project.id,
      title: plan.manifest.project.title,
    },
    configuration: { hash: plan.configurationHash },
    tool: { name: "movie-source-builder", version: "0.2.0" },
    settings: {
      width: plan.configuration.output.width,
      height: plan.configuration.output.height,
      frameRate: plan.configuration.output.frameRate,
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
      provider: plan.configuration.renderer.provider,
      model: plan.configuration.renderer.model,
      estimatedCost: unit.estimatedCost,
      actualCost: 0,
      attempts: 0,
      warnings: [],
    })),
  };
  await atomicJson(path.join(work, "output.json"), output);
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
    try {
      const isFal = plan.configuration.renderer.provider === "fal";
      const requestId = isFal
        ? await renderFalShot(plan, index, media, ffmpeg)
        : await renderMockShot(unit, output.settings, media, ffmpeg);
      const bytes = await readFile(media);
      Object.assign(result, {
        status: "complete",
        mediaPath: `shots/${unit.id}.mp4`,
        mediaHash: hash(bytes),
        requestId,
        actualCost: isFal ? unit.estimatedCost : 0,
        attempts: 1,
        completedAt: new Date().toISOString(),
      });
      if (isFal) output.actualCost += unit.estimatedCost;
    } catch (error) {
      result.status = "failed";
      result.attempts = 1;
      result.error = error instanceof Error ? error.message : String(error);
      output.status = "failed";
      output.updatedAt = new Date().toISOString();
      await atomicJson(path.join(work, "output.json"), output);
      throw error;
    }
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
    [
      "configuration.msbc",
      Buffer.from(`${JSON.stringify(plan.configuration, null, 2)}\n`),
    ],
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

async function applyFalPricing(plan: RenderPlan): Promise<void> {
  const url = new URL("https://api.fal.ai/v1/models/pricing");
  url.searchParams.set("endpoint_id", plan.configuration.renderer.model);
  const response = await fetch(url, {
    headers: { Authorization: `Key ${process.env.FAL_KEY}` },
  });
  if (!response.ok)
    throw new Error(`failed to retrieve fal pricing: HTTP ${response.status}`);
  const body = (await response.json()) as {
    prices?: Array<{
      endpoint_id?: unknown;
      unit_price?: unknown;
      unit?: unknown;
      currency?: unknown;
    }>;
  };
  const price = body.prices?.find(
    (item) => item.endpoint_id === plan.configuration.renderer.model,
  );
  if (
    typeof price?.unit_price !== "number" ||
    price.unit !== "seconds" ||
    price.currency !== "USD"
  )
    throw new Error(
      `fal returned unsupported pricing for ${plan.configuration.renderer.model}`,
    );
  for (const unit of plan.units)
    unit.estimatedCost = unit.reused
      ? 0
      : roundCurrency(unit.duration * price.unit_price);
  plan.estimatedCost = roundCurrency(
    plan.units.reduce((sum, unit) => sum + unit.estimatedCost, 0),
  );
}

const roundCurrency = (value: number) =>
  Math.round(value * 1_000_000) / 1_000_000;

async function renderMockShot(
  unit: RenderPlanUnit,
  settings: { width: number; height: number; frameRate: number },
  media: string,
  ffmpeg: string,
): Promise<string> {
  const { execa } = await import("execa");
  await execa(ffmpeg, [
    "-y",
    "-f",
    "lavfi",
    "-i",
    `color=c=0x273043:s=${settings.width}x${settings.height}:r=${settings.frameRate}:d=${unit.duration}`,
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
  return `mock-${randomUUID()}`;
}

async function renderFalShot(
  plan: RenderPlan,
  index: number,
  media: string,
  ffmpeg: string,
): Promise<string> {
  const shot = plan.manifest.shots[index]!;
  if (shot.references.length !== 1)
    throw new Error(
      `fal shot ${shot.id} requires exactly one explicit raster reference`,
    );
  const reference = shot.references[0]!;
  const bytes = plan.entries.get(reference);
  if (!bytes) throw new Error(`referenced asset is missing: ${reference}`);
  const mime = imageMimeType(reference);
  const input = falInput(
    plan.configuration.renderer.model,
    plan.configuration.output,
    shot,
    "pending-upload",
  );
  const { fal } = await import("@fal-ai/client");
  const imageUrl = await fal.storage.upload(
    new Blob([new Uint8Array(bytes)], { type: mime }),
  );
  input.image_url = imageUrl;
  const response = await fal.subscribe(plan.configuration.renderer.model, {
    input,
    logs: false,
  });
  const data = response.data as { video?: { url?: unknown } };
  if (typeof data.video?.url !== "string")
    throw new Error(`fal renderer returned no video for shot ${shot.id}`);
  const downloaded = await fetch(data.video.url);
  if (!downloaded.ok)
    throw new Error(
      `failed to download fal video for shot ${shot.id}: HTTP ${downloaded.status}`,
    );
  const raw = `${media}.fal.mp4`;
  await writeFile(raw, Buffer.from(await downloaded.arrayBuffer()));
  try {
    const { execa } = await import("execa");
    await execa(ffmpeg, [
      "-y",
      "-i",
      raw,
      "-vf",
      `scale=${plan.configuration.output.width}:${plan.configuration.output.height}:force_original_aspect_ratio=decrease,pad=${plan.configuration.output.width}:${plan.configuration.output.height}:(ow-iw)/2:(oh-ih)/2,fps=${plan.configuration.output.frameRate}`,
      "-t",
      String(shot.duration),
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-map_metadata",
      "-1",
      media,
    ]);
  } finally {
    await rm(raw, { force: true });
  }
  return response.requestId;
}

function imageMimeType(name: string): string {
  const extension = path.extname(name).toLowerCase();
  const types: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".avif": "image/avif",
  };
  const type = types[extension];
  if (!type)
    throw new Error(`fal reference must be PNG, JPEG, WebP, or AVIF: ${name}`);
  return type;
}

export function falInput(
  model: string,
  output: MsbcConfiguration["output"],
  shot: MsbManifest["shots"][number],
  imageUrl: string,
): Record<string, unknown> {
  const prompt = [
    shot.action,
    `Camera: ${shot.camera}`,
    shot.narration ? `Narration: ${shot.narration}` : undefined,
    shot.dialogue.length
      ? `Dialogue: ${shot.dialogue.map((line) => line.text).join(" ")}`
      : undefined,
    shot.continuity.length
      ? `Continuity: ${shot.continuity.join("; ")}`
      : undefined,
  ]
    .filter(Boolean)
    .join("\n");
  const common = { prompt, image_url: imageUrl };
  if (model.includes("minimax/hailuo-02"))
    return {
      ...common,
      duration: String(shot.duration),
      resolution: output.height >= 768 ? "768P" : "512P",
    };
  if (model.includes("veo3.1")) {
    if (shot.duration === 10)
      throw new Error(`Veo 3.1 does not support 10-second shot ${shot.id}`);
    return {
      ...common,
      duration: `${shot.duration}s`,
      resolution: output.height >= 1080 ? "1080p" : "720p",
      aspect_ratio: output.aspectRatio,
      generate_audio: true,
    };
  }
  if (model.includes("ltx-2.3"))
    return {
      ...common,
      duration: shot.duration,
      resolution:
        output.height >= 2160
          ? "2160p"
          : output.height >= 1440
            ? "1440p"
            : "1080p",
      aspect_ratio: output.aspectRatio,
      fps: output.frameRate,
      generate_audio: true,
    };
  return common;
}
