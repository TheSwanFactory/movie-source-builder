import { describe, expect, it } from "vitest";
import { execa } from "execa";

describe("published package contents", () => {
  it("includes the v2 runtime, schemas, prompts, and smoke-test bundles", async () => {
    const { stdout } = await execa("npm", ["pack", "--dry-run", "--json"]);
    const packages = JSON.parse(stdout) as Array<{
      files: Array<{ path: string }>;
    }>;
    const files = packages[0]?.files;
    expect(files).toBeDefined();
    const paths = files!.map((file) => file.path);
    expect(paths).toContain("dist/cli.js");
    expect(paths).toContain("dist/shoot.js");
    expect(paths).toContain("dist/project.d.ts");
    expect(paths).toContain("scripts/generate-storyboard-prompts.mjs");
    expect(paths).toContain(
      "scripts/prompts/03-producer-generate-reference-images.md",
    );
    expect(paths).toContain("schemas/msb-shoot.schema.json");
    expect(paths).toContain("schemas/msb-screenplay.schema.json");
    expect(paths).toContain("examples/smoke-test.msb");
    expect(paths).toContain("examples/smoke-test-reference.msb");
  });
});
