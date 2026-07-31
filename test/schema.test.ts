import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  msbManifestSchema,
  msbcConfigurationSchema,
  msbcFileSchema,
  msboOutputSchema,
} from "../src/schema.js";
import { createPlan, loadMsbc, renderMovie } from "../src/render.js";

const runnableConfigurations = readdirSync("msbc", {
  withFileTypes: true,
})
  .filter((entry) => entry.isFile() && entry.name.endsWith(".msbc"))
  .map((entry) => path.resolve("msbc", entry.name));

const manifest = JSON.parse(
  readFileSync("examples/compound-interest/msb.json", "utf8"),
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

  it("plans the smoke-test MSB with every runnable profile", async () => {
    const environment = new Map<string, string | undefined>();
    try {
      for (const file of runnableConfigurations) {
        const plan = await createPlan("examples/smoke-test.msb", file);
        expect(plan.units).toHaveLength(1);
        expect(plan.units[0]?.duration).toBe(6);
        for (const name of plan.configuration.renderer
          .requiredEnvironmentVariables) {
          if (!environment.has(name)) environment.set(name, process.env[name]);
          process.env[name] = "ci-dry-run-placeholder";
        }
        await expect(
          renderMovie("examples/smoke-test.msb", {
            configuration: file,
            output: "unused-dry-run.msbo",
            dryRun: true,
          }),
        ).resolves.toMatchObject({ units: [{ duration: 6 }] });
      }
    } finally {
      for (const [name, value] of environment)
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
    }
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
