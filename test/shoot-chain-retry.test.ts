import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execa } from "execa";
import ffmpegStatic from "ffmpeg-static";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { CHAIN_DRIFT_MAX_ATTEMPTS } from "../src/chain.js";
import { listShoots } from "../src/project.js";
import { runShoot } from "../src/shoot.js";
import { makeProject } from "./helpers.js";

const ffmpeg = ffmpegStatic as unknown as string;
const model = "fal-ai/minimax/hailuo-02/standard/image-to-video";
const configuration = path.resolve("msbc/fal-hailuo-02-standard.msbc");

vi.mock("@fal-ai/client", () => ({
  fal: {
    config: vi.fn(),
    storage: { upload: vi.fn(async () => "https://fake.test/uploaded.png") },
    subscribe: vi.fn(),
  },
}));

let scratch: string;

beforeAll(async () => {
  scratch = await mkdtemp(path.join(tmpdir(), "msb-chain-retry-"));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// 16:9, matching the fal-hailuo-02-standard format, so the render's
// scale+pad step never introduces black bars that would wash out the
// solid-color signal the drift check relies on.
async function solidColorPng(color: string, name: string): Promise<Buffer> {
  const file = path.join(scratch, name);
  await execa(ffmpeg, [
    "-y",
    "-f",
    "lavfi",
    "-i",
    `color=c=${color}:s=160x90`,
    "-frames:v",
    "1",
    file,
  ]);
  return readFile(file);
}

async function solidColorClip(color: string, name: string): Promise<Buffer> {
  const file = path.join(scratch, name);
  await execa(ffmpeg, [
    "-y",
    "-f",
    "lavfi",
    "-i",
    `color=c=${color}:s=160x90:r=6:d=1`,
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    file,
  ]);
  return readFile(file);
}

/** A chained two-shot project whose successor expects `color` as its board. */
async function chainedProject(successorColor: string): Promise<string> {
  const root = await makeProject((fixture) => {
    fixture.shotlist.scenes[0]!.shots[1]!.chainFrom = "shot-001";
  });
  await writeFile(
    path.join(root, "references/t0007.0-mid.png"),
    await solidColorPng(successorColor, `successor-${successorColor}.png`),
  );
  return root;
}

async function stubFalNetwork(
  videoColors: string[],
): Promise<{ subscribeCalls: () => number; uploads: Buffer[] }> {
  const clips = new Map<string, Buffer>();
  const uploads: Buffer[] = [];
  let subscribeCalls = 0;

  for (let i = 0; i < videoColors.length; i++) {
    clips.set(
      `https://fake.test/video-${i + 1}.mp4`,
      await solidColorClip(
        videoColors[i]!,
        `video-${i + 1}-${Math.random().toString(36).slice(2)}.mp4`,
      ),
    );
  }

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("models/pricing")) {
        return new Response(
          JSON.stringify({
            prices: [
              {
                endpoint_id: model,
                unit_price: 0.05,
                unit: "seconds",
                currency: "USD",
              },
            ],
          }),
          { status: 200 },
        );
      }
      const bytes = clips.get(url);
      if (!bytes) throw new Error(`unexpected fetch: ${url}`);
      return new Response(new Uint8Array(bytes), { status: 200 });
    }),
  );

  const { fal } = await import("@fal-ai/client");
  (fal.storage.upload as ReturnType<typeof vi.fn>).mockImplementation(
    async (blob: Blob) => {
      uploads.push(Buffer.from(await blob.arrayBuffer()));
      return `https://fake.test/uploaded-${uploads.length}.png`;
    },
  );
  (fal.subscribe as ReturnType<typeof vi.fn>).mockImplementation(async () => {
    subscribeCalls += 1;
    return {
      requestId: `req-${subscribeCalls}`,
      data: {
        video: { url: `https://fake.test/video-${subscribeCalls}.mp4` },
      },
    };
  });

  return { subscribeCalls: () => subscribeCalls, uploads };
}

