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
} from "../src/chain.js";

const ffmpeg = ffmpegStatic as unknown as string;
let root: string;

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "msb-chain-"));
});

async function solidColorPng(color: string, name: string): Promise<string> {
  const file = path.join(root, name);
  await execa(ffmpeg, [
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

describe("compareFrameSimilarity", () => {
  it("scores an identical image pair near 1", async () => {
    const a = await solidColorPng("0x273043", "identical-a.png");
    const b = await solidColorPng("0x273043", "identical-b.png");
    const score = await compareFrameSimilarity(a, b, ffmpeg);
    expect(score).toBeGreaterThan(0.99);
    expect(score).toBeGreaterThanOrEqual(CHAIN_SIMILARITY_THRESHOLD);
  });

  it("scores visibly different images below the chain threshold", async () => {
    const a = await solidColorPng("black", "different-a.png");
    const b = await solidColorPng("white", "different-b.png");
    const score = await compareFrameSimilarity(a, b, ffmpeg);
    expect(score).toBeLessThan(CHAIN_SIMILARITY_THRESHOLD);
  });

  it("compares images of different dimensions without erroring", async () => {
    const a = await solidColorPng("0x273043", "sized-a.png");
    const b = path.join(root, "sized-b.png");
    await execa(ffmpeg, [
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
  });
});

describe("extractLastFrame", () => {
  it("produces a readable still from a short clip", async () => {
    const clip = await solidColorClip("0x112233", "clip.mp4");
    const frame = path.join(root, "clip-last-frame.png");
    await extractLastFrame(clip, frame, ffmpeg);
    const score = await compareFrameSimilarity(
      frame,
      await solidColorPng("0x112233", "clip-reference.png"),
      ffmpeg,
    );
    expect(score).toBeGreaterThan(0.9);
  });
});
