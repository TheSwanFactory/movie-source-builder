import { readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { listShoots, scanTakePool } from "../src/project.js";
import { planShoot, runShoot } from "../src/shoot.js";
import { MOCK_CONFIGURATION, makeProject, type Fixture } from "./helpers.js";

const hailuoConfiguration = path.resolve("msbc/fal-hailuo-02-standard.msbc");
const veoConfiguration = path.resolve("msbc/fal-veo-3.1-fast.msbc");

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("shoot planning", () => {
  it("is deterministic and derives dialogue from the screenplay cues in each span", async () => {
    const root = await makeProject();
    const first = await planShoot(root, { configuration: MOCK_CONFIGURATION });
    const second = await planShoot(root, { configuration: MOCK_CONFIGURATION });
    expect(first.plan.units.map((unit) => unit.cacheKey)).toEqual(
      second.plan.units.map((unit) => unit.cacheKey),
    );
    expect(first.plan.units[0]!.lines).toEqual([
      {
        kind: "dialogue",
        character: "hero",
        text: "First line.",
        start: 1,
        end: 4,
      },
    ]);
    expect(first.plan.units[0]!.prompt).toContain("Dialogue: First line.");
    expect(first.plan.units[1]!.prompt).toContain("Dialogue: Second line.");
  });

  it("applies per-engine prompt overrides by config name, keeping derived dialogue", async () => {
    const root = await makeProject((fixture) => {
      fixture.shotlist.scenes[0]!.shots[0]!.prompts = {
        default: null,
        mock: "OVERRIDDEN PROMPT",
      };
    });
    const { plan } = await planShoot(root, {
      configuration: MOCK_CONFIGURATION,
    });
    expect(plan.units[0]!.prompt).toBe(
      "OVERRIDDEN PROMPT\nDialogue: First line.",
    );
    expect(plan.units[1]!.prompt).toContain("The hero does something else.");
  });

  it("cascades a predecessor's content change into the chained shot's cache key", async () => {
    const chain = (fixture: Fixture) => {
      fixture.shotlist.scenes[0]!.shots[1]!.chainFrom = "shot-001";
    };
    const baseline = await makeProject(chain);
    const changed = await makeProject((fixture) => {
      chain(fixture);
      fixture.shotlist.scenes[0]!.shots[0]!.action += " (revised)";
    });
    const baselinePlan = await planShoot(baseline, {
      configuration: MOCK_CONFIGURATION,
    });
    const changedPlan = await planShoot(changed, {
      configuration: MOCK_CONFIGURATION,
    });
    expect(baselinePlan.plan.units[0]!.cacheKey).not.toBe(
      changedPlan.plan.units[0]!.cacheKey,
    );
    expect(baselinePlan.plan.units[1]!.cacheKey).not.toBe(
      changedPlan.plan.units[1]!.cacheKey,
    );
  });

  it("rejects a shot list whose screenplay hash no longer matches", async () => {
    // makeProject recomputes the hash, so tamper after the fact.
    const root = await makeProject();
    const file = path.join(root, "shotlists/001.json");
    const shotlist = JSON.parse(await readFile(file, "utf8"));
    shotlist.shotlist.screenplayHash = "0".repeat(64);
    const { writeFile } = await import("node:fs/promises");
    await writeFile(file, JSON.stringify(shotlist, null, 2) + "\n");
    await expect(
      runShoot(root, { configuration: MOCK_CONFIGURATION, dryRun: true }),
    ).rejects.toThrow("tiles a different screenplay");
  });

  it("rejects chaining under a reference-to-video renderer mode", async () => {
    const root = await makeProject((fixture) => {
      const shot = fixture.shotlist.scenes[0]!.shots[1]!;
      shot.chainFrom = "shot-001";
      shot.span = [6, 12];
    });
    await expect(
      planShoot(root, {
        configuration: path.resolve("msbc/fal-veo-3.1-fast-reference.msbc"),
      }),
    ).rejects.toThrow('requires renderer.mode "image-to-video"');
  });

  it("reports missing renderer environment variables before any network use", async () => {
    const previous = process.env.FAL_KEY;
    delete process.env.FAL_KEY;
    try {
      const root = await makeProject();
      await expect(
        runShoot(root, { configuration: hailuoConfiguration, dryRun: true }),
      ).rejects.toThrow("FAL_KEY");
    } finally {
      if (previous !== undefined) process.env.FAL_KEY = previous;
    }
  });

  it("enforces max cost with live pricing before rendering", async () => {
    const previous = process.env.FAL_KEY;
    process.env.FAL_KEY = "test-only-not-a-real-key";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            prices: [
              {
                endpoint_id: "fal-ai/minimax/hailuo-02/standard/image-to-video",
                unit_price: 0.045,
                unit: "seconds",
                currency: "USD",
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    );
    try {
      const root = await makeProject();
      await expect(
        runShoot(root, { configuration: hailuoConfiguration, maxCost: 0.1 }),
      ).rejects.toThrow("exceeds --max-cost");
      // The failed cost gate must not have appended a shoot.
      expect(await listShoots(root)).toHaveLength(0);
    } finally {
      if (previous === undefined) delete process.env.FAL_KEY;
      else process.env.FAL_KEY = previous;
    }
  });
});

describe("duration-menu plan validation", () => {
  it("records an engine-compatibility finding as a failed shoot, offline", async () => {
    const root = await makeProject((fixture) => {
      // 5s/7s spans fit no Veo menu entry (6s/8s).
      fixture.shotlist.scenes[0]!.shots[0]!.span = [0, 5];
      fixture.shotlist.scenes[0]!.shots[1]!.span = [5, 12];
    });
    const previous = process.env.FAL_KEY;
    delete process.env.FAL_KEY; // proves no credentials are needed to learn this
    try {
      await expect(
        runShoot(root, { configuration: veoConfiguration }),
      ).rejects.toThrow("shoot plan failed and was recorded");
      const shoots = await listShoots(root);
      expect(shoots).toHaveLength(1);
      const shoot = shoots[0]!.shoot;
      expect(shoot.shoot.status).toBe("failed");
      expect(shoot.takes).toEqual([]);
      expect(shoot.reused).toEqual([]);
      expect(shoot.costs).toEqual({ estimated: 0, actual: 0 });
      expect(shoot.findings).toHaveLength(1);
      expect(shoot.findings[0]).toMatchObject({
        scope: "engine-compatibility",
        appliesTo: ["shot-001", "shot-002"],
      });
      expect(shoot.findings[0]!.claim).toContain("6s/8s");
    } finally {
      if (previous !== undefined) process.env.FAL_KEY = previous;
    }
  });

  it("does not write a shoot on --dry-run even when the plan fails", async () => {
    const root = await makeProject((fixture) => {
      fixture.shotlist.scenes[0]!.shots[0]!.span = [0, 5];
      fixture.shotlist.scenes[0]!.shots[1]!.span = [5, 12];
    });
    const result = await runShoot(root, {
      configuration: veoConfiguration,
      dryRun: true,
    });
    expect(result.plan.planValid).toBe(false);
    expect(result.plan.findings).toHaveLength(1);
    expect(await listShoots(root)).toHaveLength(0);
  });
});

describe("shoot execution (mock engine)", () => {
  it("renders takes into the pool with last frames and appends a complete shoot", async () => {
    const root = await makeProject();
    const result = await runShoot(root, { configuration: MOCK_CONFIGURATION });
    expect(result.file).toBe("shoots/0001-mock.json");
    const shoot = result.shoot!;
    expect(shoot.shoot.status).toBe("complete");
    expect(shoot.takes.map((take) => take.take)).toEqual([
      "shot-001.t01",
      "shot-002.t01",
    ]);
    for (const take of shoot.takes) {
      expect(take.status).toBe("rendered");
      expect(take.media).toBe(`takes/${take.take}.mp4`);
      const bytes = await readFile(path.join(root, take.media!));
      expect(bytes.length).toBeGreaterThan(1000);
      await expect(
        readFile(path.join(root, take.lastFrame!)),
      ).resolves.toBeDefined();
    }
    const pool = await scanTakePool(root);
    expect(pool.map((take) => take.take)).toEqual([
      "shot-001.t01",
      "shot-002.t01",
    ]);
  }, 60_000);

  it("reuses unchanged takes as explicit links in a second, append-only shoot", async () => {
    const root = await makeProject();
    await runShoot(root, { configuration: MOCK_CONFIGURATION });
    const second = await runShoot(root, { configuration: MOCK_CONFIGURATION });
    expect(second.file).toBe("shoots/0002-mock.json");
    const shoot = second.shoot!;
    expect(shoot.takes).toEqual([]);
    expect(shoot.reused.map((reuse) => reuse.take)).toEqual([
      "shot-001.t01",
      "shot-002.t01",
    ]);
    expect(shoot.reused[0]!.from).toBe("0001-mock");
    expect(shoot.shoot.status).toBe("complete");
    const files = (await readdir(path.join(root, "shoots"))).sort();
    expect(files).toEqual(["0001-mock.json", "0002-mock.json"]);
  }, 60_000);

  it("does not reuse a take whose pool media was corrupted", async () => {
    const root = await makeProject();
    await runShoot(root, { configuration: MOCK_CONFIGURATION });
    const { writeFile } = await import("node:fs/promises");
    await writeFile(
      path.join(root, "takes/shot-001.t01.mp4"),
      Buffer.from("corrupted"),
    );
    const second = await runShoot(root, { configuration: MOCK_CONFIGURATION });
    expect(second.shoot!.reused.map((reuse) => reuse.take)).toEqual([
      "shot-002.t01",
    ]);
    expect(second.shoot!.takes.map((take) => take.take)).toEqual([
      "shot-001.t02",
    ]);
  }, 60_000);

  it("allocates per-shot monotonic take numbers across shoots with --fresh", async () => {
    const root = await makeProject();
    await runShoot(root, { configuration: MOCK_CONFIGURATION });
    const second = await runShoot(root, {
      configuration: MOCK_CONFIGURATION,
      fresh: true,
    });
    expect(second.shoot!.takes.map((take) => take.take)).toEqual([
      "shot-001.t02",
      "shot-002.t02",
    ]);
    // Numbers never regress even after the pool media is deleted (gc'd).
    await rm(path.join(root, "takes/shot-001.t02.mp4"));
    const third = await runShoot(root, {
      configuration: MOCK_CONFIGURATION,
      fresh: true,
    });
    expect(third.shoot!.takes.map((take) => take.take)).toEqual([
      "shot-001.t03",
      "shot-002.t03",
    ]);
  }, 120_000);

  it("records a failed take and a failed shoot when rendering breaks", async () => {
    const root = await makeProject();
    let calls = 0;
    const execa = vi.fn(async () => {
      calls += 1;
      throw new Error("synthetic ffmpeg failure");
    });
    vi.doMock("execa", () => ({ execa }));
    try {
      await expect(
        runShoot(root, { configuration: MOCK_CONFIGURATION, concurrency: 1 }),
      ).rejects.toThrow("synthetic ffmpeg failure");
    } finally {
      vi.doUnmock("execa");
    }
    const shoots = await listShoots(root);
    expect(shoots).toHaveLength(1);
    const shoot = shoots[0]!.shoot;
    expect(shoot.shoot.status).toBe("failed");
    expect(shoot.takes).toHaveLength(1);
    expect(shoot.takes[0]).toMatchObject({
      shot: "shot-001",
      take: "shot-001.t01",
      status: "failed",
    });
    expect(shoot.takes[0]!.error).toContain("synthetic ffmpeg failure");
    expect(calls).toBeGreaterThan(0);
  }, 60_000);

  it("clamps concurrency to 1 whenever any shot chains from another", async () => {
    const root = await makeProject((fixture) => {
      fixture.shotlist.scenes[0]!.shots[1]!.chainFrom = "shot-001";
    });
    const result = await runShoot(root, {
      configuration: MOCK_CONFIGURATION,
      concurrency: 4,
    });
    expect(result.shoot!.shoot.status).toBe("complete");
    expect(
      result.shoot!.warnings.some((warning) =>
        warning.includes("concurrency clamped to 1"),
      ),
    ).toBe(true);
  }, 60_000);
});
