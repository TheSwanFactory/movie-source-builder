#!/usr/bin/env node
// Emits the reference-image request plan for a v2 project folder: one
// request per cast model sheet and per shot-list reference image, each
// embedding the canonical prompt templates verbatim (hashed for
// provenance). The request/response contract is described in
// docs/03-prompt-architecture.md.
import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  cuesInSpan,
  flattenShots,
  loadHeader,
  loadScreenplay,
  loadShotlist,
  latestShotlistId,
  validateScreenplaySemantics,
} from "../dist/project.js";
import { shotReferencePaths } from "../dist/render.js";

const hash = (value) => createHash("sha256").update(value).digest("hex");
const stripFrontmatter = (text) =>
  text.replace(/^---\n[\s\S]*?\n---\n/, "").trim();
const args = process.argv.slice(2);
const source = args.find((arg) => !arg.startsWith("--"));
const option = (name) => {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
};
if (!source) {
  throw new Error(
    "usage: node scripts/generate-storyboard-prompts.mjs <project-folder> [--out plan.json] [--require-complete]",
  );
}
if (!(await stat(source)).isDirectory())
  throw new Error(`not a project folder: ${source}`);

const root = path.dirname(fileURLToPath(import.meta.url));
const entityTemplate = stripFrontmatter(
  await readFile(
    path.join(root, "prompts/04-producer-generate-model-sheets.md"),
    "utf8",
  ),
);
const imageTemplate = stripFrontmatter(
  await readFile(
    path.join(root, "prompts/05-producer-generate-boards.md"),
    "utf8",
  ),
);

const header = await loadHeader(source);
const { screenplay } = await loadScreenplay(source);
validateScreenplaySemantics(header, screenplay);
const cast = new Map(header.cast.map((member) => [member.id, member]));

const statusOf = async (relativePath) => {
  const info = await stat(path.join(source, relativePath)).catch(() => null);
  return info?.isFile() ? "present" : "missing";
};

const requests = [];
const warnings = [];

for (const member of header.cast) {
  if (!member.modelSheet) {
    if (member.needsModelSheet)
      warnings.push(`${member.id}: cast member has no model sheet path yet`);
    continue;
  }
  const prompt = `${entityTemplate}\n\nENTITY: ${member.id}\nKIND: ${member.kind}\nDESCRIPTION: ${member.description}\n`;
  requests.push({
    id: member.id,
    role: "model-sheet",
    outputPath: member.modelSheet,
    status: await statusOf(member.modelSheet),
    prompt,
    promptHash: hash(prompt),
    identityAnchors: [],
  });
}

const shotlistId = await latestShotlistId(source);
if (shotlistId !== undefined) {
  const { shotlist } = await loadShotlist(source, shotlistId);
  const shots = flattenShots(shotlist);
  const seenReferences = new Map();
  for (const [index, shot] of shots.entries()) {
    const lines = cuesInSpan(screenplay, shot.span);
    const identityAnchors = [
      ...shot.characters
        .map((id) => cast.get(id)?.modelSheet)
        .filter((value) => value !== undefined),
      ...(shot.location && cast.get(shot.location)?.modelSheet
        ? [cast.get(shot.location).modelSheet]
        : []),
    ];
    const entityBlock = [
      ...shot.characters.map((id) => {
        const member = cast.get(id);
        return `CHARACTER ${id}: ${member?.name ?? id}. ${member?.description ?? "MISSING DESCRIPTION"}. Model sheet: ${member?.modelSheet ?? "MISSING"}`;
      }),
      ...(shot.location
        ? [
            `LOCATION ${shot.location}: ${cast.get(shot.location)?.description ?? "MISSING DESCRIPTION"}. Model sheet: ${cast.get(shot.location)?.modelSheet ?? "MISSING"}`,
          ]
        : []),
    ].join("\n");
    const shotPrompt = (role) =>
      `${imageTemplate}\n\nPROJECT: ${header.project.title}\nSHOT: ${shot.id} (${index + 1}/${shots.length})\nROLE: ${role}\nSPAN: ${shot.span[0]}s–${shot.span[1]}s on the screenplay timeline\n\nIDENTITY CONSTRAINTS\n${entityBlock || "No listed entities."}\n\nSHOT ACTION\n${shot.action}\n\nCAMERA\n${shot.camera}\n\nCONTINUITY\n${shot.continuity.map((item) => `- ${item}`).join("\n") || "- none"}\n\nCUES IN SPAN\n${
        lines
          .map(
            (line) =>
              `- ${line.start}-${line.end}s ${line.character ?? line.kind}: ${line.text}`,
          )
          .join("\n") || "- none"
      }\n`;
    const shotRequest = async (role, id, outputPath) => {
      const prior = seenReferences.get(outputPath);
      if (prior)
        warnings.push(
          `${shot.id}: reuses ${outputPath} from ${prior}; create a shot-specific visual-state reference`,
        );
      else seenReferences.set(outputPath, shot.id);
      const prompt = shotPrompt(role);
      requests.push({
        id,
        role,
        outputPath,
        status: await statusOf(outputPath),
        prompt,
        promptHash: hash(prompt),
        identityAnchors,
      });
    };
    if (shot.references.composition)
      await shotRequest("composition", shot.id, shot.references.composition);
    for (const [i, reference] of shot.references.identity.entries())
      await shotRequest(
        "identity",
        shot.references.identity.length > 1
          ? `${shot.id}-identity-${i}`
          : shot.id,
        reference,
      );
    if (shot.references.endFrame)
      await shotRequest("endFrame", shot.id, shot.references.endFrame);
    if (shotReferencePaths(shot).length === 0)
      warnings.push(`${shot.id}: no explicit shot reference`);
  }
}

const missing = requests.filter((request) => request.status === "missing");
if (args.includes("--require-complete") && missing.length > 0)
  throw new Error(
    `reference-image request plan is incomplete:\n${missing.map((request) => `${request.id} (${request.role}): ${request.outputPath}`).join("\n")}`,
  );

const report = {
  formatVersion: "2.0.0",
  kind: "reference-image-request-plan",
  directory: path.resolve(source),
  templates: {
    entity: {
      path: "scripts/prompts/04-producer-generate-model-sheets.md",
      hash: hash(entityTemplate),
    },
    image: {
      path: "scripts/prompts/05-producer-generate-boards.md",
      hash: hash(imageTemplate),
    },
  },
  warnings,
  requests,
};

const output = option("--out");
if (output) {
  await mkdir(path.dirname(path.resolve(output)), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`Wrote ${output}\n`);
} else process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
