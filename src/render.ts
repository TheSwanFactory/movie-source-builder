import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
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
const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
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

export interface AuthenticationVerification {
  provider: string;
  model: string;
  verified: boolean;
  remote: boolean;
  message: string;
}

function requireFalKey(): string {
  const key = process.env.FAL_KEY?.trim();
  if (!key)
    throw new Error("missing required renderer environment variable: FAL_KEY");
  return key;
}

export async function verifyRendererAuthentication(
  configurationFile: string,
): Promise<AuthenticationVerification> {
  const { configuration } = await loadMsbc(configurationFile);
  const missing = configuration.renderer.requiredEnvironmentVariables.filter(
    (name) => !process.env[name]?.trim(),
  );
  if (missing.length > 0)
    throw new Error(
      `missing required renderer environment variables: ${missing.join(", ")}`,
    );
  if (configuration.renderer.provider === "mock")
    return {
      provider: "mock",
      model: configuration.renderer.model,
      verified: true,
      remote: false,
      message: "mock renderer requires no remote authentication",
    };
  if (configuration.renderer.provider !== "fal")
    throw new Error(
      `authentication verification is unsupported for provider: ${configuration.renderer.provider}`,
    );
  const falKey = requireFalKey();
  const url = new URL("https://api.fal.ai/v1/models");
  url.searchParams.set("limit", "1");
  const response = await fetch(url, {
    headers: { Authorization: `Key ${falKey}` },
  });
  if (!response.ok)
    throw new Error(`fal authentication failed: HTTP ${response.status}`);
  return {
    provider: "fal",
    model: configuration.renderer.model,
    verified: true,
    remote: true,
    message:
      "fal authentication verified; model access, balance, and quota were not checked",
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

function requireUniqueIds(
  label: string,
  items: ReadonlyArray<{ id: string }>,
): Set<string> {
  const ids = new Set<string>();
  for (const item of items) {
    if (ids.has(item.id)) throw new Error(`duplicate ${label} id: ${item.id}`);
    ids.add(item.id);
  }
  return ids;
}

export function validateManifestSemantics(manifest: MsbManifest): void {
  const characterIds = requireUniqueIds("character", manifest.characters);
  const locationIds = requireUniqueIds("location", manifest.locations);
  requireUniqueIds("prop", manifest.props);
  requireUniqueIds("shot", manifest.shots);
  for (const shot of manifest.shots) {
    if (new Set(shot.characters).size !== shot.characters.length)
      throw new Error(`shot ${shot.id} contains duplicate character ids`);
    for (const id of shot.characters)
      if (!characterIds.has(id))
        throw new Error(`shot ${shot.id} references unknown character: ${id}`);
    if (shot.location && !locationIds.has(shot.location))
      throw new Error(
        `shot ${shot.id} references unknown location: ${shot.location}`,
      );
    for (const line of shot.dialogue) {
      if (line.character && !characterIds.has(line.character))
        throw new Error(
          `shot ${shot.id} dialogue references unknown character: ${line.character}`,
        );
      if (line.character && !shot.characters.includes(line.character))
        throw new Error(
          `shot ${shot.id} dialogue character is absent from the shot: ${line.character}`,
        );
      if (line.end > shot.duration)
        throw new Error(`dialogue exceeds shot ${shot.id} duration`);
    }
  }
}

export async function loadMsb(file: string): Promise<{
  entries: Map<string, Buffer>;
  manifest: MsbManifest;
  sourceHash: string;
}> {
  const bytes = await readFile(file);
  const entries = await readArchive(file);
  const raw = entries.get("msb.json");
  if (!raw) throw new Error("msb.json is required");
  const manifest = msbManifestSchema.parse(JSON.parse(raw.toString("utf8")));
  validateManifestSemantics(manifest);
  for (const asset of referencedAssets(manifest))
    if (!entries.has(asset))
      throw new Error(`referenced asset is missing: ${asset}`);
  return { entries, manifest, sourceHash: hash(bytes) };
}

type RendererInputContract = {
  validate(
    manifest: MsbManifest,
    entries: Map<string, Buffer>,
    configuration: MsbcConfiguration,
  ): void;
};

const rendererInputContracts: Record<string, RendererInputContract> = {
  mock: { validate: () => undefined },
  fal: {
    validate: (manifest, entries, configuration) => {
      const model = configuration.renderer.model;
      if (!isSupportedFalModel(model))
        throw new Error(`unsupported fal renderer model: ${model}`);
      for (const shot of manifest.shots) {
        if (shot.references.length !== 1)
          throw new Error(
            `fal shot ${shot.id} requires exactly one explicit raster reference in shot.references`,
          );
        const reference = shot.references[0]!;
        const bytes = entries.get(reference);
        if (!bytes)
          throw new Error(`referenced asset is missing: ${reference}`);
        validateRasterReference(reference, bytes);
        validateFalShotModelInput(model, shot);
      }
    },
  },
};

export function validateRendererInputs(
  manifest: MsbManifest,
  entries: Map<string, Buffer>,
  configuration: MsbcConfiguration,
): void {
  const provider = configuration.renderer.provider;
  const contract = rendererInputContracts[provider];
  if (!contract) throw new Error(`unsupported renderer provider: ${provider}`);
  contract.validate(manifest, entries, configuration);
}

function isSupportedFalModel(model: string): boolean {
  return (
    model.includes("minimax/hailuo-02") ||
    model.includes("veo3.1") ||
    model.includes("ltx-2.3")
  );
}

function validateFalShotModelInput(
  model: string,
  shot: MsbManifest["shots"][number],
): void {
  if (model.includes("veo3.1") && shot.duration === 10)
    throw new Error(`Veo 3.1 does not support 10-second shot ${shot.id}`);
}

function validateRasterReference(name: string, bytes: Buffer): void {
  const declared = imageMimeType(name);
  const detected = detectRasterMimeType(bytes);
  if (!detected)
    throw new Error(
      `fal reference is not a valid PNG, JPEG, WebP, or AVIF: ${name}`,
    );
  if (declared !== detected)
    throw new Error(
      `fal reference extension does not match file content: ${name} (${declared} != ${detected})`,
    );
}

function detectRasterMimeType(bytes: Buffer): string | undefined {
  if (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return "image/png";
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  )
    return "image/jpeg";
  if (
    bytes.length >= 12 &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  )
    return "image/webp";
  if (
    bytes.length >= 12 &&
    bytes.toString("ascii", 4, 8) === "ftyp" &&
    ["avif", "avis"].includes(bytes.toString("ascii", 8, 12))
  )
    return "image/avif";
  return undefined;
}

export async function createPlan(
  file: string,
  configurationFile: string,
  previous?: MsboOutput,
  previousEntries?: Map<string, Buffer>,
): Promise<RenderPlan> {
  const loaded = await loadMsb(file);
  const configured = await loadMsbc(configurationFile);
  validateRendererInputs(
    loaded.manifest,
    loaded.entries,
    configured.configuration,
  );
  const completed = reusableShotMap(previous, previousEntries);
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

function reusableShotMap(
  previous?: MsboOutput,
  previousEntries?: Map<string, Buffer>,
): Map<string, { shot: MsboOutput["shots"][number]; media?: Buffer }> {
  const reusable = new Map<
    string,
    { shot: MsboOutput["shots"][number]; media?: Buffer }
  >();
  for (const shot of previous?.shots ?? []) {
    if (shot.status !== "complete") continue;
    if (previousEntries === undefined) {
      reusable.set(shot.cacheKey, { shot });
      continue;
    }
    if (!shot.mediaPath || !shot.mediaHash) continue;
    const media = previousEntries.get(shot.mediaPath);
    if (media !== undefined && hash(media) === shot.mediaHash)
      reusable.set(shot.cacheKey, { shot, media });
  }
  return reusable;
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
  concurrency?: number;
  keepWorkDir?: boolean;
}

export async function renderMovie(
  source: string,
  options: RenderOptions,
): Promise<RenderPlan> {
  let previous: MsboOutput | undefined;
  let previousEntries: Map<string, Buffer> | undefined;
  if (!options.force) {
    try {
      previousEntries = await readArchive(options.output);
      const raw = previousEntries.get("msbo.json");
      if (raw) previous = msboOutputSchema.parse(JSON.parse(raw.toString()));
    } catch {
      previous = undefined;
    }
  }
  const plan = await createPlan(
    source,
    options.configuration,
    previous,
    previousEntries,
  );
  const missingEnvironmentVariables =
    plan.configuration.renderer.requiredEnvironmentVariables.filter(
      (name) => !process.env[name]?.trim(),
    );
  if (missingEnvironmentVariables.length > 0)
    throw new Error(
      `missing required renderer environment variables: ${missingEnvironmentVariables.join(", ")}`,
    );
  if (options.dryRun) return plan;
  if (plan.configuration.renderer.provider === "fal")
    await applyFalPricing(plan);
  if (options.maxCost !== undefined && plan.estimatedCost > options.maxCost)
    throw new Error(
      `estimated cost $${plan.estimatedCost.toFixed(2)} exceeds --max-cost $${options.maxCost.toFixed(2)}`,
    );
  const work = path.resolve(options.workDir ?? `${options.output}.work`);
  if (options.force) previous = undefined;
  const reusableShots = reusableShotMap(previous, previousEntries);
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
    tool: { name: "movie-source-builder", version: packageJson.version },
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
  await atomicJson(path.join(work, "msbo.json"), output);
  const ffmpeg = (await import("ffmpeg-static")).default as unknown as
    string | null;
  if (!ffmpeg) throw new Error("bundled ffmpeg is unavailable");
  const concurrency = Math.max(1, options.concurrency ?? 1);
  let nextIndex = 0;
  let stopped = false;
  let firstRenderError: unknown;
  let outputWriteChain = Promise.resolve();
  const writeOutput = async () => {
    const writePromise = outputWriteChain.then(() =>
      atomicJson(path.join(work, "msbo.json"), output),
    );
    outputWriteChain = writePromise.catch(() => undefined);
    await writePromise;
  };

  const renderWorker = async () => {
    while (true) {
      if (stopped) return;
      const index = nextIndex++;
      if (index >= plan.units.length) return;
      const unit = plan.units[index]!;
      const result = output.shots[index]!;
      const media = path.join(work, "shots", `${unit.id}.mp4`);
      try {
        const reusable = reusableShots.get(unit.cacheKey);
        if (reusable?.media) {
          await writeFile(media, reusable.media);
          Object.assign(result, {
            ...reusable.shot,
            id: unit.id,
            mediaPath: `shots/${unit.id}.mp4`,
            estimatedCost: 0,
            actualCost: 0,
            warnings: [...reusable.shot.warnings, "reused from prior output"],
          });
          output.updatedAt = new Date().toISOString();
          await writeOutput();
          continue;
        }
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
        output.updatedAt = new Date().toISOString();
        await writeOutput();
      } catch (error) {
        stopped = true;
        firstRenderError ??= error;
        result.status = "failed";
        result.attempts = 1;
        result.error = error instanceof Error ? error.message : String(error);
        output.status = "failed";
        output.updatedAt = new Date().toISOString();
        try {
          await writeOutput();
        } catch {
          // Preserve the first error; all workers are still awaited below.
        }
        return;
      }
    }
  };

  const workerResults = await Promise.allSettled(
    Array.from(
      { length: Math.min(concurrency, plan.units.length) },
      renderWorker,
    ),
  );
  firstRenderError ??= workerResults.find(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  )?.reason;
  if (firstRenderError) throw firstRenderError;
  output.status = "complete";
  output.updatedAt = new Date().toISOString();
  await atomicJson(path.join(work, "msbo.json"), output);
  const sourceManifest = Buffer.from(JSON.stringify(plan.manifest, null, 2));
  const archive = new Map<string, Buffer>([
    ["msbo.json", await readFile(path.join(work, "msbo.json"))],
    ["source/msb.json", sourceManifest],
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
  if (!options.workDir && !options.keepWorkDir)
    await rm(work, { recursive: true, force: true });
  return plan;
}

async function applyFalPricing(plan: RenderPlan): Promise<void> {
  const falKey = requireFalKey();
  const url = new URL("https://api.fal.ai/v1/models/pricing");
  url.searchParams.set("endpoint_id", plan.configuration.renderer.model);
  const response = await fetch(url, {
    headers: { Authorization: `Key ${falKey}` },
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
  fal.config({ credentials: requireFalKey() });
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