function withFalKey<T>(run: () => Promise<T>): Promise<T> {
  const previous = process.env.FAL_KEY;
  process.env.FAL_KEY = "test-only-not-a-real-key";
  return run().finally(() => {
    if (previous === undefined) delete process.env.FAL_KEY;
    else process.env.FAL_KEY = previous;
  });
}

describe("chain drift retry", () => {
  it(
    "writes each predecessor retry as an additional numbered take",
    () =>
      withFalKey(async () => {
        const root = await chainedProject("white");
        // shot-001 renders black (drift miss), retry renders white (match),
        // then shot-002 renders green.
        const stub = await stubFalNetwork(["black", "white", "green"]);
        const result = await runShoot(root, { configuration });
        const shoot = result.shoot!;
        expect(shoot.shoot.status).toBe("complete");
        expect(shoot.takes.map((take) => take.take)).toEqual([
          "shot-001.t01",
          "shot-001.t02",
          "shot-002.t01",
        ]);
        expect(
          shoot.takes[1]!.warnings.some((warning) =>
            warning.includes("chain retry"),
          ),
        ).toBe(true);
        expect(shoot.takes[1]!.status).toBe("rendered");
        // Both predecessor takes survive in the pool as reviewable evidence.
        for (const take of shoot.takes) {
          await expect(
            readFile(path.join(root, `takes/${take.take}.mp4`)),
          ).resolves.toBeDefined();
          await expect(
            readFile(path.join(root, `takes/${take.take}.last.png`)),
          ).resolves.toBeDefined();
        }
        const successor = shoot.takes[2]!;
        expect(successor.chainScore).toBeGreaterThan(0.6);
        // Real total spend includes the failed draw.
        expect(shoot.costs.actual).toBeCloseTo(0.9); // 3 renders x 6s x $0.05
        expect(stub.subscribeCalls()).toBe(3);
        // The retry reused the predecessor's cached starting image.
        expect(stub.uploads[0]!.equals(stub.uploads[1]!)).toBe(true);
      }),
    120_000,
  );

  it(
    "fails clearly once retries are exhausted, keeping every attempt",
    () =>
      withFalKey(async () => {
        const root = await chainedProject("white");
        const stub = await stubFalNetwork(["black", "black", "black"]);
        await expect(runShoot(root, { configuration })).rejects.toThrow(
          `after ${CHAIN_DRIFT_MAX_ATTEMPTS} predecessor render attempt(s)`,
        );
        const shoots = await listShoots(root);
        expect(shoots).toHaveLength(1);
        const shoot = shoots[0]!.shoot;
        expect(shoot.shoot.status).toBe("failed");
        const rendered = shoot.takes.filter(
          (take) => take.status === "rendered",
        );
        const failed = shoot.takes.filter((take) => take.status === "failed");
        expect(rendered.map((take) => take.take)).toEqual([
          "shot-001.t01",
          "shot-001.t02",
          "shot-001.t03",
        ]);
        expect(failed.map((take) => take.take)).toEqual(["shot-002.t01"]);
        expect(failed[0]!.error).toContain("chain drift check");
        expect(stub.subscribeCalls()).toBe(CHAIN_DRIFT_MAX_ATTEMPTS);
        // Failed-attempt media survives for later dailies inspection.
        for (const take of rendered)
          await expect(
            readFile(path.join(root, `takes/${take.take}.mp4`)),
          ).resolves.toBeDefined();
      }),
    120_000,
  );

  it(
    "promotes the predecessor frame on a first-try match without retries",
    () =>
      withFalKey(async () => {
        const root = await chainedProject("black");
        const stub = await stubFalNetwork(["black", "green"]);
        const result = await runShoot(root, { configuration });
        const shoot = result.shoot!;
        expect(shoot.shoot.status).toBe("complete");
        expect(shoot.takes.map((take) => take.take)).toEqual([
          "shot-001.t01",
          "shot-002.t01",
        ]);
        expect(
          shoot.takes[1]!.warnings.some((warning) =>
            warning.includes("composition promoted"),
          ),
        ).toBe(true);
        expect(stub.subscribeCalls()).toBe(2);
      }),
    120_000,
  );
});
