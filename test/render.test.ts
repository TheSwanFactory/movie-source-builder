import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { writeArchiveFromDirectory } from "../src/archive.js";
import { createPlan, renderMock } from "../src/render.js";

let bundle: string;
const configuration = path.resolve("examples/compound-interest.msbc");

beforeAll(async () => {
  const root = await mkdtemp(path.join(tmpdir(), "msb-render-"));
  bundle = path.join(root, "sample.msb");
  await writeArchiveFromDirectory(
    path.resolve("examples/compound-interest"),
    bundle,
  );
});

describe("render planning", () => {
  it("is deterministic and estimates all three units", async () => {
    const first = await createPlan(bundle, configuration);
    const second = await createPlan(bundle, configuration);
    expect(first.units.map((unit) => unit.cacheKey)).toEqual(
      second.units.map((unit) => unit.cacheKey),
    );
    expect(first.estimatedCost).toBe(1.5);
  });

  it("enforces max cost before rendering", async () => {
    const output = `${bundle}.msbo`;
    await expect(
      renderMock(bundle, { output, configuration, maxCost: 1 }),
    ).rejects.toThrow("exceeds --max-cost");
  });

  it("performs a provider-free dry run", async () => {
    const plan = await renderMock(bundle, {
      output: `${bundle}.msbo`,
      configuration,
      dryRun: true,
    });
    expect(plan.units).toHaveLength(3);
  });

  it("reports missing renderer environment variables", async () => {
    const required = "MSB_TEST_REQUIRED_RENDERER_TOKEN";
    const previous = process.env[required];
    delete process.env[required];
    const configured = `${bundle}.required-env.msbc`;
    await writeFile(
      configured,
      JSON.stringify({
        formatVersion: "1.0.0",
        output: {
          aspectRatio: "16:9",
          width: 512,
          height: 288,
          frameRate: 24,
        },
        renderer: {
          provider: "mock",
          model: "lavfi-color",
          requiredEnvironmentVariables: [required],
        },
      }),
    );
    try {
      await expect(
        renderMock(bundle, {
          output: `${bundle}.missing-env.msbo`,
          configuration: configured,
          dryRun: true,
        }),
      ).rejects.toThrow(required);
    } finally {
      if (previous === undefined) delete process.env[required];
      else process.env[required] = previous;
    }
  });

  it("reuses unchanged completed shots", async () => {
    const output = `${bundle}.reuse.msbo`;
    await renderMock(bundle, { output, configuration });
    const second = await createPlan(
      bundle,
      configuration,
      JSON.parse(
        (await (await import("../src/archive.js")).readArchive(output))
          .get("output.json")!
          .toString(),
      ),
    );
    expect(second.units.every((unit) => unit.reused)).toBe(true);
    expect(second.estimatedCost).toBe(0);
  }, 60_000);
});
