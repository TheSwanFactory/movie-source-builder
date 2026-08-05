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

// Default outputs live next to their source, named deterministically (no
// timestamp), so a repeated invocation with the same source/configuration
// resolves to the same path every time — the render/export commands' own
// "reuse a previous output at this exact path" logic is what turns that
// stability into a checkpoint, with no separate cache store required.

export function defaultRenderPaths(
  source: string,
  configuration: string,
): { msbo: string; movie: string } {
  const pair = `${artifactName(source, ".msb")}-${artifactName(configuration, ".msbc")}`;
  const directory = path.dirname(source);
  return {
    msbo: path.join(directory, `${pair}.msbo`),
    movie: path.join(directory, `${pair}.mp4`),
  };
}

export function defaultStoryboardPath(source: string): string {
  const directory = path.dirname(source);
  return path.join(
    directory,
    `${artifactName(source, ".msb")}-storyboard.msbo`,
  );
}

export function defaultExportPath(source: string): string {
  const directory = path.dirname(source);
  return path.join(directory, `${artifactName(source, ".msbo")}.mp4`);
}
