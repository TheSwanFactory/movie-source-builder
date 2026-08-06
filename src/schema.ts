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
const formatVersion2 = z.string().regex(/^2\.\d+\.\d+$/);
const contentHash = z.string().regex(/^[0-9a-f]{64}$/);
const shotlistOrdinal = z.string().regex(/^\d{3}$/);
const ledgerOrdinal = z.string().regex(/^\d{4}$/);

/** Take ids are `<shot-id>.t<NN>` with per-shot monotonic numbers. */
export const takeIdPattern = /^([a-z0-9][a-z0-9._-]*)\.t(\d{2,})$/;
const takeId = z.string().regex(takeIdPattern);

// --- msb.json: the project header -----------------------------------------

export const castMemberSchema = z.object({
  id,
  kind: z.enum(["character", "location", "prop"]).default("character"),
  name: z.string().min(1),
  description: z.string().min(1),
  modelSheet: relativePath
    .describe(
      "Isolated, neutral-backdrop identity reference under references/.",
    )
    .optional(),
  needsModelSheet: z
    .boolean()
    .describe(
      "Explicit flag that this cast member's model sheet is still owed; ingest fails a member with neither a model sheet nor this flag.",
    )
    .default(false),
});

export type CastMember = z.infer<typeof castMemberSchema>;

export const msbHeaderSchema = z.object({
  formatVersion: formatVersion2,
  project: z.object({
    id,
    title: z.string().min(1),
    description: z.string().optional(),
  }),
  cast: z.array(castMemberSchema).default([]),
});

export type MsbHeader = z.infer<typeof msbHeaderSchema>;

// --- screenplay.json: the canonical timed screenplay -----------------------

export const cueSchema = z
  .object({
    id,
    kind: z.enum(["action", "dialogue", "narration"]),
    at: z
      .number()
      .nonnegative()
      .describe("Point cues (action beats) mark one moment on the timeline.")
      .optional(),
    span: z
      .tuple([z.number().nonnegative(), z.number().nonnegative()])
      .describe("Span cues (dialogue/narration) occupy [start, end).")
      .optional(),
    character: id.optional(),
    delivery: z.string().optional(),
    text: z.string().min(1),
  })
  .superRefine((cue, context) => {
    if (cue.kind === "action") {
      if (cue.at === undefined || cue.span !== undefined)
        context.addIssue({
          code: "custom",
          message: `action cue ${cue.id} must be a point cue: set at, not span`,
        });
      if (cue.character !== undefined)
        context.addIssue({
          code: "custom",
          message: `action cue ${cue.id} must not name a character`,
        });
    } else {
      if (cue.span === undefined || cue.at !== undefined)
        context.addIssue({
          code: "custom",
          message: `${cue.kind} cue ${cue.id} must be a span cue: set span, not at`,
        });
      else if (cue.span[1] <= cue.span[0])
        context.addIssue({
          code: "custom",
          message: `cue ${cue.id} span end must follow its start`,
        });
    }
  });

export type Cue = z.infer<typeof cueSchema>;

export const screenplaySchema = z.object({
  formatVersion: formatVersion2,
  screenplay: z.object({
    title: z.string().min(1),
    duration: z.number().positive(),
    draft: relativePath.describe(
      "The verbatim draft under drafts/ this canonical screenplay renders.",
    ),
    draftHash: contentHash,
  }),
  scenes: z
    .array(
      z.object({
        id,
        slug: z.string().min(1),
        cues: z.array(cueSchema).min(1),
      }),
    )
    .min(1),
});

export type Screenplay = z.infer<typeof screenplaySchema>;

// --- references/references.json: model sheets and boards --------------------

export const referenceImageSchema = z
  .object({
    file: relativePath.describe(
      "Project-root-relative path under references/.",
    ),
    kind: z.enum(["model-sheet", "board"]),
    subjects: z.array(id).default([]),
    anchor: z
      .object({
        cue: id,
        at: z.number().nonnegative(),
        screenplayHash: contentHash,
      })
      .describe(
        "Boards anchor to a cue; the time and screenplay hash are captured at anchoring time (provenance, not a resolution mechanism).",
      )
      .optional(),
    provenance: z
      .object({
        prompt: relativePath.optional(),
        promptHash: contentHash.optional(),
        generator: z.string().optional(),
        note: z.string().optional(),
      })
      .optional(),
  })
  .superRefine((image, context) => {
    if (image.kind === "board" && image.anchor === undefined)
      context.addIssue({
        code: "custom",
        message: `board ${image.file} requires a cue anchor`,
      });
    if (image.kind === "model-sheet" && image.anchor !== undefined)
      context.addIssue({
        code: "custom",
        message: `model sheet ${image.file} is timeless and must not carry an anchor`,
      });
  });

export type ReferenceImage = z.infer<typeof referenceImageSchema>;

export const referencesIndexSchema = z.object({
  formatVersion: formatVersion2,
  images: z.array(referenceImageSchema).default([]),
});

export type ReferencesIndex = z.infer<typeof referencesIndexSchema>;

// --- shotlists/NNN.json: versioned tilings of the timeline ------------------

export const shotReferencesSchema = z
  .object({
    identity: z
      .array(relativePath)
      .describe(
        "Explicit raster identity references for reference-to-video renderers. Not automatically populated from characters — a path must be listed here to be uploaded.",
      )
      .default([]),
    composition: relativePath
      .describe(
        "Explicit starting-frame / opening-composition raster for single-image renderers.",
      )
      .optional(),
    endFrame: relativePath
      .describe(
        "Explicit ending-frame raster for renderers that support first/last-frame generation.",
      )
      .optional(),
  })
  .strict();

