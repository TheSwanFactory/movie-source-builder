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
      "MSB manifest",
      "schemas/msb-manifest.schema.json",
      "examples/smoke-test/msb.json",
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

  it("independently validates an MSBO output document", () => {
    const validate = ajv.compile(readJson("schemas/msbo-output.schema.json"));
    const timestamp = "2026-07-31T00:00:00.000Z";
    const output = {
      formatVersion: "1.0.0",
      source: { hash: "source", projectId: "smoke-test", title: "Smoke test" },
      configuration: { hash: "configuration" },
      tool: { name: "movie-source-builder", version: "0.2.0" },
      settings: { width: 1280, height: 720, frameRate: 24 },
      status: "complete",
      createdAt: timestamp,
      updatedAt: timestamp,
      estimatedCost: 0,
      actualCost: 0,
      shots: [],
      warnings: [],
    };
    expect(validate(output), JSON.stringify(validate.errors)).toBe(true);
  });
});
