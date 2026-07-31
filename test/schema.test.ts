import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  msbManifestSchema,
  msbcConfigurationSchema,
  msboOutputSchema,
} from "../src/schema.js";

const manifest = JSON.parse(
  readFileSync("examples/compound-interest/manifest.json", "utf8"),
) as Record<string, unknown>;
const configuration = JSON.parse(
  readFileSync("examples/compound-interest.msbc", "utf8"),
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

  it("accepts the example configuration", () => {
    expect(msbcConfigurationSchema.parse(configuration).renderer.provider).toBe(
      "mock",
    );
  });

  it("rejects content-specific configuration", () => {
    expect(() =>
      msbcConfigurationSchema.parse({ ...configuration, style: {} }),
    ).toThrow();
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
