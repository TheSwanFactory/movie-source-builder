import { execa } from "execa";

/**
 * Similarity heuristic only, not semantic drift detection. See
 * docs/CONTRIBUTING.md#shot-chaining-11.
 */
export const CHAIN_SIMILARITY_THRESHOLD = 0.6;

/**
 * Total render attempts (1 original + retries) for a predecessor whose
 * successor fails the drift check, before giving up. See
 * docs/CONTRIBUTING.md#shot-chaining-11.
 */
export const CHAIN_DRIFT_MAX_ATTEMPTS = 3;

/**
 * Both images are scaled to this fixed size before SSIM, making dimension
 * mismatches a defined, deterministic comparison instead of a filter-graph
 * concern.
 */
export const CHAIN_COMPARE_SIZE = "256x256";

/** ffmpeg must exit within this window; the promise always settles. */
const FFMPEG_TIMEOUT_MS = 120_000;

export async function extractLastFrame(
  mediaPath: string,
  outputPngPath: string,
  ffmpeg: string,
): Promise<void> {
  await execa(
    ffmpeg,
    [
      "-nostdin",
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
    ],
    { timeout: FFMPEG_TIMEOUT_MS },
  );
}

/**
 * Parses the summary line of ffmpeg's ssim filter. Format varies by build:
 * typically `SSIM Y:... All:0.874321 (8.9)`, but identical frames can
 * report `All:1.000000 (inf)` or plain `All:inf`, and degenerate input can
 * yield `All:nan`. Identical (`inf`) means similarity 1; `nan` and a
 * missing score are explicit errors — never a silent hang or guess.
 */
export function parseSsimScore(output: string): number {
  const match = /All:\s*(inf|nan|-?\d+(?:\.\d+)?)/i.exec(output);
  if (!match) {
    const tail = output.trim().split("\n").slice(-3).join(" | ");
    throw new Error(`unable to parse ffmpeg ssim output: ${tail || "(empty)"}`);
  }
  const value = match[1]!.toLowerCase();
  if (value === "inf") return 1;
  if (value === "nan")
    throw new Error("ffmpeg ssim produced nan (degenerate comparison input)");
  return Number(value);
}

/**
 * Structural similarity (SSIM) between two images. Both inputs are read as
 * single frames and scaled to CHAIN_COMPARE_SIZE first, since the extracted
 * frame and the authored composition are not guaranteed to share
 * dimensions. Returns a score in [0, 1]; higher is more similar. The
 * underlying ffmpeg call always settles: it is killed after a hard timeout
 * rather than ever hanging the shoot.
 */
export async function compareFrameSimilarity(
  pathA: string,
  pathB: string,
  ffmpeg: string,
): Promise<number> {
  const scale = `scale=${CHAIN_COMPARE_SIZE.replace("x", ":")}:flags=bicubic,format=gbrp,setsar=1`;
  const { stderr, stdout } = await execa(
    ffmpeg,
    [
      "-nostdin",
      "-y",
      "-i",
      pathA,
      "-i",
      pathB,
      "-filter_complex",
      `[0:v]${scale}[a];[1:v]${scale}[b];[a][b]ssim`,
      "-f",
      "null",
      "-",
    ],
    { timeout: FFMPEG_TIMEOUT_MS },
  );
  return parseSsimScore(`${stderr}\n${stdout}`);
}
