import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Several tests spawn real ffmpeg subprocesses (extractLastFrame,
    // compareFrameSimilarity). Vitest's 5000ms default is thin enough that
    // these intermittently time out under CI resource contention even
    // though they complete in well under a second locally.
    testTimeout: 20_000,
  },
});
