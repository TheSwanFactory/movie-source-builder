#!/usr/bin/env node
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { Command, InvalidArgumentError } from "commander";
import { readArchive, writeArchiveFromDirectory } from "./archive.js";
import { exportMovie } from "./export.js";
import { loadMsb, loadMsbc, renderMock } from "./render.js";
import { msboOutputSchema } from "./schema.js";

const program = new Command()
  .name("msb")
  .description("Build and render Movie Source Bundles")
  .version("0.2.0");
const number = (value: string) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0)
    throw new InvalidArgumentError("must be a nonnegative number");
  return parsed;
};

program
  .command("pack")
  .description("Pack a source directory into an .msb")
  .argument("<directory>")
  .requiredOption("-o, --out <file>")
  .action(async (directory, options) => {
    await loadManifestDirectory(directory);
    await writeArchiveFromDirectory(directory, options.out);
    console.log(`Wrote ${options.out}`);
  });

program
  .command("validate")
  .description("Validate a Movie Source Bundle")
  .argument("<file>")
  .action(async (file) => {
    const loaded = await loadMsb(file);
    console.log(
      `Valid MSB: ${loaded.manifest.project.title} (${loaded.manifest.shots.length} shots)`,
    );
  });

program
  .command("inspect")
  .description("Inspect an .msb, .msbc, or .msbo")
  .argument("<file>")
  .option("--json")
  .action(async (file, options) => {
    if (file.endsWith(".msbo")) {
      const entries = await readArchive(file);
      const raw = entries.get("output.json");
      if (!raw) throw new Error("output.json is required");
      const output = msboOutputSchema.parse(JSON.parse(raw.toString()));
      console.log(
        options.json
          ? JSON.stringify(output, null, 2)
          : `${output.source.title}\nStatus: ${output.status}\nShots: ${output.shots.filter((s) => s.status === "complete").length}/${output.shots.length}\nCost: $${output.actualCost.toFixed(2)}`,
      );
    } else if (file.endsWith(".msbc")) {
      const { configuration, configurationHash } = await loadMsbc(file);
      console.log(
        options.json
          ? JSON.stringify({ ...configuration, configurationHash }, null, 2)
          : `Movie Source Builder Configuration\nProvider: ${configuration.renderer.provider}\nModel: ${configuration.renderer.model}\nRequired environment: ${configuration.renderer.requiredEnvironmentVariables.join(", ") || "none"}\nOutput: ${configuration.output.width}x${configuration.output.height} @ ${configuration.output.frameRate}fps\nConfiguration: ${configurationHash}`,
      );
    } else {
      const { manifest, sourceHash } = await loadMsb(file);
      console.log(
        options.json
          ? JSON.stringify({ ...manifest, sourceHash }, null, 2)
          : `${manifest.project.title}\nShots: ${manifest.shots.length}\nDuration: ${manifest.shots.reduce((sum, s) => sum + s.duration, 0)}s\nSource: ${sourceHash}`,
      );
    }
  });

function renderOptions(command: Command): Command {
  return command
    .requiredOption("-o, --out <file>")
    .requiredOption(
      "-c, --config <file>",
      "Movie Source Builder Configuration (.msbc)",
    )
    .option("--dry-run")
    .option("--work-dir <path>")
    .option("--concurrency <number>", "parallel requests", number, 2)
    .option("--max-cost <usd>", "maximum new generation cost", number)
    .option("--force")
    .option("--keep-work-dir");
}

renderOptions(
  program
    .command("render")
    .description("Render an .msb with an .msbc into an .msbo")
    .argument("<file>"),
).action(async (file, options) => {
  const plan = await renderMock(file, {
    output: options.out,
    configuration: options.config,
    dryRun: options.dryRun,
    maxCost: options.maxCost,
    workDir: options.workDir,
  });
  if (options.dryRun)
    console.log(
      JSON.stringify(
        {
          shots: plan.units,
          estimatedCost: plan.estimatedCost,
          providerRequests: 0,
        },
        null,
        2,
      ),
    );
  else console.log(`Wrote ${options.out}`);
});

program
  .command("export")
  .description("Export an .msbo into an MP4 without provider calls")
  .argument("<file>")
  .requiredOption("-o, --out <file>")
  .option("--force")
  .action(async (file, options) => {
    await exportMovie(file, options.out);
    console.log(`Wrote ${options.out}`);
  });

renderOptions(
  program
    .command("make")
    .description("Render and export in one command")
    .argument("<file>"),
).action(async (file, options) => {
  const movie = options.out as string;
  const msbo = movie.replace(/\.mp4$/i, "") + ".msbo";
  await renderMock(file, {
    output: msbo,
    configuration: options.config,
    dryRun: options.dryRun,
    maxCost: options.maxCost,
    workDir: options.workDir,
  });
  if (!options.dryRun) await exportMovie(msbo, movie);
  console.log(
    options.dryRun
      ? "Dry run complete; provider requests: 0"
      : `Wrote ${movie} and ${msbo}`,
  );
});

async function loadManifestDirectory(directory: string): Promise<void> {
  const info = await stat(directory);
  if (!info.isDirectory()) throw new Error("pack input must be a directory");
  const raw = await readFile(path.join(directory, "manifest.json"));
  const { msbManifestSchema } = await import("./schema.js");
  msbManifestSchema.parse(JSON.parse(raw.toString()));
}

program.parseAsync().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`msb: ${message}`);
  process.exitCode = message.includes("cost") ? 5 : 3;
});
