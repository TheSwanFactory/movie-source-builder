import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Several tests spawn real ffmpeg subprocesses (extractLastFrame,
    // compareFrameSimilarity). Vitest's 5000ms default is thin enough that
    // these intermittently time out under CI resource contention even
    // though they complete in well under a second locally.
    testTimeout: 20_000,
    // 6 test files spawn real ffmpeg/execa subprocesses. Vitest parallelizes
    // test files across worker processes by default; on GitHub's 2-core
    // ubuntu-latest runners, several of those files' ffmpeg calls competing
    // for 2 cores at once is enough to blow past even a 20s timeout (a
    // single 64x64 SSIM comparison observed taking >20s under contention,
    // vs. well under a second locally). Running files sequentially trades a
    // few seconds of local wall-clock time for CI reliability.
    fileParallelism: false,
  },
});
