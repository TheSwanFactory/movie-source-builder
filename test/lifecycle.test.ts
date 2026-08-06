import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { execa } from "execa";
import { readArchive } from "../src/archive.js";
import { createAnimatic } from "../src/animatic.js";
import { createCut } from "../src/cut.js";
import { appendVerdict, listUnreviewed } from "../src/dailies.js";
import { collectGarbage } from "../src/gc.js";
import { aggregateFindings, shotHistory } from "../src/inspect.js";
import { packProject } from "../src/pack.js";
import {
  computeLatest,
  ingestProject,
  listDailies,
  listShoots,
} from "../src/project.js";
import { createProject } from "../src/scaffold.js";
import { runShoot } from "../src/shoot.js";
import { MOCK_CONFIGURATION, makeProject } from "./helpers.js";

describe("create + scaffold", () => {
  it("scaffolds the folder, copies the draft verbatim, and ships a .gitignore", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "msb-create-"));
    const draft = path.join(root, "My Screenplay.DOCX");
    await writeFile(draft, "the author's exact bytes");
    const project = path.join(root, "my-movie");
    const result = await createProject(project, draft);
    expect(result.draft).toBe("drafts/My Screenplay.DOCX");
    expect((await readFile(path.join(project, result.draft))).toString()).toBe(
      "the author's exact bytes",
    );
    const gitignore = await readFile(path.join(project, ".gitignore"), "utf8");
    expect(gitignore).toContain("takes/*.mp4");
    expect(gitignore).toContain("cuts/");
    for (const directory of [
      "drafts",
      "references",
      "shotlists",
      "takes",
      "shoots",
      "dailies",
      "cuts",
    ])
      expect((await stat(path.join(project, directory))).isDirectory()).toBe(
        true,
      );
    // Ingest correctly refuses the scaffold until a Producer canonicalizes.
    await expect(ingestProject(project)).rejects.toThrow("screenplay.json");
    await expect(createProject(project, draft)).rejects.toThrow("not empty");
  });
});

describe("dailies, cut, gc, and latest", () => {
  it("walks the full review lifecycle", async () => {
    const root = await makeProject();

    // Shoot twice (second fresh) so every shot has two takes.
    await runShoot(root, { configuration: MOCK_CONFIGURATION });
    await runShoot(root, { configuration: MOCK_CONFIGURATION, fresh: true });

    const unreviewed = await listUnreviewed(root);
    expect(unreviewed.map((take) => take.take).sort()).toEqual([
      "shot-001.t01",
      "shot-001.t02",
      "shot-002.t01",
      "shot-002.t02",
    ]);

    // Circle an older take with notes; reject a newer one.
    const notesFile = path.join(root, "review.md");
    await writeFile(notesFile, "solid opening\n");
    const circled = await appendVerdict(root, "shot-001.t01", {
      verdict: "circled",
      notesFile,
      by: "author",
    });
    expect(circled.file).toBe("dailies/0001.json");
    expect(circled.notes).toBe("takes/shot-001.t01.notes.md");
    expect(
      (await readFile(path.join(root, circled.notes!), "utf8")).toString(),
    ).toContain("solid opening");
    await appendVerdict(root, "shot-002.t02", {
      verdict: "rejected",
      by: "author",
    });
    expect(await listDailies(root)).toHaveLength(2);
    expect(
      (await listUnreviewed(root)).map((take) => take.take).sort(),
    ).toEqual(["shot-001.t02", "shot-002.t01"]);

    // Verdicts on unknown takes and circling failed takes are refused.
    await expect(
      appendVerdict(root, "shot-009.t01", { verdict: "circled" }),
    ).rejects.toThrow("no shoot records take");

    // The cut takes the circled shot-001.t01 over the newer t02, and the
    // newest never-rejected shot-002.t01 over the rejected t02.
    const cut = await createCut(root);
    expect(cut.shootId).toBe("0002-mock");
    expect(cut.takes).toEqual([
      { shot: "shot-001", take: "shot-001.t01" },
      { shot: "shot-002", take: "shot-002.t01" },
    ]);
    expect((await stat(cut.file)).size).toBeGreaterThan(1000);
    expect(cut.file).toBe(path.join(root, "cuts/0002-mock.mp4"));

    // A re-review flips the standing: latest verdict wins.
    await appendVerdict(root, "shot-002.t01", { verdict: "rejected" });
    await expect(createCut(root)).rejects.toThrow(
      "shot shot-002 has no circled or unrejected rendered take",
    );
    await appendVerdict(root, "shot-002.t01", { verdict: "circled" });
    await expect(createCut(root)).resolves.toBeDefined();

    // latest: shot list 001, shoot 0002-mock, current takes per the cut rule.
    const latest = await computeLatest(root);
    expect(latest).toMatchObject({
      shotlist: "001",
      shoot: "0002-mock",
      current: [
        { shot: "shot-001", take: "shot-001.t01", standing: "circled" },
        { shot: "shot-002", take: "shot-002.t01", standing: "circled" },
      ],
    });

    // gc dry-run reports without deleting; the real run deletes only the
    // reclaimable .mp4, never notes, last frames, or ledger JSON.
    const dryRun = await collectGarbage(root, { dryRun: true });
    expect(dryRun.reclaimed).toEqual(["takes/shot-002.t02.mp4"]);
    await stat(path.join(root, "takes/shot-002.t02.mp4"));
    const real = await collectGarbage(root);
    expect(real.reclaimed).toEqual(["takes/shot-002.t02.mp4"]);
    await expect(
      stat(path.join(root, "takes/shot-002.t02.mp4")),
    ).rejects.toThrow();
    await stat(path.join(root, "takes/shot-002.t02.last.png"));
    await stat(path.join(root, "takes/shot-001.t01.notes.md"));
    expect(await listShoots(root)).toHaveLength(2);

    // The record that the take happened survives gc.
    const history = await shotHistory(root, "shot-002");
    expect(history.map((entry) => entry.take)).toEqual([
      "shot-002.t01",
      "shot-002.t02",
    ]);
    expect(history[1]!.media).toBeUndefined();
    expect(aggregateFindings(await listShoots(root))).toEqual([]);
  }, 120_000);
});

