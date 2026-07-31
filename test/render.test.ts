import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { writeArchiveFromDirectory } from "../src/archive.js";
import { createPlan, renderMock } from "../src/render.js";

let bundle: string;

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
    const first = await createPlan(bundle);
    const second = await createPlan(bundle);
    expect(first.units.map((unit) => unit.cacheKey)).toEqual(
      second.units.map((unit) => unit.cacheKey),
    );
    expect(first.estimatedCost).toBe(1.5);
  });

  it("enforces max cost before rendering", async () => {
    const output = `${bundle}.mso`;
    await expect(renderMock(bundle, { output, maxCost: 1 })).rejects.toThrow(
      "exceeds --max-cost",
    );
  });

  it("performs a provider-free dry run", async () => {
    const plan = await renderMock(bundle, {
      output: `${bundle}.mso`,
      dryRun: true,
    });
    expect(plan.units).toHaveLength(3);
  });

  it("reuses unchanged completed shots", async () => {
    const output = `${bundle}.reuse.mso`;
    await renderMock(bundle, { output });
    const second = await createPlan(
      bundle,
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
