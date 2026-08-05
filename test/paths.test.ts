import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  defaultExportPath,
  defaultRenderPaths,
  defaultStoryboardPath,
} from "../src/paths.js";

describe("default render paths", () => {
  it("names a source/configuration pair adjacent to the source, with no timestamp", () => {
    const paths = defaultRenderPaths(
      "/sources/My Movie.msb",
      "/engines/fal-veo-3.1-fast.msbc",
    );
    expect(paths).toEqual({
      msbo: path.join("/sources", "My-Movie-fal-veo-3.1-fast.msbo"),
      movie: path.join("/sources", "My-Movie-fal-veo-3.1-fast.mp4"),
    });
  });

  it("resolves to the same path every call, so a rerun can find its predecessor", () => {
    const a = defaultRenderPaths("/sources/movie.msb", "/engines/mock.msbc");
    const b = defaultRenderPaths("/sources/movie.msb", "/engines/mock.msbc");
    expect(a).toEqual(b);
  });
});

describe("default storyboard path", () => {
  it("names a storyboard adjacent to the source", () => {
    expect(defaultStoryboardPath("/sources/My Movie.msb")).toBe(
      path.join("/sources", "My-Movie-storyboard.msbo"),
    );
  });
});

describe("default export path", () => {
  it("names an MP4 adjacent to the source .msbo", () => {
    expect(defaultExportPath("/sources/My Movie.msbo")).toBe(
      path.join("/sources", "My-Movie.mp4"),
    );
  });
});
