import { randomUUID } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { hash } from "./project.js";
import {
  msbcConfigurationSchema,
  msbcFileSchema,
  type MsbcConfiguration,
  type MsbcFile,
  type Shot,
} from "./schema.js";
import type { TimedLine } from "./project.js";

export const FALLBACK_COST_PER_SECOND = 0.05;

// --- .msbc loading (unchanged behavior from v1) ------------------------------

export async function loadMsbc(file: string): Promise<{
  configuration: MsbcConfiguration;
  configurationHash: string;
  configName: string;
}> {
  const configuration = msbcConfigurationSchema.parse(
    await resolveMsbc(path.resolve(file), new Set()),
  );
  return {
    configuration,
    configurationHash: hash(`${JSON.stringify(configuration, null, 2)}\n`),
    configName: path.basename(file, ".msbc"),
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

// --- authentication -----------------------------------------------------------

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

// --- renderer capabilities ------------------------------------------------------

export type ReferenceRole = "identity" | "composition" | "endFrame";

export interface ReferenceRoleLimits {
  min: number;
  max: number;
}

export interface RendererCapabilities {
  mode: "image-to-video" | "reference-to-video";
  roles: Partial<Record<ReferenceRole, ReferenceRoleLimits>>;
  mediaTypes: readonly string[];
  /** The engine's duration menu; undefined means any positive duration. */
  durations: readonly number[] | undefined;
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

/**
 * The registered capabilities for a resolved configuration. The mock
 * provider accepts anything (it consumes no references and any duration);
 * every fal model must be registered here before it can plan.
 */
export function rendererCapabilities(
  configuration: MsbcConfiguration,
): RendererCapabilities {
  const { provider, model, mode } = configuration.renderer;
  if (provider === "mock")
    return {
      mode,
      roles: {
        identity: { min: 0, max: Infinity },
        composition: { min: 0, max: 1 },
        endFrame: { min: 0, max: 1 },
      },
      mediaTypes: RASTER_MEDIA_TYPES,
      durations: undefined,
      audio: false,
    };
  if (provider !== "fal")
    throw new Error(`unsupported renderer provider: ${provider}`);
  const capabilities = falModelCapabilities[model];
  if (!capabilities)
    throw new Error(`unsupported fal renderer model: ${model}`);
  if (capabilities.mode !== mode)
    throw new Error(
      `renderer mode mismatch: msbc declares "${mode}" but model ${model} supports "${capabilities.mode}"`,
    );
  return capabilities;
}

export function shotReferencePaths(shot: Shot): string[] {
  return [
    ...(shot.references.composition ? [shot.references.composition] : []),
    ...shot.references.identity,
    ...(shot.references.endFrame ? [shot.references.endFrame] : []),
  ];
}

function referenceRolePaths(shot: Shot, role: ReferenceRole): string[] {
  if (role === "identity") return shot.references.identity;
  const value = shot.references[role];
  return value ? [value] : [];
}

const REFERENCE_ROLES: readonly ReferenceRole[] = [
  "identity",
  "composition",
  "endFrame",
];

/**
 * Validates one shot's references against the engine's registered roles and
 * media types. Duration-menu compatibility is deliberately NOT checked here:
 * that is plan validation, recorded as a shoot finding (see src/shoot.ts).
 */
export function validateShotReferences(
  capabilities: RendererCapabilities,
  provider: string,
  shot: Shot,
  readReference: (relative: string) => Buffer,
): void {
  if (provider === "mock") return;
  for (const role of REFERENCE_ROLES) {
    const provided = referenceRolePaths(shot, role);
    const limits = capabilities.roles[role];
    if (!limits) {
      if (provided.length > 0)
        throw new Error(
          `${provider} shot ${shot.id} does not accept a ${role} reference for this renderer mode`,
        );
      continue;
    }
    if (provided.length < limits.min || provided.length > limits.max)
      throw new Error(
        `${provider} shot ${shot.id} requires between ${limits.min} and ${limits.max} ${role} reference(s), received ${provided.length}`,
      );
    for (const reference of provided)
      validateRasterReference(
        reference,
        readReference(reference),
        capabilities.mediaTypes,
      );
  }
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

export function imageMimeType(name: string): string {
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

// --- prompt derivation -------------------------------------------------------------

/**
 * The render prompt for one shot: an explicit per-engine override (or the
 * default derivation from action/camera/continuity), always followed by the
 * dialogue and narration derived from the screenplay cues in the shot span —
 * dialogue lives in the screenplay and only there.
 */
export function buildShotPrompt(
  shot: Shot,
  lines: TimedLine[],
  configName: string,
  configuration: MsbcConfiguration,
): string {
  const override =
    shot.prompts[configName] ??
    shot.prompts[
      `${configuration.renderer.provider}/${configuration.renderer.model}`
    ] ??
    shot.prompts["default"] ??
    null;
  const base =
    override ??
    [
      shot.action,
      `Camera: ${shot.camera}`,
      shot.continuity.length
        ? `Continuity: ${shot.continuity.join("; ")}`
        : undefined,
    ]
      .filter(Boolean)
      .join("\n");
  const dialogue = lines.filter((line) => line.kind === "dialogue");
  const narration = lines.filter((line) => line.kind === "narration");
  return [
    base,
    narration.length
      ? `Narration: ${narration.map((line) => line.text).join(" ")}`
      : undefined,
    dialogue.length
      ? `Dialogue: ${dialogue.map((line) => line.text).join(" ")}`
      : undefined,
  ]
    .filter(Boolean)
    .join("\n");
}

// --- pricing --------------------------------------------------------------------

export const roundCurrency = (value: number): number =>
  Math.round(value * 1_000_000) / 1_000_000;

/** Live per-second pricing for one fal model, in USD. */
export async function falUnitPrice(model: string): Promise<number> {
  requireFalKey();
  const url = new URL("https://api.fal.ai/v1/models/pricing");
  url.searchParams.set("endpoint_id", model);
  const response = await fetch(url, {
    headers: { Authorization: `Key ${requireFalKey()}` },
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
  const price = body.prices?.find((item) => item.endpoint_id === model);
  if (
    typeof price?.unit_price !== "number" ||
    price.unit !== "seconds" ||
    price.currency !== "USD"
  )
    throw new Error(`fal returned unsupported pricing for ${model}`);
  return price.unit_price;
}

// --- clip rendering ---------------------------------------------------------------

export interface ClipRequest {
  shotId: string;
  duration: number;
  prompt: string;
  configuration: MsbcConfiguration;
  /** Raster bytes by role, already validated. */
  composition?: Buffer;
  compositionName?: string;
  identity?: Array<{ name: string; bytes: Buffer }>;
}

export async function renderMockClip(
  duration: number,
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
    `color=c=0x273043:s=${settings.width}x${settings.height}:r=${settings.frameRate}:d=${duration}`,
    "-f",
    "lavfi",
    "-i",
    `anullsrc=r=48000:cl=stereo:d=${duration}`,
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

export async function renderFalClip(
  request: ClipRequest,
  media: string,
  ffmpeg: string,
): Promise<string> {
  const { configuration } = request;
  const model = configuration.renderer.model;
  const { fal } = await import("@fal-ai/client");
  fal.config({ credentials: requireFalKey() });
  const input =
    configuration.renderer.mode === "reference-to-video"
      ? falReferenceInput(
          model,
          configuration.output,
          request.duration,
          request.prompt,
          await Promise.all(
            (request.identity ?? []).map((reference) =>
              uploadFalBytes(
                fal,
                reference.bytes,
                imageMimeType(reference.name),
              ),
            ),
          ),
        )
      : falInput(
          model,
          configuration.output,
          request.duration,
          request.prompt,
          await uploadFalBytes(
            fal,
            request.composition!,
            imageMimeType(request.compositionName!),
          ),
        );
  const response = await fal.subscribe(model, { input, logs: false });
  const data = response.data as { video?: { url?: unknown } };
  if (typeof data.video?.url !== "string")
    throw new Error(
      `fal renderer returned no video for shot ${request.shotId}`,
    );
  const downloaded = await fetch(data.video.url);
  if (!downloaded.ok)
    throw new Error(
      `failed to download fal video for shot ${request.shotId}: HTTP ${downloaded.status}`,
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
      `scale=${configuration.output.width}:${configuration.output.height}:force_original_aspect_ratio=decrease,pad=${configuration.output.width}:${configuration.output.height}:(ow-iw)/2:(oh-ih)/2,fps=${configuration.output.frameRate}`,
      "-t",
      String(request.duration),
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

export function falInput(
  model: string,
  output: MsbcConfiguration["output"],
  duration: number,
  prompt: string,
  imageUrl: string,
): Record<string, unknown> {
  const common = { prompt, image_url: imageUrl };
  if (model.includes("minimax/hailuo-02"))
    return {
      ...common,
      duration: String(duration),
      resolution: output.height >= 768 ? "768P" : "512P",
    };
  if (model.includes("veo3.1")) {
    return {
      ...common,
      duration: `${duration}s`,
      resolution: output.height >= 1080 ? "1080p" : "720p",
      aspect_ratio: output.aspectRatio,
      generate_audio: true,
    };
  }
  if (model.includes("ltx-2.3"))
    return {
      ...common,
      duration,
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
  duration: number,
  prompt: string,
  imageUrls: string[],
): Record<string, unknown> {
  if (model.includes("veo3.1"))
    return {
      prompt,
      image_urls: imageUrls,
      duration: `${duration}s`,
      resolution: output.height >= 1080 ? "1080p" : "720p",
      aspect_ratio: output.aspectRatio,
      generate_audio: true,
    };
  throw new Error(`unsupported fal reference-to-video model: ${model}`);
}
