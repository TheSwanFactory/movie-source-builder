import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  cueSchema,
  dailiesSchema,
  msbHeaderSchema,
  msbcConfigurationSchema,
  msbcFileSchema,
  referenceImageSchema,
  referencesIndexSchema,
  screenplaySchema,
  shootSchema,
  shotlistSchema,
} from "../src/schema.js";
import { loadMsbc } from "../src/render.js";

const runnableConfigurations = readdirSync("msbc", {
  withFileTypes: true,
})
  .filter((entry) => entry.isFile() && entry.name.endsWith(".msbc"))
  .map((entry) => path.resolve("msbc", entry.name));

const readJson = (file: string): Record<string, unknown> =>
  JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;

describe("v2 project schemas", () => {
  it("accepts the example project header, screenplay, references, and shot list", () => {
    const header = msbHeaderSchema.parse(
      readJson("examples/skit-poc/msb.json"),
    );
    expect(header.cast).toHaveLength(4);
    expect(header.cast.map((member) => member.kind)).toContain("location");
    const screenplay = screenplaySchema.parse(
      readJson("examples/skit-poc/screenplay.json"),
    );
    expect(screenplay.screenplay.duration).toBe(32);
    expect(screenplay.scenes[0]!.cues.length).toBeGreaterThan(5);
    const references = referencesIndexSchema.parse(
      readJson("examples/skit-poc/references/references.json"),
    );
    expect(
      references.images.filter((image) => image.kind === "board"),
    ).toHaveLength(4);
    const shotlist = shotlistSchema.parse(
      readJson("examples/skit-poc/shotlists/001.json"),
    );
    expect(shotlist.scenes[0]!.shots).toHaveLength(4);
    expect(shotlist.scenes[0]!.shots[0]!.prompts["fal-ltx-2.3-fast"]).toMatch(
      /EXACTLY three/,
    );
  });

  it("rejects v1 format versions", () => {
    const header = readJson("examples/skit-poc/msb.json");
    expect(() =>
      msbHeaderSchema.parse({ ...header, formatVersion: "1.1.0" }),
    ).toThrow();
  });

  it("rejects a point cue with a span and a span cue with a point", () => {
    const base = { id: "c001", text: "x" };
    expect(() =>
      cueSchema.parse({
        ...base,
        kind: "action",
        span: [0, 1],
      }),
    ).toThrow();
    expect(() =>
      cueSchema.parse({
        ...base,
        kind: "dialogue",
        at: 0,
      }),
    ).toThrow();
    expect(() =>
      cueSchema.parse({
        ...base,
        kind: "dialogue",
        span: [2, 1],
      }),
    ).toThrow();
  });

  it("requires boards to carry anchors and model sheets not to", () => {
    const element = referenceImageSchema;
    expect(() =>
      element.parse({ file: "references/x.png", kind: "board" }),
    ).toThrow(/requires a cue anchor/);
    expect(() =>
      element.parse({
        file: "references/x.png",
        kind: "model-sheet",
        anchor: { cue: "c001", at: 0, screenplayHash: "0".repeat(64) },
      }),
    ).toThrow(/timeless/);
  });

  it("rejects paths escaping the project root", () => {
    const element = referenceImageSchema;
    expect(() =>
      element.parse({ file: "../outside.png", kind: "model-sheet" }),
    ).toThrow();
    expect(() =>
      element.parse({ file: "/absolute.png", kind: "model-sheet" }),
    ).toThrow();
  });

  it("round-trips a shoot ledger entry", () => {
    const configuration = msbcConfigurationSchema.parse({
      version: "1.0.0",
      output: { aspectRatio: "16:9", width: 512, height: 288, frameRate: 24 },
      renderer: {
        provider: "mock",
        model: "lavfi-color",
        requiredEnvironmentVariables: [],
      },
    });
    const shoot = shootSchema.parse({
      formatVersion: "2.0.0",
      shoot: {
        id: "0002-hailuo",
        createdAt: "2026-08-05T04:02:11.000Z",
        status: "complete",
      },
      shotlist: { id: "002", hash: "a".repeat(64) },
      engine: {
        configName: "fal-hailuo-02-standard",
        hash: "b".repeat(64),
        resolved: configuration,
      },
      tool: { name: "movie-source-builder", version: "0.7.0" },
      costs: { estimated: 1.86, actual: 0.62 },
      reused: [
        {
          shot: "shot-001",
          take: "shot-001.t02",
          from: "0001-ltx",
          mediaHash: "c".repeat(64),
          cacheKey: "d".repeat(64),
        },
      ],
      takes: [
        {
          shot: "shot-002",
          take: "shot-002.t03",
          status: "rendered",
          cacheKey: "e".repeat(64),
          media: "takes/shot-002.t03.mp4",
          mediaHash: "f".repeat(64),
          lastFrame: "takes/shot-002.t03.last.png",
          chainScore: 0.91,
          requestId: "fal-123",
          cost: 0.62,
          error: null,
        },
      ],
      findings: [
        {
          scope: "engine-compatibility",
          engine: "fal/veo-3.1-fast image-to-video",
          claim: "duration menu is 6s/8s only",
          appliesTo: ["shot-001"],
        },
      ],
      warnings: [],
    });
    expect(shoot.takes[0]!.warnings).toEqual([]);
    expect(shoot.findings[0]!.scope).toBe("engine-compatibility");
  });

  it("round-trips a dailies ledger entry and rejects malformed take ids", () => {
    const dailies = dailiesSchema.parse({
      formatVersion: "2.0.0",
      dailies: { id: "0001", at: "2026-08-05T04:20:00.000Z", by: "author" },
      observations: [
        {
          subject: { take: "shot-001.t01" },
          verdict: "rejected",
          notes: "takes/shot-001.t01.notes.md",
        },
        { subject: { take: "shot-001.t02" }, verdict: "circled" },
      ],
    });
    expect(dailies.observations).toHaveLength(2);
    expect(() =>
      dailiesSchema.parse({
        formatVersion: "2.0.0",
        dailies: { id: "0001", at: "2026-08-05T04:20:00.000Z", by: "author" },
        observations: [{ subject: { take: "not-a-take" }, verdict: "circled" }],
      }),
    ).toThrow();
  });

  it("accepts verdict-less observations on cuts, the animatic, and the session", () => {
    const dailies = dailiesSchema.parse({
      formatVersion: "2.0.0",
      dailies: { id: "0002", at: "2026-08-06T15:00:00.000Z", by: "author" },
      observations: [
        {
          subject: { cut: "0002-default", span: [22, 32] },
          text: "Final scene insane: puppets vanish, a human delivers replacements.",
          attachments: ["dailies/0002/insane-ending.png"],
        },
        { subject: { animatic: true }, verdict: "circled" },
        { text: "watched cut 0002 with the author" },
      ],
    });
    expect(dailies.observations).toHaveLength(3);
  });

  it("rejects contentless observations, subjectless verdicts, and cut verdicts", () => {
    const session = {
      formatVersion: "2.0.0",
      dailies: { id: "0003", at: "2026-08-06T15:00:00.000Z", by: "author" },
    };
    // No verdict, text, notes, or attachments: nothing was observed.
    expect(() =>
      dailiesSchema.parse({
        ...session,
        observations: [{ subject: { take: "shot-001.t01" } }],
      }),
    ).toThrow();
    expect(() =>
      dailiesSchema.parse({
        ...session,
        observations: [{ verdict: "circled" }],
      }),
    ).toThrow();
    expect(() =>
      dailiesSchema.parse({
        ...session,
        observations: [{ subject: { cut: "0002" }, verdict: "rejected" }],
      }),
    ).toThrow();
    // Backwards span and mixed subjects are malformed.
    expect(() =>
      dailiesSchema.parse({
        ...session,
        observations: [{ subject: { cut: "0002", span: [32, 22] }, text: "x" }],
      }),
    ).toThrow();
    expect(() =>
      dailiesSchema.parse({
        ...session,
        observations: [
          { subject: { take: "shot-001.t01", cut: "0002" }, text: "x" },
        ],
      }),
    ).toThrow();
  });
});

