import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  readArchive,
  writeArchive,
  writeArchiveFromDirectory,
} from "../src/archive.js";
import {
  createPlan,
  falInput,
  falReferenceInput,
  renderMovie,
  verifyRendererAuthentication,
} from "../src/render.js";
import { msbManifestSchema, type MsbManifest } from "../src/schema.js";

let bundle: string;
const configuration = path.resolve("msbc/mock.msbc");

beforeAll(async () => {
  const root = await mkdtemp(path.join(tmpdir(), "msb-render-"));
  bundle = path.join(root, "sample.msb");
  await writeArchiveFromDirectory(path.resolve("examples/skit-poc"), bundle);
});

describe("render planning", () => {
  it("is deterministic and estimates all three units", async () => {
    const first = await createPlan(bundle, configuration);
    const second = await createPlan(bundle, configuration);
    expect(first.units.map((unit) => unit.cacheKey)).toEqual(
      second.units.map((unit) => unit.cacheKey),
    );
    expect(first.estimatedCost).toBe(0);
  });

  it("enforces max cost before rendering", async () => {
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
      await expect(
        renderMovie(bundle, {
          output: `${bundle}.msbo`,
          configuration: path.resolve("msbc/fal-hailuo-02-standard.msbc"),
          maxCost: 1,
        }),
      ).rejects.toThrow("exceeds --max-cost");
    } finally {
      vi.unstubAllGlobals();
      if (previous === undefined) delete process.env.FAL_KEY;
      else process.env.FAL_KEY = previous;
    }
  });

  it("performs a provider-free dry run", async () => {
    const plan = await renderMovie(bundle, {
      output: `${bundle}.msbo`,
      configuration,
      dryRun: true,
    });
    expect(plan.units).toHaveLength(3);
  });

  it("maps shots to model-specific fal inputs", async () => {
    const plan = await createPlan(bundle, configuration);
    const shot = { ...plan.manifest.shots[0]!, duration: 6 as const };
    expect(
      falInput(
        "fal-ai/minimax/hailuo-02/standard/image-to-video",
        { aspectRatio: "16:9", width: 1366, height: 768, frameRate: 25 },
        shot,
        "https://example.test/start.png",
      ),
    ).toMatchObject({ duration: "6", resolution: "768P" });
    expect(
      falInput(
        "fal-ai/ltx-2.3/image-to-video/fast",
        { aspectRatio: "16:9", width: 1920, height: 1080, frameRate: 25 },
        shot,
        "https://example.test/start.png",
      ),
    ).toMatchObject({ duration: 6, resolution: "1080p", fps: 25 });
  });

  it("maps shots to the Veo 3.1 reference-to-video fal input", async () => {
    const plan = await createPlan(bundle, configuration);
    const shot = { ...plan.manifest.shots[0]!, duration: 8 as const };
    const imageUrls = [
      "https://example.test/agent-86.png",
      "https://example.test/agent-99.png",
      "https://example.test/agent-13.png",
    ];
    expect(
      falReferenceInput(
        "fal-ai/veo3.1/fast/reference-to-video",
        { aspectRatio: "16:9", width: 1280, height: 720, frameRate: 24 },
        shot,
        imageUrls,
      ),
    ).toMatchObject({
      image_urls: imageUrls,
      duration: "8s",
      resolution: "720p",
      aspect_ratio: "16:9",
      generate_audio: true,
    });
    expect(() =>
      falReferenceInput(
        "fal-ai/future-provider/future-model",
        { aspectRatio: "16:9", width: 1280, height: 720, frameRate: 24 },
        shot,
        imageUrls,
      ),
    ).toThrow("unsupported fal reference-to-video model");
  });

  it("reports missing renderer environment variables", async () => {
    const required = "MSB_TEST_REQUIRED_RENDERER_TOKEN";
    const previous = process.env[required];
    delete process.env[required];
    const configured = `${bundle}.required-env.msbc`;
    await writeFile(
      configured,
      JSON.stringify({
        version: "1.0.0",
        output: {
          aspectRatio: "16:9",
          width: 512,
          height: 288,
          frameRate: 24,
        },
        renderer: {
          provider: "mock",
          model: "lavfi-color",
          requiredEnvironmentVariables: [required],
        },
      }),
    );
    try {
      await expect(
        renderMovie(bundle, {
          output: `${bundle}.missing-env.msbo`,
          configuration: configured,
          dryRun: true,
        }),
      ).rejects.toThrow(required);
    } finally {
      if (previous === undefined) delete process.env[required];
      else process.env[required] = previous;
    }
  });

  it("reuses unchanged completed shots", async () => {
    const output = `${bundle}.reuse.msbo`;
    await renderMovie(bundle, { output, configuration });
    const entries = await readArchive(output);
    const second = await createPlan(
      bundle,
      configuration,
      JSON.parse(entries.get("msbo.json")!.toString()),
      entries,
    );
    expect(second.units.every((unit) => unit.reused)).toBe(true);
    expect(second.estimatedCost).toBe(0);
  }, 60_000);

  it("does not reuse cached shots with corrupted media", async () => {
    const output = `${bundle}.corrupt-cache.msbo`;
    await renderMovie(bundle, { output, configuration });
    const entries = await readArchive(output);
    const previous = JSON.parse(entries.get("msbo.json")!.toString());
    entries.set(previous.shots[0].mediaPath, Buffer.from("corrupted"));
    await writeArchive(entries, output);

    const metadataOnlyPlan = await createPlan(bundle, configuration, previous);
    expect(metadataOnlyPlan.units.every((unit) => unit.reused)).toBe(true);

    const corruptedEntries = await readArchive(output);
    const plan = await createPlan(
      bundle,
      configuration,
      previous,
      corruptedEntries,
    );
    expect(plan.units[0]!.reused).toBe(false);
    expect(plan.units.slice(1).every((unit) => unit.reused)).toBe(true);
  }, 60_000);

  it("uses the same validated duplicate cache entry for plan and render", async () => {
    const output = `${bundle}.duplicate-cache.msbo`;
    await renderMovie(bundle, { output, configuration });
    const entries = await readArchive(output);
    const previous = JSON.parse(entries.get("msbo.json")!.toString());
    const valid = previous.shots[0];
    const corruptPath = "shots/corrupt.mp4";
    previous.shots.unshift({ ...valid, mediaPath: corruptPath });
    entries.set(corruptPath, Buffer.from("corrupted"));
    entries.set("msbo.json", Buffer.from(JSON.stringify(previous)));
    await writeArchive(entries, output);

    await renderMovie(bundle, { output, configuration });
    const rerendered = JSON.parse(
      (await readArchive(output)).get("msbo.json")!.toString(),
    );
    expect(rerendered.shots[0].requestId).toBe(valid.requestId);
    expect(rerendered.shots[0].warnings).toContain("reused from prior output");
  }, 60_000);

  it("stops scheduling new shots after a concurrent worker fails", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "msb-render-failure-"));
    const workDir = path.join(root, "work");
    let rejectFirst!: (error: Error) => void;
    const firstRender = new Promise<never>((_resolve, reject) => {
      rejectFirst = reject;
    });
    let calls = 0;
    const execa = vi.fn(async () => {
      calls += 1;
      if (calls === 1) return firstRender;
      rejectFirst(new Error("first worker failed"));
      await new Promise((resolve) => setImmediate(resolve));
      throw new Error("second worker stopped");
    });
    vi.doMock("execa", () => ({ execa }));
    try {
      await expect(
        renderMovie(bundle, {
          output: path.join(root, "output.msbo"),
          configuration,
          workDir,
          concurrency: 2,
        }),
      ).rejects.toThrow("first worker failed");
    } finally {
      vi.doUnmock("execa");
    }

    const checkpoint = JSON.parse(
      await readFile(path.join(workDir, "msbo.json"), "utf8"),
    );
    expect(execa).toHaveBeenCalledTimes(2);
    expect(checkpoint.status).toBe("failed");
    expect(
      checkpoint.shots.filter(
        (shot: { status: string }) => shot.status === "pending",
      ),
    ).toHaveLength(1);
    expect(
      checkpoint.shots.filter(
        (shot: { status: string }) => shot.status === "failed",
      ),
    ).toHaveLength(2);
  }, 60_000);
});

