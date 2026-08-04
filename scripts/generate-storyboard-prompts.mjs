#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  loadMsb,
  shotReferencePaths,
  validateManifestSemantics,
} from "../dist/render.js";
import { msbManifestSchema } from "../dist/schema.js";

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
    "usage: node scripts/generate-storyboard-prompts.mjs <bundle.msb|source-dir> [--out prompts.json] [--check] [--require-complete]",
  );
}

const root = path.dirname(fileURLToPath(import.meta.url));
const entityTemplate = stripFrontmatter(
  await readFile(
    path.join(root, "prompts/02-producer-generate-entity-references.md"),
    "utf8",
  ),
);
const imageTemplate = stripFrontmatter(
  await readFile(
    path.join(root, "prompts/03-producer-generate-reference-images.md"),
    "utf8",
  ),
);
const audioTemplate = stripFrontmatter(
  await readFile(
    path.join(root, "prompts/08-producer-generate-timing-audio.md"),
    "utf8",
  ),
);

const sourceIsDirectory = (await stat(source)).isDirectory();
if (args.includes("--require-complete") && !sourceIsDirectory)
  throw new Error(
    "--require-complete only applies to a source directory, not a packed .msb",
  );
if (args.includes("--check") && sourceIsDirectory)
  throw new Error(
    "--check only applies to a packed .msb, not a source directory",
  );

function entityBlock(shot, characters, locations, props) {
  return [
    ...shot.characters.map((id) => {
      const character = characters.get(id);
      return `CHARACTER ${id}: ${character?.name ?? id}. ${character?.description ?? "MISSING DESCRIPTION"}. Identity reference: ${character?.reference ?? "MISSING"}`;
    }),
    ...(shot.location
      ? [
          `LOCATION ${shot.location}: ${locations.get(shot.location)?.description ?? "MISSING DESCRIPTION"}. Identity reference: ${locations.get(shot.location)?.reference ?? "MISSING"}`,
        ]
      : []),
    ...props.map(
      (prop) =>
        `PROP ${prop.id}: ${prop.description}. Identity reference: ${prop.reference ?? "none"}`,
    ),
  ].join("\n");
}

async function buildStoryboardPromptPlan(file) {
  const loaded = await loadMsb(file);
  const characters = new Map(
    loaded.manifest.characters.map((item) => [item.id, item]),
  );
  const locations = new Map(
    loaded.manifest.locations.map((item) => [item.id, item]),
  );
  const seenReferences = new Map();
  const warnings = [];

  const shots = loaded.manifest.shots.map((shot, index) => {
    const references = shotReferencePaths(shot);
    if (references.length === 0)
      warnings.push(`${shot.id}: no explicit shot reference`);
    for (const reference of references) {
      const prior = seenReferences.get(reference);
      if (prior)
        warnings.push(
          `${shot.id}: reuses ${reference} from ${prior}; create a shot-specific visual-state reference`,
        );
      else seenReferences.set(reference, shot.id);
    }
    const block = entityBlock(
      shot,
      characters,
      locations,
      loaded.manifest.props,
    );
    const imagePrompt = `${imageTemplate}\n\nPROJECT: ${loaded.manifest.project.title}\nSHOT: ${shot.id} (${index + 1}/${loaded.manifest.shots.length})\nDURATION: ${shot.duration}s\n\nIDENTITY CONSTRAINTS\n${block || "No listed entities."}\n\nSHOT ACTION\n${shot.action}\n\nCAMERA\n${shot.camera}\n\nCONTINUITY\n${shot.continuity.map((item) => `- ${item}`).join("\n") || "- none"}\n\nCURRENT SHOT REFERENCES\n${references.map((item) => `- ${item}`).join("\n") || "- none"}\n`;
    const audio = [
      ...shot.dialogue.map((line) => ({
        type: "dialogue",
        character: line.character,
        text: line.text,
        start: line.start,
        end: line.end,
      })),
      ...(shot.narration
        ? [
            {
              type: "narration",
              text: shot.narration,
              start: 0,
              end: shot.duration,
            },
          ]
        : []),
    ].map((event) => {
      const prompt = `${audioTemplate}\n\nSHOT: ${shot.id}\nTYPE: ${event.type}\nSPEAKER: ${event.character ?? "narrator/ensemble"}\nWINDOW: ${event.start}s–${event.end}s\nTEXT: ${event.text}\n`;
      return { ...event, prompt, promptHash: hash(prompt) };
    });
    return {
      id: shot.id,
      suggestedReference: `references/storyboard/${shot.id}.png`,
      currentReferences: references,
      imagePrompt,
      imagePromptHash: hash(imagePrompt),
      audio,
    };
  });

  if (args.includes("--check") && warnings.length > 0)
    throw new Error(
      `storyboard prompt-plan validation failed:\n${warnings.join("\n")}`,
    );

  return {
    formatVersion: "1.0.0",
    kind: "storyboard-prompt-plan",
    sourceHash: loaded.sourceHash,
    templates: {
      image: {
        path: "scripts/prompts/03-producer-generate-reference-images.md",
        hash: hash(imageTemplate),
      },
      audio: {
        path: "scripts/prompts/08-producer-generate-timing-audio.md",
        hash: hash(audioTemplate),
      },
    },
    warnings,
    shots,
  };
}

