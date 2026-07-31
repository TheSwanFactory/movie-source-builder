import path from "node:path";

const artifactName = (file: string, extension: string): string => {
  const basename = path.basename(file);
  const withoutExtension = basename.toLowerCase().endsWith(extension)
    ? basename.slice(0, -extension.length)
    : basename;
  return (
    withoutExtension
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "artifact"
  );
};

export function defaultBuildPaths(
  source: string,
  configuration: string,
  now = new Date(),
): { directory: string; msbo: string; movie: string } {
  const pair = `${artifactName(source, ".msb")}-${artifactName(configuration, ".msbc")}`;
  const timestamp = now.toISOString().replaceAll(":", "-");
  const directory = path.join("build", pair, timestamp);
  return {
    directory,
    msbo: path.join(directory, "output.msbo"),
    movie: path.join(directory, "movie.mp4"),
  };
}
