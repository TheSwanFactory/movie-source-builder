import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { writeArchiveFromDirectory } from "../src/archive.js";
import { exportMovie } from "../src/export.js";
import { renderMock } from "../src/render.js";

describe("mocked end-to-end movie", () => {
  it("packs, renders, and exports without paid providers", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "msb-e2e-"));
    const bundle = path.join(root, "sample.msb");
    const output = path.join(root, "sample.msbo");
    const movie = path.join(root, "sample.mp4");
    await writeArchiveFromDirectory(
      path.resolve("examples/compound-interest"),
      bundle,
    );
    await renderMock(bundle, {
      output,
      configuration: path.resolve("msbc/mock.msbc"),
    });
    await exportMovie(output, movie);
    expect((await stat(movie)).size).toBeGreaterThan(1_000);
  }, 60_000);
});
