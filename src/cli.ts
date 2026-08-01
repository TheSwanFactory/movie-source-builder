#!/usr/bin/env node
import { readFile, stat } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { loadEnvFile } from "node:process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Command, InvalidArgumentError } from "commander";
import { readArchive, writeArchiveFromDirectory } from "./archive.js";
import { exportMovie } from "./export.js";
import { defaultBuildPaths } from "./paths.js";
import {
  loadMsb,
  loadMsbc,
  renderMovie,
  referencedAssets,
  verifyRendererAuthentication,
} from "./render.js";
import { msbManifestSchema, msboOutputSchema } from "./schema.js";

const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
const program = new Command()
  .name("msb")
  .description("Build and render Movie Source Bundles")
  .version(packageJson.version);
if (existsSync(".env")) loadEnvFile(".env");
const DEFAULT_CONFIGURATION = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../msbc/default.msbc",
);
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
      const raw = entries.get("msbo.json");
      if (!raw) throw new Error("msbo.json is required");
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

program
  .command("verify-auth")
  .description("Verify renderer authentication without rendering")
  .option(
    "-c, --config <file>",
    "Movie Source Builder Configuration (.msbc); defaults to packaged default.msbc",
  )
  .option("--json")
  .action(async (options) => {
    const result = await verifyRendererAuthentication(
      options.config ?? DEFAULT_CONFIGURATION,
    );
    console.log(
      options.json
        ? JSON.stringify(result, null, 2)
        : `${result.message}\nProvider: ${result.provider}\nModel: ${result.model}`,
    );
  });

function renderOptions(command: Command): Command {
  return command
    .option("-o, --out <file>", "explicit output path; defaults under ./build")
    .option(
      "-c, --config <file>",
      "Movie Source Builder Configuration (.msbc); defaults to packaged default.msbc",
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
  const configuration = options.config ?? DEFAULT_CONFIGURATION;
  const defaults = defaultBuildPaths(file, configuration);
  const output = options.out ?? defaults.msbo;
  const plan = await renderMovie(file, {
    output,
    configuration,
    dryRun: options.dryRun,
    maxCost: options.maxCost,
    workDir: options.workDir,
    force: options.force,
    concurrency: options.concurrency,
    keepWorkDir: options.keepWorkDir,
  });
  if (options.dryRun)
    console.log(
      JSON.stringify(
        {
          shots: plan.units,
          estimatedCost: plan.estimatedCost,
          providerRequests: 0,
          output,
        },
        null,
        2,
      ),
    );
  else console.log(`Wrote ${output}`);
});

program
  .command("export")
  .description("Export an .msbo into an MP4 without provider calls")
  .argument("<file>")
  .requiredOption("-o, --out <file>")
  .option("--force")
  .action(async (file, options) => {
    if (existsSync(options.out) && !options.force)
      throw new Error(
        `output exists: ${options.out}; pass --force to overwrite`,
      );
    await exportMovie(file, options.out);
    console.log(`Wrote ${options.out}`);
  });

renderOptions(
  program
    .command("make")
    .description("Render and export in one command")
    .argument("<file>"),
).action(async (file, options) => {
  const configuration = options.config ?? DEFAULT_CONFIGURATION;
  const defaults = defaultBuildPaths(file, configuration);
  const movie = (options.out as string | undefined) ?? defaults.movie;
  const msbo = options.out
    ? movie.replace(/\.mp4$/i, "") + ".msbo"
    : defaults.msbo;
  if (!options.dryRun && existsSync(movie) && !options.force)
    throw new Error(`output exists: ${movie}; pass --force to overwrite`);
  const plan = await renderMovie(file, {
    output: msbo,
    configuration,
    dryRun: options.dryRun,
    maxCost: options.maxCost,
    workDir: options.workDir,
    force: options.force,
    concurrency: options.concurrency,
    keepWorkDir: options.keepWorkDir,
  });
  if (!options.dryRun) await exportMovie(msbo, movie);
  console.log(
    options.dryRun
      ? JSON.stringify(
          {
            estimatedCost: plan.estimatedCost,
            providerRequests: 0,
            movie,
            msbo,
          },
          null,
          2,
        )
      : `Wrote ${movie} and ${msbo}`,
  );
});

async function loadManifestDirectory(directory: string): Promise<void> {
  const info = await stat(directory);
  if (!info.isDirectory()) throw new Error("pack input must be a directory");
  const raw = await readFile(path.join(directory, "msb.json"));
  const manifest = msbManifestSchema.parse(JSON.parse(raw.toString()));
  for (const asset of referencedAssets(manifest)) {
    const assetPath = path.join(directory, asset);
    const assetInfo = await stat(assetPath).catch(() => null);
    if (!assetInfo?.isFile())
      throw new Error(`referenced asset is missing or invalid: ${asset}`);
  }
}

program.parseAsync().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`msb: ${message}`);
  process.exitCode = message.includes("cost")
    ? 5
    : /authentication|environment variables/.test(message)
      ? 4
      : 3;
});
