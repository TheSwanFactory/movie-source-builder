import { execa } from "execa";

/**
 * Similarity heuristic only, not semantic drift detection. See
 * docs/CONTRIBUTING.md#proposed-previz--shot-chaining-11.
 */
export const CHAIN_SIMILARITY_THRESHOLD = 0.6;

export async function extractLastFrame(
  mediaPath: string,
  outputPngPath: string,
  ffmpeg: string,
): Promise<void> {
  await execa(ffmpeg, [
    "-y",
    "-sseof",
    "-1",
    "-i",
    mediaPath,
    "-update",
    "1",
    "-frames:v",
    "1",
    outputPngPath,
  ]);
}

/**
 * Structural similarity (SSIM) between two images, scaled to a common size
 * first since the extracted frame and the authored composition are not
 * guaranteed to share dimensions. Returns a score in [0, 1]; higher is more
 * similar.
 */
export async function compareFrameSimilarity(
  pathA: string,
  pathB: string,
  ffmpeg: string,
): Promise<number> {
  const { stderr } = await execa(ffmpeg, [
    "-y",
    "-loop",
    "1",
    "-t",
    "1",
    "-i",
    pathA,
    "-loop",
    "1",
    "-t",
    "1",
    "-i",
    pathB,
    "-lavfi",
    "[1:v][0:v]scale2ref[b][a];[a][b]ssim",
    "-f",
    "null",
    "-",
  ]);
  const match = /All:([\d.]+)/.exec(stderr);
  if (!match) throw new Error("unable to parse ffmpeg ssim output");
  return Number(match[1]);
}
