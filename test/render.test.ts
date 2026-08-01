import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
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
  renderMovie,
  verifyRendererAuthentication,
} from "../src/render.js";

let bundle: string;
const configuration = path.resolve("msbc/mock.msbc");

beforeAll(async () => {
  const root = await mkdtemp(path.join(tmpdir(), "msb-render-"));
  bundle = path.join(root, "sample.msb");
  await writeArchiveFromDirectory(
    path.resolve("examples/compound-interest"),
    bundle,
  );
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

  it("stops scheduling new shots after a concurrent worker fails", async () => {
    const plan = await createPlan(bundle, configuration);
    const root = await mkdtemp(path.join(tmpdir(), "msb-render-failure-"));
    const workDir = path.join(root, "work");
    await mkdir(path.join(workDir, "shots", `${plan.units[0]!.id}.mp4`), {
      recursive: true,
    });

    await expect(
      renderMovie(bundle, {
        output: path.join(root, "output.msbo"),
        configuration,
        workDir,
        concurrency: 2,
      }),
    ).rejects.toThrow();

    const checkpoint = JSON.parse(
      await readFile(path.join(workDir, "msbo.json"), "utf8"),
    );
    expect(checkpoint.status).toBe("failed");
    expect(checkpoint.shots[0].status).toBe("failed");
    expect(checkpoint.shots[2].status).toBe("pending");
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
