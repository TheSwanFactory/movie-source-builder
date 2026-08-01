import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readArchive, writeArchive } from "../src/archive.js";
import { msboOutputSchema } from "../src/schema.js";
import { approveStoryboard, createStoryboard } from "../src/storyboard.js";

describe("local storyboard workflow", () => {
  afterEach(() => vi.restoreAllMocks());

  it("creates inspectable local artifacts without network or provider calls", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("network forbidden"));
    const root = await mkdtemp(path.join(tmpdir(), "msb-storyboard-test-"));
    const source = path.resolve("examples/smoke-test.msb");
    const outputFile = path.join(root, "storyboard.msbo");
    await createStoryboard(source, outputFile);
    expect(fetch).not.toHaveBeenCalled();
    expect((await stat(outputFile)).size).toBeGreaterThan(1_000);
    const entries = await readArchive(outputFile);
    const output = msboOutputSchema.parse(
      JSON.parse(entries.get("msbo.json")!.toString()),
    );
    expect(output.kind).toBe("storyboard");
    expect(output.storyboard?.networkRequests).toBe(0);
    expect(output.storyboard?.temporaryAudio).toBe(true);
    expect(output.shots.map((shot) => shot.id)).toEqual(["smoke-shot-001"]);
    expect(entries.has(output.storyboard!.movie)).toBe(true);
    expect(entries.has(output.storyboard!.contactSheet)).toBe(true);
    expect(entries.has("storyboard/panels/smoke-shot-001.svg")).toBe(true);
    expect(entries.has("storyboard/audio/smoke-shot-001.wav")).toBe(true);
    await approveStoryboard(outputFile, source);
    const approved = msboOutputSchema.parse(
      JSON.parse((await readArchive(outputFile)).get("msbo.json")!.toString()),
    );
    expect(approved.storyboard?.approval?.creativeInputHash).toBe(
      approved.storyboard?.creativeInputHash,
    );
  }, 60_000);

  it("rejects approval when the complete source bundle changes", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "msb-storyboard-change-"));
    const source = path.resolve("examples/smoke-test.msb");
    const outputFile = path.join(root, "storyboard.msbo");
    await createStoryboard(source, outputFile);
    const changedEntries = await readArchive(source);
    changedEntries.set(
      "unreferenced-note.txt",
      Buffer.from("creative source changed\n"),
    );
    const changedSource = path.join(root, "changed.msb");
    await writeArchive(changedEntries, changedSource);
    await expect(approveStoryboard(outputFile, changedSource)).rejects.toThrow(
      "source or creative inputs changed",
    );
  }, 60_000);

  it("fails invalid dialogue timing before creating an artifact", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "msb-storyboard-timing-"));
    const entries = await readArchive(path.resolve("examples/smoke-test.msb"));
    const manifest = JSON.parse(entries.get("msb.json")!.toString());
    manifest.shots[0].dialogue = [{ text: "Too long", start: 0, end: 7 }];
    entries.set("msb.json", Buffer.from(`${JSON.stringify(manifest)}\n`));
    const source = path.join(root, "invalid.msb");
    const outputFile = path.join(root, "invalid.msbo");
    await writeArchive(entries, source);
    await expect(createStoryboard(source, outputFile)).rejects.toThrow(
      "dialogue exceeds shot smoke-shot-001 duration",
    );
    await expect(stat(outputFile)).rejects.toThrow();
  });
});
