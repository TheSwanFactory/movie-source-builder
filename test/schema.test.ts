import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  msbManifestSchema,
  msbcConfigurationSchema,
  msbcFileSchema,
  msboOutputSchema,
} from "../src/schema.js";
import { loadMsbc } from "../src/render.js";

const manifest = JSON.parse(
  readFileSync("examples/compound-interest/manifest.json", "utf8"),
) as Record<string, unknown>;
const configuration = JSON.parse(
  readFileSync("msbc/mock.msbc", "utf8"),
) as Record<string, unknown>;

describe("schemas", () => {
  it("accepts the example manifest", () => {
    expect(msbManifestSchema.parse(manifest).shots).toHaveLength(3);
  });

  it("rejects unsupported major versions", () => {
    expect(() =>
      msbManifestSchema.parse({ ...manifest, formatVersion: "2.0.0" }),
    ).toThrow();
  });

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
    const hailuo = await loadMsbc("msbc/fal-hailuo-02-standard.msbc");
    expect(defaults.configuration).toEqual(hailuo.configuration);
    expect(defaults.configuration.renderer.provider).toBe("fal");
    expect(defaults.configuration.output.height).toBe(768);
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

  it("requires complete output structure", () => {
    expect(() => msboOutputSchema.parse({ formatVersion: "1.0.0" })).toThrow();
  });
});
