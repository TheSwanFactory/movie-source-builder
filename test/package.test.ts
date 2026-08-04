import { describe, expect, it } from "vitest";
import { execa } from "execa";

describe("published package contents", () => {
  it("includes the storyboard runtime and canonical prompt assets", async () => {
    const { stdout } = await execa("npm", ["pack", "--dry-run", "--json"]);
    const packages = JSON.parse(stdout) as Array<{
      files: Array<{ path: string }>;
    }>;
    const files = packages[0]?.files;
    expect(files).toBeDefined();
    const paths = files!.map((file) => file.path);
    expect(paths).toContain("dist/storyboard.js");
    expect(paths).toContain("dist/storyboard.d.ts");
    expect(paths).toContain("scripts/generate-storyboard-prompts.mjs");
    expect(paths).toContain(
      "scripts/prompts/02-producer-generate-reference-images.md",
    );
    expect(paths).toContain(
      "scripts/prompts/05-producer-generate-timing-audio.md",
    );
    expect(paths).toContain("schemas/msbo-output.schema.json");
  });
});