describe("msbc schemas (unchanged from v1)", () => {
  const configuration = readJson("msbc/mock.msbc");

  it("accepts every MSBC source file", () => {
    const files = readdirSync("msbc", {
      recursive: true,
      encoding: "utf8",
    }).filter((file) => file.endsWith(".msbc"));
    expect(files.length).toBeGreaterThan(1);
    for (const file of files)
      expect(() =>
        msbcFileSchema.parse(JSON.parse(readFileSync(`msbc/${file}`, "utf8"))),
      ).not.toThrow();
  });

  it("rejects content-specific configuration", () => {
    expect(() =>
      msbcFileSchema.parse({ ...configuration, style: {} }),
    ).toThrow();
  });

  it("resolves default configuration inheritance", async () => {
    const defaults = await loadMsbc("msbc/default.msbc");
    const ltx = await loadMsbc("msbc/fal-ltx-2.3-fast.msbc");
    expect(defaults.configuration).toEqual(ltx.configuration);
    expect(defaults.configuration.renderer.provider).toBe("fal");
    expect(defaults.configuration.output.height).toBe(1080);
  });

  it("resolves every runnable MSBC profile", async () => {
    for (const file of runnableConfigurations)
      await expect(loadMsbc(file)).resolves.toMatchObject({
        configuration: {
          version: "1.0.0",
          output: {
            aspectRatio: expect.any(String),
            width: expect.any(Number),
            height: expect.any(Number),
            frameRate: expect.any(Number),
          },
          renderer: {
            provider: expect.any(String),
            model: expect.any(String),
            requiredEnvironmentVariables: expect.any(Array),
          },
        },
      });
  });

  it("validates required renderer environment variable names", () => {
    const renderer = configuration.renderer as Record<string, unknown>;
    expect(() =>
      msbcConfigurationSchema.parse({
        ...configuration,
        renderer: {
          ...renderer,
          requiredEnvironmentVariables: ["FAL_KEY", "FAL_KEY"],
        },
      }),
    ).toThrow();
  });
});