describe("animatic", () => {
  it("assembles the zero-network review movie before any shot list is needed", async () => {
    const root = await makeProject();
    const output = await createAnimatic(root);
    expect(output).toBe(path.join(root, "cuts/animatic.mp4"));
    expect((await stat(output)).size).toBeGreaterThan(1000);
  }, 60_000);
});

describe("pack", () => {
  it("packs the whole folder, and --source-only omits ledgers and outputs", async () => {
    const root = await makeProject();
    await runShoot(root, { configuration: MOCK_CONFIGURATION });
    const full = path.join(root, "..", `${path.basename(root)}-full.msb`);
    await packProject(root, full);
    const fullEntries = await readArchive(full);
    expect([...fullEntries.keys()]).toContain("takes/shot-001.t01.mp4");
    expect([...fullEntries.keys()]).toContain("shoots/0001-mock.json");
    expect([...fullEntries.keys()]).toContain("msb.json");
    const source = path.join(root, "..", `${path.basename(root)}-src.msb`);
    await packProject(root, source, { sourceOnly: true });
    const sourceEntries = [...(await readArchive(source)).keys()];
    expect(sourceEntries).toContain("screenplay.json");
    expect(sourceEntries).toContain("shotlists/001.json");
    expect(sourceEntries).toContain("references/hero.png");
    expect(sourceEntries.some((name) => name.startsWith("takes/"))).toBe(false);
    expect(sourceEntries.some((name) => name.startsWith("shoots/"))).toBe(
      false,
    );
    expect(sourceEntries.some((name) => name.startsWith("dailies/"))).toBe(
      false,
    );
    expect(sourceEntries.some((name) => name.startsWith("cuts/"))).toBe(false);
  }, 60_000);

  it("refuses to pack a folder that fails ingest", async () => {
    const root = await makeProject((fixture) => {
      fixture.screenplay.scenes[0]!.cues[1]!.character = "stranger";
    });
    await expect(
      packProject(root, path.join(root, "..", "bad.msb")),
    ).rejects.toThrow("does not resolve to a cast member");
  });
});

describe("CLI", () => {
  it("shoots, reviews, and cuts through the executable with v2 exit codes", async () => {
    const root = await makeProject();
    const cli = (...args: string[]) =>
      execa(process.execPath, ["dist/cli.js", ...args], { reject: false });

    const ingest = await cli("ingest", root);
    expect(ingest.exitCode).toBe(0);
    expect(ingest.stdout).toContain("Ingested");

    const shoot = await cli("shoot", root, "--config", MOCK_CONFIGURATION);
    expect(shoot.exitCode).toBe(0);
    expect(shoot.stdout).toContain("shoots/0001-mock.json");

    const screenplay = await cli("inspect", root, "--screenplay");
    expect(screenplay.stdout).toContain("FIXTURE PROJECT");
    expect(screenplay.stdout).toContain("HERO:");

    const circle = await cli("circle", root, "--take", "shot-001.t01");
    expect(circle.exitCode).toBe(0);

    const cut = await cli("cut", root);
    expect(cut.exitCode).toBe(0);
    expect(cut.stdout).toContain("cuts/0001-mock.mp4");

    const missing = await cli("ingest", path.join(root, "no-such-folder"));
    expect(missing.exitCode).toBe(3);
  }, 120_000);
});
