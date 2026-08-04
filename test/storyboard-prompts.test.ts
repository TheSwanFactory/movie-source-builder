import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
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

describe("reference-image request plan (pre-pack directory mode)", () => {
  it("reports every referenced asset's presence with a clean request for each generatable role", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "msb-requests-"));
    const directory = path.join(root, "source");
    await cp(path.resolve("examples/skit-poc"), directory, {
      recursive: true,
    });
    const output = path.join(root, "requests.json");
    await execa(process.execPath, [
      "scripts/generate-storyboard-prompts.mjs",
      directory,
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
    expect(byRole("character-reference")).toHaveLength(3);
    expect(byRole("location-reference")).toHaveLength(1);
    expect(byRole("composition")).toHaveLength(3);
    for (const request of byRole("composition"))
      expect(request.identityAnchors.length).toBeGreaterThan(0);
    await execa(process.execPath, [
      "scripts/generate-storyboard-prompts.mjs",
      directory,
      "--require-complete",
    ]);

    await rm(path.join(directory, "characters/agent-86.png"));
    await expect(
      execa(process.execPath, [
        "scripts/generate-storyboard-prompts.mjs",
        directory,
        "--require-complete",
      ]),
    ).rejects.toThrow("reference-image request plan is incomplete");
  });

  it("rejects --check in directory mode and --require-complete against a packed bundle", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "msb-requests-guard-"));
    const directory = path.join(root, "source");
    await cp(path.resolve("examples/skit-poc"), directory, {
      recursive: true,
    });
    const bundle = path.join(root, "skit-poc.msb");
    await writeArchiveFromDirectory(directory, bundle);

    await expect(
      execa(process.execPath, [
        "scripts/generate-storyboard-prompts.mjs",
        directory,
        "--check",
      ]),
    ).rejects.toThrow("--check only applies to a packed .msb");
    await expect(
      execa(process.execPath, [
        "scripts/generate-storyboard-prompts.mjs",
        bundle,
        "--require-complete",
      ]),
    ).rejects.toThrow("--require-complete only applies to a source directory");
  });
});
