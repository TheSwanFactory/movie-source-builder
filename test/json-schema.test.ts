import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";
import { describe, expect, it } from "vitest";

const readJson = (file: string): Record<string, unknown> =>
  JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;

const ajv = new Ajv2020({ allErrors: true });
const addFormats = addFormatsModule as unknown as (
  instance: Ajv2020,
) => Ajv2020;
addFormats(ajv);

describe("published JSON Schemas", () => {
  it.each([
    [
      "MSB header",
      "schemas/msb-header.schema.json",
      "examples/skit-poc/msb.json",
    ],
    [
      "canonical screenplay",
      "schemas/msb-screenplay.schema.json",
      "examples/skit-poc/screenplay.json",
    ],
    [
      "references index",
      "schemas/msb-references.schema.json",
      "examples/skit-poc/references/references.json",
    ],
    [
      "shot list",
      "schemas/msb-shotlist.schema.json",
      "examples/skit-poc/shotlists/001.json",
    ],
    [
      "MSBC configuration",
      "schemas/msbc-configuration.schema.json",
      "msbc/fal-hailuo-02-standard.msbc",
    ],
  ])("independently validates a %s", (_name, schemaFile, documentFile) => {
    const validate = ajv.compile(readJson(schemaFile));
    expect(
      validate(readJson(documentFile)),
      JSON.stringify(validate.errors),
    ).toBe(true);
  });

  it("independently validates a shoot ledger document", () => {
    const validate = ajv.compile(readJson("schemas/msb-shoot.schema.json"));
    const shoot = {
      formatVersion: "2.0.0",
      shoot: {
        id: "0001-mock",
        createdAt: "2026-08-05T00:00:00.000Z",
        status: "complete",
      },
      shotlist: { id: "001", hash: "a".repeat(64) },
      engine: {
        configName: "mock",
        hash: "b".repeat(64),
        resolved: {
          version: "1.0.0",
          output: {
            aspectRatio: "16:9",
            width: 512,
            height: 288,
            frameRate: 24,
          },
          renderer: {
            provider: "mock",
            model: "lavfi-color",
            mode: "image-to-video",
            requiredEnvironmentVariables: [],
          },
        },
      },
      tool: { name: "movie-source-builder", version: "0.7.0" },
      costs: { estimated: 0, actual: 0 },
      reused: [],
      takes: [
        {
          shot: "shot-001",
          take: "shot-001.t01",
          status: "rendered",
          cacheKey: "c".repeat(64),
          media: "takes/shot-001.t01.mp4",
          mediaHash: "d".repeat(64),
          lastFrame: "takes/shot-001.t01.last.png",
          cost: 0,
          error: null,
          warnings: [],
        },
      ],
      findings: [],
      warnings: [],
    };
    expect(validate(shoot), JSON.stringify(validate.errors)).toBe(true);
  });

  it("independently validates a dailies ledger document", () => {
    const validate = ajv.compile(readJson("schemas/msb-dailies.schema.json"));
    const dailies = {
      formatVersion: "2.0.0",
      dailies: { id: "0001", at: "2026-08-05T00:00:00.000Z", by: "author" },
      verdicts: [{ take: "shot-001.t01", verdict: "circled" }],
    };
    expect(validate(dailies), JSON.stringify(validate.errors)).toBe(true);
  });
});
