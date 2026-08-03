import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { execa } from "execa";
import { readArchive } from "../src/archive.js";
import {
  approvePreviz,
  createPreviz,
  validateApprovedPreviz,
} from "../src/previz.js";
import { msboOutputSchema } from "../src/schema.js";
import { approveStoryboard, createStoryboard } from "../src/storyboard.js";
import { renderMovie } from "../src/render.js";

const source = path.resolve("examples/smoke-test.msb");
const configuration = path.resolve("msbc/previz-mock.msbc");

describe("previz workflow", () => {
  it("creates an inspectable, reviewable non-production artifact", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "msb-previz-test-"));
    const storyboard = path.join(root, "storyboard.msbo");
    const outputFile = path.join(root, "previz.msbo");
    await createStoryboard(source, storyboard);
    await approveStoryboard(storyboard, source);
    await createPreviz(source, {
      output: outputFile,
      configuration,
      storyboard,
      maxCost: 0,
    });
    const entries = await readArchive(outputFile);
    const output = msboOutputSchema.parse(
      JSON.parse(entries.get("msbo.json")!.toString()),
    );
    expect(output.kind).toBe("previz");
    expect(output.previz?.nonProduction).toBe(true);
    expect(entries.has(output.previz!.movie)).toBe(true);
    expect(output.shots[0]?.providerInputHash).toMatch(/^[a-f0-9]{64}$/);
    expect(output.warnings.join(" ")).toContain("human review");
    await approvePreviz(outputFile, source);
    await expect(
      validateApprovedPreviz(outputFile, source),
    ).resolves.toBeUndefined();
  }, 60_000);

  it("plans without provider requests", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("network forbidden"));
    const root = await mkdtemp(path.join(tmpdir(), "msb-previz-plan-"));
    const plan = await createPreviz(source, {
      output: path.join(root, "previz.msbo"),
      configuration,
      dryRun: true,
      maxCost: 0,
    });
    expect(plan.units).toHaveLength(1);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects an unapproved storyboard before generation", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "msb-previz-storyboard-"));
    const storyboard = path.join(root, "storyboard.msbo");
    await createStoryboard(source, storyboard);
    await expect(
      createPreviz(source, {
        output: path.join(root, "previz.msbo"),
        configuration,
        storyboard,
      }),
    ).rejects.toThrow("must be approved");
  }, 60_000);

  it("extracts the embedded review MP4 via `msb inspect --extract`", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "msb-previz-extract-"));
    const storyboard = path.join(root, "storyboard.msbo");
    const previz = path.join(root, "previz.msbo");
    const extracted = path.join(root, "review.mp4");
    await createStoryboard(source, storyboard);
    await approveStoryboard(storyboard, source);
    await createPreviz(source, {
      output: previz,
      configuration,
      storyboard,
      maxCost: 0,
    });
    await execa(process.execPath, [
      "dist/cli.js",
      "inspect",
      previz,
      "--extract",
      extracted,
    ]);
    expect((await stat(extracted)).size).toBeGreaterThan(0);

    const render = path.join(root, "render.msbo");
    await renderMovie(source, {
      output: render,
      configuration: path.resolve("msbc/mock.msbc"),
    });
    await expect(
      execa(process.execPath, [
        "dist/cli.js",
        "inspect",
        render,
        "--extract",
        path.join(root, "unused.mp4"),
      ]),
    ).rejects.toThrow("has no embedded review movie");
  }, 60_000);
});
