#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { loadEnvFile } from "node:process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Command, InvalidArgumentError } from "commander";
import { createAnimatic } from "./animatic.js";
import { createCut } from "./cut.js";
import {
  appendObservation,
  describeSubject,
  listObservations,
  listUnreviewed,
} from "./dailies.js";
import { collectGarbage } from "./gc.js";
import {
  aggregateFindings,
  formatFindings,
  formatProjectReport,
  formatShotHistory,
  inspectProject,
  renderScreenplayText,
  shotHistory,
} from "./inspect.js";
import { packProject } from "./pack.js";
import {
  computeLatest,
  ingestProject,
  listShoots,
  loadScreenplay,
} from "./project.js";
import { loadMsbc, verifyRendererAuthentication } from "./render.js";
import { createProject } from "./scaffold.js";
import { runShoot } from "./shoot.js";

const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
const program = new Command()
  .name("msb")
  .description("Build and shoot Movie Source Builder project folders")
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
  .command("create")
  .description("Scaffold a project folder around a verbatim draft screenplay")
  .argument("<folder>")
  .requiredOption("--draft <file>", "the author's screenplay, any name/format")
  .action(async (folder, options) => {
    const result = await createProject(folder, options.draft);
    console.log(
      [
        `Created ${result.root}`,
        `Draft copied verbatim to ${result.draft}`,
        "Next: a Producer canonicalizes the draft into screenplay.json and",
        "fills msb.json's cast, then `msb ingest` validates the result.",
      ].join("\n"),
    );
  });

program
  .command("ingest")
  .description(
    "Validate the canonical screenplay, cast, and references (schema + semantics)",
  )
  .argument("<folder>")
  .action(async (folder) => {
    const project = await ingestProject(folder);
    console.log(
      `Ingested ${project.header.project.title}: ${project.screenplay.scenes.length} scene(s), ${project.screenplay.scenes.reduce((sum, scene) => sum + scene.cues.length, 0)} cue(s), ${project.screenplay.screenplay.duration}s, cast of ${project.header.cast.length}`,
    );
  });

program
  .command("animatic")
  .description(
    "Assemble the zero-cost review movie from screenplay cues and boards",
  )
  .argument("<folder>")
  .option(
    "-o, --out <file>",
    "explicit output path; defaults to cuts/animatic.mp4",
  )
  .action(async (folder, options) => {
    const output = await createAnimatic(folder, { out: options.out });
    console.log(`Wrote ${output}`);
  });

program
  .command("shoot")
  .description(
    "Run one shoot: render takes into the pool and append a shoot to the ledger",
  )
  .argument("<folder>")
  .option(
    "-c, --config <file>",
    "Movie Source Builder Configuration (.msbc); defaults to packaged default.msbc",
  )
  .option(
    "--dry-run",
    "plan and price without writing or contacting a provider",
  )
  .option("--max-cost <usd>", "maximum new generation cost", number)
  .option("--concurrency <number>", "parallel requests", number, 2)
  .option("--fresh", "ignore reusable takes and render every shot")
  .option(
    "--chain-threshold <number>",
    "override the chain drift SSIM threshold for this shoot (default 0.6); recorded in the shoot's warnings",
    number,
  )
  .action(async (folder, options) => {
    const result = await runShoot(folder, {
      configuration: options.config ?? DEFAULT_CONFIGURATION,
      dryRun: options.dryRun,
      maxCost: options.maxCost,
      concurrency: options.concurrency,
      fresh: options.fresh,
      chainThreshold: options.chainThreshold,
    });
    if (options.dryRun) {
      console.log(
        JSON.stringify(
          {
            shotlist: result.plan.shotlistId,
            engine: result.plan.configName,
            shots: result.plan.units.map((unit) => ({
              id: unit.shot.id,
              span: unit.shot.span,
              duration: unit.duration,
              reused: unit.reuse !== undefined,
              estimatedCost: unit.estimatedCost,
              ...(unit.chainFrom !== undefined
                ? { chainFrom: unit.chainFrom }
                : {}),
            })),
            findings: result.plan.findings,
            planValid: result.plan.planValid,
            estimatedCost: result.plan.estimatedCost,
            providerRequests: 0,
          },
          null,
          2,
        ),
      );
      if (!result.plan.planValid) process.exitCode = 3;
      return;
    }
    console.log(
      `Wrote ${result.file}: ${result.shoot!.takes.length} new take(s), ${result.shoot!.reused.length} reused, $${result.shoot!.costs.actual.toFixed(2)}`,
    );
  });