describe("renderer authentication", () => {
  it("verifies fal credentials without a generation request", async () => {
    const previous = process.env.FAL_KEY;
    process.env.FAL_KEY = "test-only-not-a-real-key";
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    try {
      await expect(
        verifyRendererAuthentication(
          path.resolve("msbc/fal-hailuo-02-standard.msbc"),
        ),
      ).resolves.toMatchObject({
        provider: "fal",
        verified: true,
        remote: true,
      });
      expect(fetch).toHaveBeenCalledOnce();
      const [url, options] = fetch.mock.calls[0]!;
      expect(String(url)).toBe("https://api.fal.ai/v1/models?limit=1");
      expect(options).toMatchObject({
        headers: { Authorization: "Key test-only-not-a-real-key" },
      });
    } finally {
      vi.unstubAllGlobals();
      if (previous === undefined) delete process.env.FAL_KEY;
      else process.env.FAL_KEY = previous;
    }
  });

  it("rejects invalid fal credentials", async () => {
    const previous = process.env.FAL_KEY;
    process.env.FAL_KEY = "invalid-test-key";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("unauthorized", { status: 401 })),
    );
    try {
      await expect(
        verifyRendererAuthentication(
          path.resolve("msbc/fal-veo-3.1-fast.msbc"),
        ),
      ).rejects.toThrow("fal authentication failed: HTTP 401");
    } finally {
      vi.unstubAllGlobals();
      if (previous === undefined) delete process.env.FAL_KEY;
      else process.env.FAL_KEY = previous;
    }
  });
});

