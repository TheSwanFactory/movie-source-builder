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
    expect(msbcConfigurationSchema.parse(configuration).video.provider).toBe(
      "mock",
    );
  });

  it("requires complete output structure", () => {
    expect(() => msboOutputSchema.parse({ formatVersion: "1.0.0" })).toThrow();
  });
});
