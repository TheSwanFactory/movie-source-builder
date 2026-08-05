import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import { readArchive, writeArchive } from "./archive.js";
import {
  CHAIN_DRIFT_MAX_ATTEMPTS,
  CHAIN_SIMILARITY_THRESHOLD,
  compareFrameSimilarity,
  extractLastFrame,
} from "./chain.js";
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
  duration: 6 | 8 | 10;
  cacheKey: string;
  estimatedCost: number;
  reused: boolean;
  chainFrom?: string;
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

export function shotReferencePaths(
  shot: MsbManifest["shots"][number],
): string[] {
  return [
    ...(shot.references.composition ? [shot.references.composition] : []),
    ...shot.references.identity,
    ...(shot.references.endFrame ? [shot.references.endFrame] : []),
  ];
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
      ...manifest.shots.flatMap((item) => shotReferencePaths(item)),
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
  const shotIndex = new Map(
    manifest.shots.map((shot, index) => [shot.id, index]),
  );
  for (const [index, shot] of manifest.shots.entries()) {
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
    if (shot.chainFrom !== undefined) {
      if (shot.chainFrom === shot.id)
        throw new Error(`shot ${shot.id} cannot chain from itself`);
      const predecessorIndex = shotIndex.get(shot.chainFrom);
      if (predecessorIndex === undefined)
        throw new Error(
          `shot ${shot.id} chains from unknown shot: ${shot.chainFrom}`,
        );
      if (predecessorIndex >= index)
        throw new Error(
          `shot ${shot.id} must chain from an earlier shot, not ${shot.chainFrom}`,
        );
      if (!shot.references.composition)
        throw new Error(
          `shot ${shot.id} chains from another shot but has no references.composition to verify against`,
        );
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

export type ReferenceRole = "identity" | "composition" | "endFrame";

export interface ReferenceRoleLimits {
  min: number;
  max: number;
}

export interface RendererCapabilities {
  mode: "image-to-video" | "reference-to-video";
  roles: Partial<Record<ReferenceRole, ReferenceRoleLimits>>;
  mediaTypes: readonly string[];
  durations: readonly number[];
  audio: boolean;
}

const RASTER_MEDIA_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/avif",
] as const;

const falModelCapabilities: Record<string, RendererCapabilities> = {
  "fal-ai/minimax/hailuo-02/standard/image-to-video": {
    mode: "image-to-video",
    roles: { composition: { min: 1, max: 1 } },
    mediaTypes: RASTER_MEDIA_TYPES,
    durations: [6, 10],
    audio: false,
  },
  "fal-ai/veo3.1/fast/image-to-video": {
    mode: "image-to-video",
    roles: { composition: { min: 1, max: 1 } },
    mediaTypes: RASTER_MEDIA_TYPES,
    durations: [6, 8],
    audio: true,
  },
  "fal-ai/ltx-2.3/image-to-video/fast": {
    mode: "image-to-video",
    roles: { composition: { min: 1, max: 1 } },
    mediaTypes: RASTER_MEDIA_TYPES,
    durations: [6, 8, 10],
    audio: true,
  },
  "fal-ai/veo3.1/fast/reference-to-video": {
    mode: "reference-to-video",
    roles: { identity: { min: 1, max: 3 } },
    mediaTypes: RASTER_MEDIA_TYPES,
    durations: [8],
    audio: true,
  },
};

function requireFalCapabilities(model: string): RendererCapabilities {
  const capabilities = falModelCapabilities[model];
  if (!capabilities)
    throw new Error(`unsupported fal renderer model: ${model}`);
  return capabilities;
}

function referenceRolePaths(
  shot: MsbManifest["shots"][number],
  role: ReferenceRole,
): string[] {
  if (role === "identity") return shot.references.identity;
  const value = shot.references[role];
  return value ? [value] : [];
}

const REFERENCE_ROLES: readonly ReferenceRole[] = [
  "identity",
  "composition",
  "endFrame",
];

function validateFalShot(
  capabilities: RendererCapabilities,
  shot: MsbManifest["shots"][number],
  entries: Map<string, Buffer>,
): void {
  if (!capabilities.durations.includes(shot.duration))
    throw new Error(
      `fal shot ${shot.id} duration ${shot.duration}s is unsupported for this renderer mode`,
    );
  for (const role of REFERENCE_ROLES) {
    const provided = referenceRolePaths(shot, role);
    const limits = capabilities.roles[role];
    if (!limits) {
      if (provided.length > 0)
        throw new Error(
          `fal shot ${shot.id} does not accept a ${role} reference for this renderer mode`,
        );
      continue;
    }
    if (provided.length < limits.min || provided.length > limits.max)
      throw new Error(
        `fal shot ${shot.id} requires between ${limits.min} and ${limits.max} ${role} reference(s), received ${provided.length}`,
      );
    for (const reference of provided) {
      const bytes = entries.get(reference);
      if (!bytes) throw new Error(`referenced asset is missing: ${reference}`);
      validateRasterReference(reference, bytes, capabilities.mediaTypes);
    }
  }
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
      const capabilities = requireFalCapabilities(configuration.renderer.model);
      if (capabilities.mode !== configuration.renderer.mode)
        throw new Error(
          `renderer mode mismatch: msbc declares "${configuration.renderer.mode}" but model ${configuration.renderer.model} supports "${capabilities.mode}"`,
        );
      for (const shot of manifest.shots)
        validateFalShot(capabilities, shot, entries);
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
  for (const shot of manifest.shots)
    if (
      shot.chainFrom !== undefined &&
      configuration.renderer.mode !== "image-to-video"
    )
      throw new Error(
        `shot ${shot.id} chains from another shot, which requires renderer.mode "image-to-video" (configured mode: "${configuration.renderer.mode}")`,
      );
  contract.validate(manifest, entries, configuration);
}

function validateRasterReference(
  name: string,
  bytes: Buffer,
  mediaTypes: readonly string[],
): void {
  const declared = imageMimeType(name);
  if (!mediaTypes.includes(declared))
    throw new Error(
      `fal reference type is unsupported for this renderer mode: ${name} (${declared})`,
    );
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
  const cacheKeyByShotId = new Map<string, string>();
  const units = loaded.manifest.shots.map((shot) => {
    const refs = referencedAssets({ ...loaded.manifest, shots: [shot] }).map(
      (name) => [name, hash(loaded.entries.get(name) ?? "")],
    );
    // shot.chainFrom always points to an earlier shot (validateManifestSemantics
    // enforces this), so its cache key is already in the map by the time we get here.
    const chainFromCacheKey =
      shot.chainFrom !== undefined
        ? cacheKeyByShotId.get(shot.chainFrom)
        : undefined;
    const cacheKey = hash(
      JSON.stringify({
        shot,
        refs,
        engine: configured.configuration,
        chainFrom: chainFromCacheKey,
      }),
    );
    cacheKeyByShotId.set(shot.id, cacheKey);
    return {
      id: shot.id,
      duration: shot.duration,
      cacheKey,
      estimatedCost:
        configured.configuration.renderer.provider === "mock"
          ? 0
          : shot.duration * FALLBACK_COST_PER_SECOND,
      reused: completed.has(cacheKey),
      ...(shot.chainFrom !== undefined ? { chainFrom: shot.chainFrom } : {}),
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
  const anyChained = plan.units.some((unit) => unit.chainFrom !== undefined);
  const concurrencyClamped = anyChained && (options.concurrency ?? 1) > 1;
  const output: MsboOutput = {
    kind: "render",
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
    warnings: concurrencyClamped
      ? [
          "concurrency clamped to 1: chained shots (chainFrom) require strictly sequential rendering",
        ]
      : [],
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
  const concurrency = anyChained ? 1 : Math.max(1, options.concurrency ?? 1);
  const unitIndexById = new Map(plan.units.map((unit, i) => [unit.id, i]));
  const resolvedStartingImage = new Map<number, Buffer>();
  const CHAIN_POLL_INTERVAL_MS = 50;
  const sleep = (ms: number) =>
    new Promise((resolve) => setTimeout(resolve, ms));
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

  const waitForChainPredecessor = async (unit: RenderPlanUnit) => {
    if (unit.chainFrom === undefined) return;
    const predecessorIndex = unitIndexById.get(unit.chainFrom);
    if (predecessorIndex === undefined)
      throw new Error(
        `shot ${unit.id} chains from unknown unit: ${unit.chainFrom}`,
      );
    while (true) {
      if (stopped)
        throw new Error(
          `render stopped before predecessor ${unit.chainFrom} of chained shot ${unit.id} completed`,
        );
      const predecessorResult = output.shots[predecessorIndex]!;
      if (predecessorResult.status === "complete") return;
      if (predecessorResult.status === "failed")
        throw new Error(
          `chained shot ${unit.id} cannot render: predecessor ${unit.chainFrom} failed`,
        );
      await sleep(CHAIN_POLL_INTERVAL_MS);
    }
  };

  // Re-renders a predecessor shot from its own cached, already-resolved
  // starting image (never re-derived — chained or not, that image was fixed
  // the moment the predecessor first rendered), producing a fresh
  // non-deterministic draw from the provider. Writes to a temp path and
  // renames into place so nothing ever reads a half-written predecessor
  // file, since the predecessor's status stays "complete" throughout.
  const rerenderChainPredecessor = async (
    predecessorIndex: number,
    attempt: number,
  ): Promise<void> => {
    const predecessorUnit = plan.units[predecessorIndex]!;
    const predecessorResult = output.shots[predecessorIndex]!;
    const startingImage = resolvedStartingImage.get(predecessorIndex);
    if (!startingImage)
      throw new Error(
        `cannot retry predecessor ${predecessorUnit.id}: its original starting image was not resolved during this render (likely reused from a prior output) — rerun with --force to enable retry`,
      );
    const canonicalMedia = path.join(work, predecessorResult.mediaPath!);
    const tempMedia = path.join(
      work,
      "shots",
      `${predecessorUnit.id}.retry-${attempt}.mp4`,
    );
    const requestId = await renderFalShot(
      plan,
      predecessorIndex,
      tempMedia,
      ffmpeg,
      startingImage,
    );
    const bytes = await readFile(tempMedia);
    await rename(tempMedia, canonicalMedia);
    Object.assign(predecessorResult, {
      mediaHash: hash(bytes),
      requestId,
      actualCost: predecessorResult.actualCost + predecessorUnit.estimatedCost,
      attempts: (predecessorResult.attempts || 1) + 1,
      completedAt: new Date().toISOString(),
    });
    output.actualCost += predecessorUnit.estimatedCost;
    output.updatedAt = new Date().toISOString();
    await writeOutput();
  };

  // Verifies the predecessor's actual rendered frame against this shot's own
  // authored composition (the "planned" keyframe); a close-enough match
  // promotes the real frame as the actual render input instead of the still.
  // Below threshold, the predecessor is re-rendered fresh (a new
  // non-deterministic draw) and re-checked, up to CHAIN_DRIFT_MAX_ATTEMPTS
  // total predecessor renders, before finally failing. Only meaningful on
  // the fal path — renderMockShot never consumes the composition image, so
  // there is nothing real to verify for the mock provider (it still waits
  // for ordering, above, but skips this check).
  const resolveChainedComposition = async (
    unit: RenderPlanUnit,
    index: number,
  ): Promise<Buffer> => {
    const predecessorIndex = unitIndexById.get(unit.chainFrom!)!;
    const shot = plan.manifest.shots[index]!;
    const compositionPath = shot.references.composition!;
    const compositionBytes = plan.entries.get(compositionPath);
    if (!compositionBytes)
      throw new Error(`referenced asset is missing: ${compositionPath}`);
    const chainDir = path.join(work, "chain");
    await mkdir(chainDir, { recursive: true });
    const compositionTemp = path.join(
      chainDir,
      `${unit.id}-composition${path.extname(compositionPath)}`,
    );
    await writeFile(compositionTemp, compositionBytes);

    const scores: number[] = [];
    for (let attempt = 1; attempt <= CHAIN_DRIFT_MAX_ATTEMPTS; attempt++) {
      if (stopped)
        throw new Error(
          `render stopped before predecessor ${unit.chainFrom} of chained shot ${unit.id} completed`,
        );
      const predecessorResult = output.shots[predecessorIndex]!;
      if (!predecessorResult.mediaPath)
        throw new Error(
          `chained shot ${unit.id}: predecessor ${unit.chainFrom} has no rendered media to chain from`,
        );
      const predecessorMedia = path.join(work, predecessorResult.mediaPath);
      const extractedFrame = path.join(
        chainDir,
        `${unit.id}-predecessor-frame-attempt${attempt}.png`,
      );
      await extractLastFrame(predecessorMedia, extractedFrame, ffmpeg);
      const score = await compareFrameSimilarity(
        extractedFrame,
        compositionTemp,
        ffmpeg,
      );
      scores.push(score);
      if (score >= CHAIN_SIMILARITY_THRESHOLD) {
        output.shots[index]!.warnings.push(
          attempt === 1
            ? `composition promoted from predecessor ${unit.chainFrom}'s rendered frame (similarity ${score.toFixed(3)})`
            : `composition promoted from predecessor ${unit.chainFrom}'s rendered frame (similarity ${score.toFixed(3)}) after ${attempt} predecessor attempts`,
        );
        return readFile(extractedFrame);
      }
      if (attempt === CHAIN_DRIFT_MAX_ATTEMPTS)
        throw new Error(
          `shot ${unit.id} failed its chain drift check against predecessor ${unit.chainFrom} after ${CHAIN_DRIFT_MAX_ATTEMPTS} predecessor render attempt(s) (similarities: ${scores.map((s) => s.toFixed(3)).join(", ")}), all below threshold ${CHAIN_SIMILARITY_THRESHOLD}`,
        );
      output.shots[predecessorIndex]!.warnings.push(
        `re-rendered (attempt ${attempt + 1}/${CHAIN_DRIFT_MAX_ATTEMPTS}) after a downstream chain drift check for successor ${unit.id} scored ${score.toFixed(3)} (below ${CHAIN_SIMILARITY_THRESHOLD})`,
      );
      await writeOutput();
      await rerenderChainPredecessor(predecessorIndex, attempt + 1);
    }
    throw new Error(
      `unreachable: chain drift retry loop exited without resolving ${unit.id}`,
    );
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
        await waitForChainPredecessor(unit);
        const isFal = plan.configuration.renderer.provider === "fal";
        let compositionOverride: Buffer | undefined;
        if (isFal && plan.configuration.renderer.mode === "image-to-video") {
          compositionOverride =
            unit.chainFrom !== undefined
              ? await resolveChainedComposition(unit, index)
              : plan.entries.get(
                  plan.manifest.shots[index]!.references.composition!,
                );
          if (compositionOverride === undefined)
            throw new Error(
              `referenced asset is missing: ${plan.manifest.shots[index]!.references.composition}`,
            );
          resolvedStartingImage.set(index, compositionOverride);
        }
        const requestId = isFal
          ? await renderFalShot(plan, index, media, ffmpeg, compositionOverride)
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

async function uploadFalBytes(
  fal: Awaited<typeof import("@fal-ai/client")>["fal"],
  bytes: Buffer,
  mime: string,
): Promise<string> {
  return fal.storage.upload(new Blob([new Uint8Array(bytes)], { type: mime }));
}

async function uploadFalReference(
  fal: Awaited<typeof import("@fal-ai/client")>["fal"],
  entries: Map<string, Buffer>,
  reference: string,
): Promise<string> {
  const bytes = entries.get(reference);
  if (!bytes) throw new Error(`referenced asset is missing: ${reference}`);
  return uploadFalBytes(fal, bytes, imageMimeType(reference));
}

async function renderFalShot(
  plan: RenderPlan,
  index: number,
  media: string,
  ffmpeg: string,
  compositionOverride?: Buffer,
): Promise<string> {
  const shot = plan.manifest.shots[index]!;
  const model = plan.configuration.renderer.model;
  const { fal } = await import("@fal-ai/client");
  fal.config({ credentials: requireFalKey() });
  const input =
    plan.configuration.renderer.mode === "reference-to-video"
      ? falReferenceInput(
          model,
          plan.configuration.output,
          shot,
          await Promise.all(
            shot.references.identity.map((reference) =>
              uploadFalReference(fal, plan.entries, reference),
            ),
          ),
        )
      : falInput(
          model,
          plan.configuration.output,
          shot,
          compositionOverride !== undefined
            ? await uploadFalBytes(
                fal,
                compositionOverride,
                imageMimeType(shot.references.composition!),
              )
            : await uploadFalReference(
                fal,
                plan.entries,
                shot.references.composition!,
              ),
        );
  const response = await fal.subscribe(model, {
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

function falPrompt(shot: MsbManifest["shots"][number]): string {
  return [
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
}

export function falInput(
  model: string,
  output: MsbcConfiguration["output"],
  shot: MsbManifest["shots"][number],
  imageUrl: string,
): Record<string, unknown> {
  const common = { prompt: falPrompt(shot), image_url: imageUrl };
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

export function falReferenceInput(
  model: string,
  output: MsbcConfiguration["output"],
  shot: MsbManifest["shots"][number],
  imageUrls: string[],
): Record<string, unknown> {
  if (model.includes("veo3.1"))
    return {
      prompt: falPrompt(shot),
      image_urls: imageUrls,
      duration: `${shot.duration}s`,
      resolution: output.height >= 1080 ? "1080p" : "720p",
      aspect_ratio: output.aspectRatio,
      generate_audio: true,
    };
  throw new Error(`unsupported fal reference-to-video model: ${model}`);
}