async function chainedBundle(
  change: (manifest: MsbManifest) => void,
): Promise<string> {
  const chainRoot = await mkdtemp(path.join(tmpdir(), "msb-render-chain-"));
  const entries = await readArchive(bundle);
  const manifest = msbManifestSchema.parse(
    JSON.parse(entries.get("msb.json")!.toString()),
  );
  change(manifest);
  entries.set("msb.json", Buffer.from(JSON.stringify(manifest)));
  const chained = path.join(chainRoot, "chained.msb");
  await writeArchive(entries, chained);
  return chained;
}

describe("shot chaining", () => {
  it("rejects chainFrom to an unknown shot", async () => {
    const chained = await chainedBundle((manifest) => {
      manifest.shots[1]!.chainFrom = "no-such-shot";
    });
    await expect(createPlan(chained, configuration)).rejects.toThrow(
      "chains from unknown shot",
    );
  });

  it("rejects a self-referential chainFrom", async () => {
    const chained = await chainedBundle((manifest) => {
      manifest.shots[1]!.chainFrom = manifest.shots[1]!.id;
    });
    await expect(createPlan(chained, configuration)).rejects.toThrow(
      "cannot chain from itself",
    );
  });

  it("rejects a forward-referencing chainFrom", async () => {
    const chained = await chainedBundle((manifest) => {
      manifest.shots[0]!.chainFrom = manifest.shots[1]!.id;
    });
    await expect(createPlan(chained, configuration)).rejects.toThrow(
      "must chain from an earlier shot",
    );
  });

  it("rejects chaining a shot with no authored composition", async () => {
    const chained = await chainedBundle((manifest) => {
      manifest.shots[1]!.chainFrom = manifest.shots[0]!.id;
      manifest.shots[1]!.references = { identity: [] };
    });
    await expect(createPlan(chained, configuration)).rejects.toThrow(
      "has no references.composition to verify against",
    );
  });

  it("rejects chaining under a reference-to-video renderer mode", async () => {
    const chained = await chainedBundle((manifest) => {
      manifest.shots[1]!.chainFrom = manifest.shots[0]!.id;
    });
    await expect(
      createPlan(chained, path.resolve("msbc/fal-veo-3.1-fast-reference.msbc")),
    ).rejects.toThrow('requires renderer.mode "image-to-video"');
  });

  it("cascades a predecessor's content change into the chained shot's cache key", async () => {
    const baseline = await chainedBundle((manifest) => {
      manifest.shots[1]!.chainFrom = manifest.shots[0]!.id;
    });
    const changed = await chainedBundle((manifest) => {
      manifest.shots[1]!.chainFrom = manifest.shots[0]!.id;
      manifest.shots[0]!.action = `${manifest.shots[0]!.action} (revised)`;
    });
    const baselinePlan = await createPlan(baseline, configuration);
    const changedPlan = await createPlan(changed, configuration);
    expect(baselinePlan.units[0]!.cacheKey).not.toBe(
      changedPlan.units[0]!.cacheKey,
    );
    expect(baselinePlan.units[1]!.cacheKey).not.toBe(
      changedPlan.units[1]!.cacheKey,
    );
    expect(baselinePlan.units[2]!.cacheKey).toBe(
      changedPlan.units[2]!.cacheKey,
    );
  });

  it("dry-runs a chained manifest without provider requests", async () => {
    const chained = await chainedBundle((manifest) => {
      manifest.shots[1]!.chainFrom = manifest.shots[0]!.id;
    });
    const plan = await renderMovie(chained, {
      output: `${chained}.msbo`,
      configuration,
      dryRun: true,
    });
    expect(plan.units).toHaveLength(3);
    expect(plan.units[1]!.chainFrom).toBe(plan.units[0]!.id);
  });

  it("renders a chain in dependency order under concurrency and skips the mock similarity gate", async () => {
    const chained = await chainedBundle((manifest) => {
      manifest.shots[1]!.chainFrom = manifest.shots[0]!.id;
    });
    const output = `${chained}.msbo`;
    await renderMovie(chained, { output, configuration, concurrency: 3 });
    const entries = await readArchive(output);
    const result = JSON.parse(entries.get("msbo.json")!.toString());
    expect(result.status).toBe("complete");
    expect(
      result.shots.every(
        (shot: { status: string }) => shot.status === "complete",
      ),
    ).toBe(true);
    expect(new Date(result.shots[0].completedAt).getTime()).toBeLessThanOrEqual(
      new Date(result.shots[1].completedAt).getTime(),
    );
    expect(
      result.shots[1].warnings.some((warning: string) =>
        warning.includes("composition promoted"),
      ),
    ).toBe(false);
  }, 60_000);

  it("resumes a completed chain without hanging on an already-reused predecessor", async () => {
    const chained = await chainedBundle((manifest) => {
      manifest.shots[1]!.chainFrom = manifest.shots[0]!.id;
    });
    const output = `${chained}.msbo`;
    await renderMovie(chained, { output, configuration });
    await renderMovie(chained, { output, configuration });
    const entries = await readArchive(output);
    const result = JSON.parse(entries.get("msbo.json")!.toString());
    expect(
      result.shots.every((shot: { warnings: string[] }) =>
        shot.warnings.includes("reused from prior output"),
      ),
    ).toBe(true);
  }, 60_000);
});
