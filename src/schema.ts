import { z } from "zod";

const id = z.string().regex(/^[a-z0-9][a-z0-9._-]*$/);
const relativePath = z
  .string()
  .min(1)
  .refine((value) => {
    const normalized = value.replaceAll("\\", "/");
    return (
      !normalized.startsWith("/") &&
      !normalized.split("/").includes("..") &&
      !/^[a-zA-Z]:/.test(normalized)
    );
  }, "must be a safe relative path");

export const dialogueSchema = z
  .object({
    character: id.optional(),
    text: z.string().min(1),
    start: z.number().nonnegative(),
    end: z.number().positive(),
  })
  .refine((value) => value.end > value.start, "dialogue end must follow start");

export const msbManifestSchema = z.object({
  formatVersion: z.string().regex(/^1\.\d+\.\d+$/),
  project: z.object({
    id,
    title: z.string().min(1),
    description: z.string().optional(),
  }),
  screenplay: relativePath.optional(),
  characters: z.array(
    z.object({
      id,
      name: z.string().min(1),
      description: z.string().min(1),
      reference: relativePath,
    }),
  ),
  locations: z
    .array(
      z.object({
        id,
        description: z.string().min(1),
        reference: relativePath.optional(),
      }),
    )
    .default([]),
  props: z
    .array(
      z.object({
        id,
        description: z.string().min(1),
        reference: relativePath.optional(),
      }),
    )
    .default([]),
  shots: z
    .array(
      z.object({
        id,
        duration: z.union([z.literal(6), z.literal(10)]),
        characters: z.array(id).default([]),
        location: id.optional(),
        dialogue: z.array(dialogueSchema).default([]),
        narration: z.string().optional(),
        action: z.string().min(1),
        camera: z.string().min(1),
        references: z.array(relativePath).default([]),
        continuity: z.array(z.string()).default([]),
      }),
    )
    .min(1),
});

export type MsbManifest = z.infer<typeof msbManifestSchema>;

const msbcOutputSchema = z.object({
  aspectRatio: z.string().regex(/^\d+:\d+$/),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  frameRate: z.number().positive(),
});

const msbcRendererSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  requiredEnvironmentVariables: z
    .array(z.string().regex(/^[A-Z_][A-Z0-9_]*$/))
    .refine(
      (variables) => new Set(variables).size === variables.length,
      "environment variable names must be unique",
    )
    .default([]),
});

export const msbcConfigurationSchema = z
  .object({
    version: z.string().regex(/^1\.\d+\.\d+$/),
    output: msbcOutputSchema,
    renderer: msbcRendererSchema,
  })
  .strict();

export type MsbcConfiguration = z.infer<typeof msbcConfigurationSchema>;

export const msbcFileSchema = z
  .object({
    version: z.string().regex(/^1\.\d+\.\d+$/),
    extends: relativePath.optional(),
    output: msbcOutputSchema.partial().optional(),
    renderer: msbcRendererSchema.partial().optional(),
  })
  .strict();

export type MsbcFile = z.infer<typeof msbcFileSchema>;

export const shotResultSchema = z.object({
  id,
  cacheKey: z.string(),
  status: z.enum(["pending", "complete", "failed"]),
  mediaPath: relativePath.optional(),
  mediaHash: z.string().optional(),
  provider: z.string(),
  model: z.string(),
  requestId: z.string().optional(),
  estimatedCost: z.number().nonnegative(),
  actualCost: z.number().nonnegative(),
  attempts: z.number().int().nonnegative(),
  warnings: z.array(z.string()),
  error: z.string().optional(),
  completedAt: z.string().datetime().optional(),
});

export const msboOutputSchema = z.object({
  formatVersion: z.string().regex(/^1\.\d+\.\d+$/),
  source: z.object({ hash: z.string(), projectId: id, title: z.string() }),
  configuration: z.object({ hash: z.string() }),
  tool: z.object({
    name: z.literal("movie-source-builder"),
    version: z.string(),
  }),
  settings: z.object({
    width: z.number(),
    height: z.number(),
    frameRate: z.number(),
  }),
  status: z.enum(["rendering", "complete", "failed"]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  estimatedCost: z.number().nonnegative(),
  actualCost: z.number().nonnegative(),
  shots: z.array(shotResultSchema),
  warnings: z.array(z.string()),
});

export type MsboOutput = z.infer<typeof msboOutputSchema>;
