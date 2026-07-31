import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  readArchive,
  writeArchive,
  writeArchiveFromDirectory,
} from "../src/archive.js";

describe("archives", () => {
  it("round trips deterministic entries", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "msb-archive-"));
    const output = path.join(root, "test.msb");
    await writeArchive(new Map([["manifest.json", Buffer.from("{}")]]), output);
    expect((await readArchive(output)).get("manifest.json")?.toString()).toBe(
      "{}",
    );
  });

  it("rejects links in source directories", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "msb-link-"));
    await writeFile(path.join(root, "target"), "x");
    const { symlink } = await import("node:fs/promises");
    await symlink(path.join(root, "target"), path.join(root, "link"));
    await expect(
      writeArchiveFromDirectory(root, path.join(root, "x.msb")),
    ).rejects.toThrow("links are forbidden");
  });

  it("enforces expansion limits", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "msb-limit-"));
    const output = path.join(root, "test.msb");
    await writeArchive(new Map([["large", Buffer.alloc(100)]]), output);
    await expect(
      readArchive(output, {
        maxEntries: 5,
        maxEntryBytes: 10,
        maxTotalBytes: 10,
      }),
    ).rejects.toThrow("too large");
  });
});