const parseSpan = (value: string): [number, number] => {
  const match = /^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/.exec(value);
  if (!match)
    throw new InvalidArgumentError(
      "span must be <start>-<end> in seconds, e.g. 22-32",
    );
  return [Number(match[1]), Number(match[2])];
};

program
  .command("dailies")
  .description(
    "List rendered takes no review session has judged yet, and past observations",
  )
  .argument("<folder>")
  .option("--json")
  .action(async (folder, options) => {
    const unreviewed = await listUnreviewed(folder);
    const observations = await listObservations(folder);
    if (options.json) {
      console.log(JSON.stringify({ unreviewed, observations }, null, 2));
      return;
    }
    const lines = [
      unreviewed.length === 0
        ? "No unreviewed takes."
        : unreviewed
            .map((take) => `${take.take}  (shoot ${take.shootId})`)
            .join("\n"),
    ];
    if (observations.length > 0)
      lines.push(
        "Observations:",
        ...observations.map(
          (observation) =>
            `  [${observation.session} by ${observation.by}] ${describeSubject(observation.subject)}${
              observation.verdict ? `: ${observation.verdict}` : ""
            }${observation.text ? ` — ${observation.text}` : ""}${
              observation.notes ? `\n    notes: ${observation.notes}` : ""
            }${
              observation.attachments
                ? `\n    attachments: ${observation.attachments.join(", ")}`
                : ""
            }`,
        ),
      );
    console.log(lines.join("\n"));
  });

program
  .command("circle")
  .description(
    "Append a review verdict on a take or the animatic: circle a keeper, or --reject it",
  )
  .argument("<folder>")
  .option("--take <id>", "take id, e.g. shot-001.t02")
  .option("--animatic", "judge the animatic instead of a take")
  .option("--reject", "record a rejected verdict instead of circling")
  .option("--notes <file>", "file whose contents become takes/<take>.notes.md")
  .option("--text <text>", "the reasoning, inline in the dailies entry")
  .option(
    "--attach <file...>",
    "evidence (screenshots, frames) copied into dailies/<session>/",
  )
  .option("--by <name>", "reviewer recorded in the dailies entry")
  .action(async (folder, options) => {
    const result = await appendObservation(folder, {
      take: options.take,
      animatic: options.animatic,
      verdict: options.reject ? "rejected" : "circled",
      notesFile: options.notes,
      text: options.text,
      attach: options.attach,
      by: options.by,
    });
    console.log(
      `Wrote ${result.file}: ${options.take ?? "animatic"} ${options.reject ? "rejected" : "circled"}${result.notes ? ` (notes: ${result.notes})` : ""}${
        result.attachments
          ? ` (attachments: ${result.attachments.join(", ")})`
          : ""
      }`,
    );
  });

program
  .command("note")
  .description(
    "Append a verdict-less review observation about a take, cut, the animatic, or the session",
  )
  .argument("<folder>")
  .option("--take <id>", "take the observation is about, e.g. shot-001.t02")
  .option("--cut <id>", "cut the observation is about, e.g. 0002")
  .option("--animatic", "the observation is about the animatic")
  .option(
    "--span <a-b>",
    "seconds on the screenplay timeline (cut/animatic), e.g. 22-32",
    parseSpan,
  )
  .option("--text <text>", "the observation itself, inline")
  .option("--notes <file>", "file recorded as the observation's notes document")
  .option(
    "--attach <file...>",
    "evidence (screenshots, frames) copied into dailies/<session>/",
  )
  .option("--by <name>", "reviewer recorded in the dailies entry")
  .action(async (folder, options) => {
    const result = await appendObservation(folder, {
      take: options.take,
      cut: options.cut,
      animatic: options.animatic,
      span: options.span,
      text: options.text,
      notesFile: options.notes,
      attach: options.attach,
      by: options.by,
    });
    const subject = result.dailies.observations[0]!.subject;
    console.log(
      `Wrote ${result.file}: observation on ${describeSubject(subject)}${
        result.notes ? ` (notes: ${result.notes})` : ""
      }${
        result.attachments
          ? ` (attachments: ${result.attachments.join(", ")})`
          : ""
      }`,
    );
  });