export type ShotReferences = z.infer<typeof shotReferencesSchema>;

export const shotSchema = z.object({
  id,
  span: z
    .tuple([z.number().nonnegative(), z.number().nonnegative()])
    .describe("[start, end) on the screenplay timeline, in seconds."),
  characters: z.array(id).default([]),
  location: id.optional(),
  action: z.string().min(1),
  camera: z.string().min(1),
  references: shotReferencesSchema.default({ identity: [] }),
  continuity: z
    .array(z.string())
    .describe(
      "Text prompt guidance only; this does not lock identity or pass frames between independently generated shots.",
    )
    .default([]),
  prompts: z
    .record(z.string().min(1), z.string().min(1).nullable())
    .describe(
      'Per-engine prompt overrides keyed by engine config name (e.g. "fal-ltx-2.3-fast") or provider/model; the "default" key of null means derive the prompt from action/camera/continuity. Dialogue is always appended from the screenplay cues in the shot span.',
    )
    .default({ default: null }),
  chainFrom: z
    .union([id, z.null()])
    .describe(
      "Id of an earlier shot to chain from. The shot must still author its own references.composition; at shoot time the predecessor's last rendered frame is compared against it, and a drift miss re-renders the predecessor as additional numbered takes (CHAIN_DRIFT_MAX_ATTEMPTS in src/chain.ts) before failing.",
    )
    .optional(),
});

export type Shot = z.infer<typeof shotSchema>;

export const shotlistSchema = z.object({
  formatVersion: formatVersion2,
  shotlist: z.object({
    id: shotlistOrdinal,
    supersedes: shotlistOrdinal.optional(),
    screenplayHash: contentHash,
    createdAt: z.string().datetime(),
    note: z.string().optional(),
  }),
  scenes: z.array(z.object({ id, shots: z.array(shotSchema).min(1) })).min(1),
});

export type Shotlist = z.infer<typeof shotlistSchema>;

// --- .msbc engine configurations (unchanged from v1) ------------------------

const msbcOutputSchema = z.object({
  aspectRatio: z.string().regex(/^\d+:\d+$/),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  frameRate: z.number().positive(),
});

const msbcRendererSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  mode: z
    .enum(["image-to-video", "reference-to-video"])
    .describe(
      "The renderer capability this configuration selects, independent of creative content. Plan creation rejects a model whose registered capabilities do not match this mode.",
    )
    .default("image-to-video"),
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

// --- shoots/NNNN-<engine>.json: the append-only run ledger ------------------

export const findingSchema = z.object({
  scope: z
    .string()
    .min(1)
    .describe(
      'Free-form scope; "engine-compatibility" and "content-fidelity" are the established ones.',
    ),
  engine: z.string().optional(),
  claim: z.string().min(1),
  evidence: z.string().optional(),
  appliesTo: z.array(id).default([]),
});

export type Finding = z.infer<typeof findingSchema>;

export const shootTakeSchema = z.object({
  shot: id,
  take: takeId,
  status: z.enum(["rendered", "failed"]),
  cacheKey: contentHash,
  media: relativePath.optional(),
  mediaHash: contentHash.optional(),
  lastFrame: relativePath.optional(),
  chainScore: z.number().optional(),
  requestId: z.string().optional(),
  cost: z.number().nonnegative().default(0),
  error: z.string().nullable().default(null),
  warnings: z.array(z.string()).default([]),
});

export type ShootTake = z.infer<typeof shootTakeSchema>;

export const shootSchema = z.object({
  formatVersion: formatVersion2,
  shoot: z.object({
    id: z.string().regex(/^\d{4}-[a-z0-9][a-z0-9.-]*$/),
    createdAt: z.string().datetime(),
    status: z.enum(["complete", "failed"]),
  }),
  shotlist: z.object({ id: shotlistOrdinal, hash: contentHash }),
  engine: z.object({
    configName: z.string().min(1),
    hash: contentHash,
    resolved: msbcConfigurationSchema,
  }),
  tool: z.object({
    name: z.literal("movie-source-builder"),
    version: z.string(),
  }),
  costs: z.object({
    estimated: z.number().nonnegative(),
    actual: z.number().nonnegative(),
  }),
  reused: z
    .array(
      z.object({
        shot: id,
        take: takeId,
        from: z.string().min(1),
        mediaHash: contentHash,
        cacheKey: contentHash,
      }),
    )
    .default([]),
  takes: z.array(shootTakeSchema).default([]),
  findings: z.array(findingSchema).default([]),
  warnings: z.array(z.string()).default([]),
});

export type Shoot = z.infer<typeof shootSchema>;

// --- dailies/NNNN.json: the append-only review ledger ------------------------

export const dailiesSchema = z.object({
  formatVersion: formatVersion2,
  dailies: z.object({
    id: ledgerOrdinal,
    at: z.string().datetime(),
    by: z.string().min(1),
  }),
  verdicts: z
    .array(
      z.object({
        take: takeId,
        verdict: z.enum(["circled", "rejected"]),
        notes: relativePath.optional(),
      }),
    )
    .min(1),
});

export type Dailies = z.infer<typeof dailiesSchema>;