async function buildRequestPlan(directory) {
  const raw = await readFile(path.join(directory, "msb.json"), "utf8");
  const manifest = msbManifestSchema.parse(JSON.parse(raw));
  validateManifestSemantics(manifest);
  const characters = new Map(
    manifest.characters.map((item) => [item.id, item]),
  );
  const locations = new Map(manifest.locations.map((item) => [item.id, item]));

  const statusOf = async (relativePath) => {
    const info = await stat(path.join(directory, relativePath)).catch(
      () => null,
    );
    return info?.isFile() ? "present" : "missing";
  };

  const entityRequest = async (role, entity) => {
    const prompt = `${entityTemplate}\n\nENTITY: ${entity.id}\nDESCRIPTION: ${entity.description}\n`;
    return {
      id: entity.id,
      role,
      outputPath: entity.reference,
      status: await statusOf(entity.reference),
      prompt,
      promptHash: hash(prompt),
      identityAnchors: [],
    };
  };

  const requests = [];
  if (manifest.screenplay)
    requests.push({
      id: "screenplay",
      role: "screenplay",
      outputPath: manifest.screenplay,
      status: await statusOf(manifest.screenplay),
    });
  for (const character of manifest.characters)
    requests.push(await entityRequest("character-reference", character));
  for (const location of manifest.locations)
    if (location.reference)
      requests.push(await entityRequest("location-reference", location));
  for (const prop of manifest.props)
    if (prop.reference)
      requests.push(await entityRequest("prop-reference", prop));

  for (const [index, shot] of manifest.shots.entries()) {
    const block = entityBlock(shot, characters, locations, manifest.props);
    const identityAnchors = [
      ...shot.characters
        .map((id) => characters.get(id)?.reference)
        .filter((value) => value !== undefined),
      ...(shot.location && locations.get(shot.location)?.reference
        ? [locations.get(shot.location).reference]
        : []),
    ];
    const shotPrompt = (role) =>
      `${imageTemplate}\n\nPROJECT: ${manifest.project.title}\nSHOT: ${shot.id} (${index + 1}/${manifest.shots.length})\nROLE: ${role}\nDURATION: ${shot.duration}s\n\nIDENTITY CONSTRAINTS\n${block || "No listed entities."}\n\nSHOT ACTION\n${shot.action}\n\nCAMERA\n${shot.camera}\n\nCONTINUITY\n${shot.continuity.map((item) => `- ${item}`).join("\n") || "- none"}\n`;

    const shotRequest = async (role, id, outputPath) => {
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
  }

  const missing = requests.filter((request) => request.status === "missing");
  if (args.includes("--require-complete") && missing.length > 0)
    throw new Error(
      `reference-image request plan is incomplete:\n${missing.map((request) => `${request.id} (${request.role}): ${request.outputPath}`).join("\n")}`,
    );

  return {
    formatVersion: "1.0.0",
    kind: "reference-image-request-plan",
    directory: path.resolve(directory),
    templates: {
      entity: {
        path: "scripts/prompts/02-producer-generate-entity-references.md",
        hash: hash(entityTemplate),
      },
      image: {
        path: "scripts/prompts/03-producer-generate-reference-images.md",
        hash: hash(imageTemplate),
      },
    },
    requests,
  };
}

const report = sourceIsDirectory
  ? await buildRequestPlan(source)
  : await buildStoryboardPromptPlan(source);

const output = option("--out");
if (output) {
  await mkdir(path.dirname(path.resolve(output)), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`Wrote ${output}\n`);
} else process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