program
  .command("cut")
  .description(
    "Assemble the deliverable cut from circled (or newest unrejected) takes",
  )
  .argument("<folder>")
  .option(
    "--shoot <id>",
    "shoot to realize; defaults to the latest complete shoot",
  )
  .option(
    "-o, --out <file>",
    "explicit output path; defaults to cuts/<shoot>.mp4",
  )
  .action(async (folder, options) => {
    const result = await createCut(folder, {
      shootId: options.shoot,
      out: options.out,
    });
    console.log(
      `Wrote ${result.file} (${result.takes.map((take) => take.take).join(", ")})`,
    );
  });

program
  .command("latest")
  .description(
    "Print the latest shot list, latest complete shoot, and current take per shot",
  )
  .argument("<folder>")
  .option("--json")
  .action(async (folder, options) => {
    const latest = await computeLatest(folder);
    if (options.json) {
      console.log(JSON.stringify(latest, null, 2));
      return;
    }
    console.log(
      [
        `Latest shot list: ${latest.shotlist ?? "none"}`,
        `Latest complete shoot: ${latest.shoot ?? "none"}`,
        ...latest.current.map(
          (entry) =>
            `  ${entry.shot}: ${entry.take ?? "no eligible take"}${entry.take ? ` (${entry.standing})` : ""}`,
        ),
      ].join("\n"),
    );
  });

program
  .command("gc")
  .description(
    "Delete reclaimable take media (.mp4 only) — never ledger JSON, notes, or last frames",
  )
  .argument("<folder>")
  .option("--dry-run", "report what would be deleted without deleting")
  .action(async (folder, options) => {
    const report = await collectGarbage(folder, { dryRun: options.dryRun });
    const verb = options.dryRun ? "Would reclaim" : "Reclaimed";
    console.log(
      [
        `${verb} ${report.reclaimed.length} take video(s):`,
        ...report.reclaimed.map((media) => `  ${media}`),
        `Kept ${report.kept.length}:`,
        ...report.kept.map((item) => `  ${item.media} — ${item.reason}`),
      ].join("\n"),
    );
  });

program
  .command("inspect")
  .description("Inspect a project folder or an .msbc engine configuration")
  .argument("<target>")
  .option("--json")
  .option("--findings", "aggregate structured findings across all shoots")
  .option("--shot <id>", "one shot's full take history across engines")
  .option("--screenplay", "render the canonical screenplay as readable text")
  .action(async (target, options) => {
    if (target.endsWith(".msbc")) {
      const { configuration, configurationHash } = await loadMsbc(target);
      console.log(
        options.json
          ? JSON.stringify({ ...configuration, configurationHash }, null, 2)
          : `Movie Source Builder Configuration\nProvider: ${configuration.renderer.provider}\nModel: ${configuration.renderer.model}\nRequired environment: ${configuration.renderer.requiredEnvironmentVariables.join(", ") || "none"}\nOutput: ${configuration.output.width}x${configuration.output.height} @ ${configuration.output.frameRate}fps\nConfiguration: ${configurationHash}`,
      );
      return;
    }
    if (options.screenplay) {
      const { screenplay } = await loadScreenplay(target);
      console.log(renderScreenplayText(screenplay));
      return;
    }
    if (options.findings) {
      const findings = aggregateFindings(await listShoots(target));
      console.log(
        options.json
          ? JSON.stringify(findings, null, 2)
          : formatFindings(findings),
      );
      return;
    }
    if (options.shot) {
      const history = await shotHistory(target, options.shot);
      console.log(
        options.json
          ? JSON.stringify(history, null, 2)
          : formatShotHistory(options.shot, history),
      );
      return;
    }
    const report = await inspectProject(target);
    console.log(
      options.json
        ? JSON.stringify(report, null, 2)
        : formatProjectReport(report),
    );
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

program
  .command("pack")
  .description("Pack a project folder into a transport .msb archive")
  .argument("<folder>")
  .option("-o, --out <file>", "output archive; defaults to <folder>.msb")
  .option(
    "--source-only",
    "exclude the ledgers and outputs (takes/, shoots/, dailies/, cuts/)",
  )
  .action(async (folder, options) => {
    const output =
      options.out ?? `${path.resolve(folder).replace(/[/\\]+$/, "")}.msb`;
    await packProject(folder, output, { sourceOnly: options.sourceOnly });
    console.log(`Wrote ${output}`);
  });

program.parseAsync().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`msb: ${message}`);
  process.exitCode = message.includes("cost")
    ? 5
    : /authentication|environment variables/.test(message)
      ? 4
      : 3;
});
