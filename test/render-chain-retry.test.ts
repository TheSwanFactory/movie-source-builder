import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execa } from "execa";
import ffmpegStatic from "ffmpeg-static";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  readArchive,
  writeArchive,
  writeArchiveFromDirectory,
} from "../src/archive.js";
import { CHAIN_DRIFT_MAX_ATTEMPTS } from "../src/chain.js";
import { renderMovie } from "../src/render.js";
import { msbManifestSchema, type MsbManifest } from "../src/schema.js";

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

let root: string;
let sourceBundle: string;

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "msb-chain-retry-"));
  const bundleRoot = await mkdtemp(path.join(tmpdir(), "msb-chain-retry-src-"));
  sourceBundle = path.join(bundleRoot, "sample.msb");
  await writeArchiveFromDirectory(
    path.resolve("examples/skit-poc"),
    sourceBundle,
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// 16:9, matching the fal-hailuo-02-standard format, so the render's
// scale+pad step never introduces black bars that would wash out the
// solid-color signal the drift check relies on.
async function solidColorPng(color: string, name: string): Promise<Buffer> {
  const file = path.join(root, name);
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
  const file = path.join(root, name);
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

async function chainBundle(shotCount: number): Promise<string> {
  const bundleRoot = await mkdtemp(path.join(tmpdir(), "msb-chain-retry-b-"));
  const entries = await readArchive(sourceBundle);
  const manifest = msbManifestSchema.parse(
    JSON.parse(entries.get("msb.json")!.toString()),
  );
  manifest.shots = manifest.shots.slice(0, shotCount) as MsbManifest["shots"];
  entries.set("msb.json", Buffer.from(JSON.stringify(manifest)));
  const chained = path.join(bundleRoot, "chained.msb");
  await writeArchive(entries, chained);
  return chained;
}

async function overrideComposition(
  bundlePath: string,
  shotIndex: number,
  color: string,
): Promise<string> {
  const entries = await readArchive(bundlePath);
  const manifest = msbManifestSchema.parse(
    JSON.parse(entries.get("msb.json")!.toString()),
  );
  const compositionPath = manifest.shots[shotIndex]!.references.composition!;
  entries.set(
    compositionPath,
    await solidColorPng(color, `composition-${shotIndex}-${color}.png`),
  );
  await writeArchive(entries, bundlePath);
  return bundlePath;
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
      await solidColorClip(videoColors[i]!, `video-${i + 1}.mp4`),
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

describe("chain drift retry", () => {
  it("succeeds after retrying the predecessor", async () => {
    const previous = process.env.FAL_KEY;
    process.env.FAL_KEY = "test-only-not-a-real-key";
    try {
      let chained = await chainBundle(2);
      chained = await overrideComposition(chained, 1, "white");

      const stub = await stubFalNetwork(["black", "white", "green"]);

      const output = `${chained}.msbo`;
      await renderMovie(chained, { output, configuration });
      const entries = await readArchive(output);
      const result = JSON.parse(entries.get("msbo.json")!.toString());

      expect(result.status).toBe("complete");
      expect(result.shots[0].attempts).toBe(2);
      expect(result.shots[0].actualCost).toBeCloseTo(
        result.shots[0].estimatedCost * 2,
      );
      expect(result.shots[1].status).toBe("complete");
      expect(
        result.shots[1].warnings.some((warning: string) =>
          warning.includes("after 2 predecessor attempts"),
        ),
      ).toBe(true);
      expect(stub.subscribeCalls()).toBe(3);
    } finally {
      if (previous === undefined) delete process.env.FAL_KEY;
      else process.env.FAL_KEY = previous;
    }
  }, 60_000);

  it("fails clearly once retries are exhausted", async () => {
    const previous = process.env.FAL_KEY;
    process.env.FAL_KEY = "test-only-not-a-real-key";
    try {
      let chained = await chainBundle(2);
      chained = await overrideComposition(chained, 1, "white");

      const stub = await stubFalNetwork(["black", "black", "black"]);

      const output = `${chained}.msbo`;
      await expect(
        renderMovie(chained, { output, configuration }),
      ).rejects.toThrow(
        `after ${CHAIN_DRIFT_MAX_ATTEMPTS} predecessor render attempt(s)`,
      );
      const result = JSON.parse(
        await readFile(path.join(`${output}.work`, "msbo.json"), "utf8"),
      );

      expect(result.shots[0].attempts).toBe(CHAIN_DRIFT_MAX_ATTEMPTS);
      expect(result.status).toBe("failed");
      expect(stub.subscribeCalls()).toBe(CHAIN_DRIFT_MAX_ATTEMPTS);
    } finally {
      if (previous === undefined) delete process.env.FAL_KEY;
      else process.env.FAL_KEY = previous;
    }
  }, 60_000);

  it("retrying a middle link reuses its cached starting image, never re-checking its own predecessor", async () => {
    const previous = process.env.FAL_KEY;
    process.env.FAL_KEY = "test-only-not-a-real-key";
    try {
      let chained = await chainBundle(3);
      // shot[1] (B)'s composition must match shot[0] (A)'s rendered color
      // so B's own link promotes cleanly on the first try.
      chained = await overrideComposition(chained, 1, "blue");
      // shot[2] (C)'s composition mismatches B's first render (black),
      // forcing a retry of B, then matches B's retry render (white).
      chained = await overrideComposition(chained, 2, "white");

      const stub = await stubFalNetwork(["blue", "black", "white", "green"]);

      const output = `${chained}.msbo`;
      await renderMovie(chained, { output, configuration });
      const entries = await readArchive(output);
      const result = JSON.parse(entries.get("msbo.json")!.toString());

      expect(result.status).toBe("complete");
      expect(result.shots[0].attempts).toBe(1);
      expect(result.shots[0].actualCost).toBeCloseTo(
        result.shots[0].estimatedCost,
      );
      expect(result.shots[1].attempts).toBe(2);
      expect(result.shots[2].status).toBe("complete");
      expect(stub.subscribeCalls()).toBe(4);
      // B's original composition upload (index 1) and its retry's
      // composition upload (index 2) must be byte-identical — the retry
      // reused the cached, already-resolved starting image rather than
      // re-deriving anything from A.
      expect(stub.uploads[1]!.equals(stub.uploads[2]!)).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.FAL_KEY;
      else process.env.FAL_KEY = previous;
    }
  }, 60_000);
});

describe("chain concurrency clamp", () => {
  it("forces concurrency to 1 whenever any shot chains from another", async () => {
    const chained = await chainBundle(3);
    const output = `${chained}.msbo`;
    await renderMovie(chained, {
      output,
      configuration: path.resolve("msbc/mock.msbc"),
      concurrency: 4,
    });
    const entries = await readArchive(output);
    const result = JSON.parse(entries.get("msbo.json")!.toString());
    expect(result.status).toBe("complete");
    expect(
      result.warnings.some((warning: string) =>
        warning.includes("concurrency clamped to 1"),
      ),
    ).toBe(true);
  }, 60_000);
});
