import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { execa } from "execa";
import { writeArchiveFromDirectory } from "../src/archive.js";
import { readArchive } from "../src/archive.js";
import { exportMovie } from "../src/export.js";
import { renderMovie } from "../src/render.js";
import { msboOutputSchema } from "../src/schema.js";

describe("mocked end-to-end movie", () => {
  it("packs, renders, and exports without paid providers", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "msb-e2e-"));
    const bundle = path.join(root, "sample.msb");
    const output = path.join(root, "sample.msbo");
    const movie = path.join(root, "sample.mp4");
    await writeArchiveFromDirectory(path.resolve("examples/skit-poc"), bundle);
    await renderMovie(bundle, {
      output,
      configuration: path.resolve("msbc/mock.msbc"),
    });
    const outputEntries = await readArchive(output);
    const outputJson = outputEntries.get("msbo.json");
    expect(outputJson).toBeDefined();
    expect(
      msboOutputSchema.parse(JSON.parse(outputJson!.toString("utf8"))).status,
    ).toBe("complete");
    await exportMovie(output, movie);
    expect((await stat(movie)).size).toBeGreaterThan(1_000);

    await execa(process.execPath, [
      "dist/cli.js",
      "make",
      bundle,
      "--config",
      path.resolve("msbc/mock.msbc"),
      "--out",
      movie,
      "--force",
    ]);
    const rerunOutput = msboOutputSchema.parse(
      JSON.parse((await readArchive(output)).get("msbo.json")!.toString()),
    );
    expect(
      rerunOutput.shots.every((shot) =>
        shot.warnings.includes("reused from prior output"),
      ),
    ).toBe(true);
  }, 60_000);
});
