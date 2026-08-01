import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { execa } from "execa";
import {
  readArchive,
  writeArchive,
  writeArchiveFromDirectory,
} from "../src/archive.js";

describe("canonical storyboard prompt plan", () => {
  it("produces ordered, hashed prompts for distinct shot references", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "msb-prompts-"));
    const source = path.join(root, "skit-poc.msb");
    const output = path.join(root, "prompts.json");
    await writeArchiveFromDirectory(path.resolve("examples/skit-poc"), source);
    await execa(process.execPath, [
      "scripts/generate-storyboard-prompts.mjs",
      source,
      "--out",
      output,
    ]);
    const plan = JSON.parse(await readFile(output, "utf8"));
    expect(plan.kind).toBe("storyboard-prompt-plan");
    expect(plan.shots.map((shot: { id: string }) => shot.id)).toEqual([
      "scene-001-shot-001",
      "scene-001-shot-002",
      "scene-001-shot-003",
    ]);
    expect(
      plan.shots.every(
        (shot: { imagePromptHash: string }) =>
          shot.imagePromptHash.length === 64,
      ),
    ).toBe(true);
    expect(
      plan.shots.flatMap((shot: { audio: unknown[] }) => shot.audio),
    ).toHaveLength(7);
    expect(plan.warnings).toEqual([]);
    await execa(process.execPath, [
      "scripts/generate-storyboard-prompts.mjs",
      source,
      "--check",
    ]);

    const duplicateEntries = await readArchive(source);
    const manifest = JSON.parse(duplicateEntries.get("msb.json")!.toString());
    manifest.shots[1].references = manifest.shots[0].references;
    duplicateEntries.set(
      "msb.json",
      Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`),
    );
    const duplicateSource = path.join(root, "duplicate.msb");
    await writeArchive(duplicateEntries, duplicateSource);
    await expect(
      execa(process.execPath, [
        "scripts/generate-storyboard-prompts.mjs",
        duplicateSource,
        "--check",
      ]),
    ).rejects.toThrow("storyboard prompt-plan validation failed");
  });
});
