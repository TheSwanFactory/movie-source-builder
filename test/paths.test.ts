import path from "node:path";
import { describe, expect, it } from "vitest";
import { defaultBuildPaths } from "../src/paths.js";

describe("default build paths", () => {
  it("groups a source/configuration pair under a UTC timestamp", () => {
    const paths = defaultBuildPaths(
      "/sources/My Movie.msb",
      "/engines/fal-veo-3.1-fast.msbc",
      new Date("2026-07-31T23:59:58.123Z"),
    );
    const directory = path.join(
      "build",
      "My-Movie-fal-veo-3.1-fast",
      "2026-07-31T23-59-58.123Z",
    );
    expect(paths).toEqual({
      directory,
      msbo: path.join(directory, "output.msbo"),
      movie: path.join(directory, "movie.mp4"),
    });
  });
});
