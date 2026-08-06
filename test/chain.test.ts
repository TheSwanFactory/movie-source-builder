import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execa } from "execa";
import ffmpegStatic from "ffmpeg-static";
import { beforeAll, describe, expect, it } from "vitest";
import {
  CHAIN_SIMILARITY_THRESHOLD,
  compareFrameSimilarity,
  extractLastFrame,
  parseSsimScore,
} from "../src/chain.js";

const ffmpeg = ffmpegStatic as unknown as string;
const INTEGRATION_TIMEOUT = 60_000;
let root: string;

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "msb-chain-"));
});

async function solidColorPng(color: string, name: string): Promise<string> {
  const file = path.join(root, name);
  await execa(ffmpeg, [
    "-nostdin",
    "-y",
    "-f",
    "lavfi",
    "-i",
    `color=c=${color}:s=64x64`,
    "-frames:v",
    "1",
    file,
  ]);
  return file;
}

async function solidColorClip(color: string, name: string): Promise<string> {
  const file = path.join(root, name);
  await execa(ffmpeg, [
    "-nostdin",
    "-y",
    "-f",
    "lavfi",
    "-i",
    `color=c=${color}:s=64x64:r=6:d=1`,
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    file,
  ]);
  return file;
}

// The parse layer is tested against captured output shapes from different
// ffmpeg builds, so the suite does not depend on the host binary's flavor.
describe("parseSsimScore", () => {
  it("parses a plain fractional score", () => {
    expect(
      parseSsimScore(
        "[Parsed_ssim_2 @ 0x1] SSIM Y:0.532012 (3.3) U:0.9 (10.0) V:0.9 (10.0) All:0.532012 (3.3)",
      ),
    ).toBeCloseTo(0.532012);
  });

  it("treats an identical-frame report as similarity 1", () => {
    expect(
      parseSsimScore(
        "[Parsed_ssim_2 @ 0x1] SSIM Y:1.000000 (inf) U:1.000000 (inf) V:1.000000 (inf) All:1.000000 (inf)",
      ),
    ).toBe(1);
    expect(parseSsimScore("SSIM All:inf")).toBe(1);
  });

  it("rejects nan and missing scores explicitly", () => {
    expect(() => parseSsimScore("SSIM All:nan (nan)")).toThrow("produced nan");
    expect(() =>
      parseSsimScore("Conversion failed!\nError while filtering"),
    ).toThrow("unable to parse ffmpeg ssim output");
    expect(() => parseSsimScore("")).toThrow(
      "unable to parse ffmpeg ssim output",
    );
  });
});

describe("compareFrameSimilarity (real ffmpeg)", () => {
  it(
    "scores an identical image pair as 1",
    async () => {
      const a = await solidColorPng("0x273043", "identical-a.png");
      const b = await solidColorPng("0x273043", "identical-b.png");
      const score = await compareFrameSimilarity(a, b, ffmpeg);
      expect(score).toBeGreaterThan(0.99);
      expect(score).toBeLessThanOrEqual(1);
      expect(score).toBeGreaterThanOrEqual(CHAIN_SIMILARITY_THRESHOLD);
    },
    INTEGRATION_TIMEOUT,
  );

  it(
    "scores visibly different images below the chain threshold",
    async () => {
      const a = await solidColorPng("black", "different-a.png");
      const b = await solidColorPng("white", "different-b.png");
      const score = await compareFrameSimilarity(a, b, ffmpeg);
      expect(score).toBeLessThan(CHAIN_SIMILARITY_THRESHOLD);
    },
    INTEGRATION_TIMEOUT,
  );

  it(
    "compares images of different dimensions deterministically",
    async () => {
      const a = await solidColorPng("0x273043", "sized-a.png");
      const b = path.join(root, "sized-b.png");
      await execa(ffmpeg, [
        "-nostdin",
        "-y",
        "-f",
        "lavfi",
        "-i",
        "color=c=0x273043:s=128x96",
        "-frames:v",
        "1",
        b,
      ]);
      const score = await compareFrameSimilarity(a, b, ffmpeg);
      expect(score).toBeGreaterThan(0.99);
    },
    INTEGRATION_TIMEOUT,
  );
});

describe("extractLastFrame", () => {
  it(
    "produces a readable still from a short clip",
    async () => {
      const clip = await solidColorClip("0x112233", "clip.mp4");
      const frame = path.join(root, "clip-last-frame.png");
      await extractLastFrame(clip, frame, ffmpeg);
      const score = await compareFrameSimilarity(
        frame,
        await solidColorPng("0x112233", "clip-reference.png"),
        ffmpeg,
      );
      expect(score).toBeGreaterThan(0.9);
    },
    INTEGRATION_TIMEOUT,
  );
});
