import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { execa } from "execa";

describe("reference-image request plan (v2 project folder)", () => {
  it("requests every model sheet and board with hashed prompts and identity anchors", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "msb-requests-"));
    const output = path.join(root, "requests.json");
    await execa(process.execPath, [
      "scripts/generate-storyboard-prompts.mjs",
      "examples/skit-poc",
      "--out",
      output,
    ]);
    const plan = JSON.parse(await readFile(output, "utf8"));
    expect(plan.kind).toBe("reference-image-request-plan");
    expect(
      plan.requests.every(
        (request: { status: string }) => request.status === "present",
      ),
    ).toBe(true);
    const byRole = (role: string) =>
      plan.requests.filter(
        (request: { role: string }) => request.role === role,
      );
    expect(byRole("model-sheet")).toHaveLength(4);
    expect(byRole("composition")).toHaveLength(4);
    for (const request of byRole("composition"))
      expect(request.identityAnchors.length).toBeGreaterThan(0);
    expect(
      plan.requests.every(
        (request: { promptHash: string }) => request.promptHash.length === 64,
      ),
    ).toBe(true);
    expect(plan.warnings).toEqual([]);
    await execa(process.execPath, [
      "scripts/generate-storyboard-prompts.mjs",
      "examples/skit-poc",
      "--require-complete",
    ]);
  });

  it("fails --require-complete when a requested image is missing", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "msb-requests-missing-"));
    const directory = path.join(root, "source");
    await cp(path.resolve("examples/skit-poc"), directory, { recursive: true });
    await rm(path.join(directory, "references/agent-86.png"));
    await expect(
      execa(process.execPath, [
        "scripts/generate-storyboard-prompts.mjs",
        directory,
        "--require-complete",
      ]),
    ).rejects.toThrow("reference-image request plan is incomplete");
  });

  it("rejects a packed archive; the plan works on folders only", async () => {
    await expect(
      execa(process.execPath, [
        "scripts/generate-storyboard-prompts.mjs",
        "examples/smoke-test.msb",
      ]),
    ).rejects.toThrow("not a project folder");
  });
});
