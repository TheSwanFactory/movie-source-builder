#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { loadMsb } from "../dist/render.js";

const hash = (value) => createHash("sha256").update(value).digest("hex");
const args = process.argv.slice(2);
const source = args.find((arg) => !arg.startsWith("--"));
const option = (name) => {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
};
if (!source) {
  throw new Error(
    "usage: node scripts/generate-storyboard-prompts.mjs <source.msb> [--out prompts.json] [--check]",
  );
}

const root = path.dirname(fileURLToPath(import.meta.url));
const imageTemplate = await readFile(
  path.join(root, "prompts/storyboard-image.md"),
  "utf8",
);
const audioTemplate = await readFile(
  path.join(root, "prompts/storyboard-audio.md"),
  "utf8",
);
const loaded = await loadMsb(source);
const characters = new Map(
  loaded.manifest.characters.map((item) => [item.id, item]),
);
const locations = new Map(
  loaded.manifest.locations.map((item) => [item.id, item]),
);
const seenReferences = new Map();
const warnings = [];

const shots = loaded.manifest.shots.map((shot, index) => {
  const references = shot.references;
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
  const entityBlock = [
    ...shot.characters.map((id) => {
      const character = characters.get(id);
      return `CHARACTER ${id}: ${character?.name ?? id}. ${character?.description ?? "MISSING DESCRIPTION"}. Identity reference: ${character?.reference ?? "MISSING"}`;
    }),
    ...(shot.location
      ? [
          `LOCATION ${shot.location}: ${locations.get(shot.location)?.description ?? "MISSING DESCRIPTION"}. Identity reference: ${locations.get(shot.location)?.reference ?? "MISSING"}`,
        ]
      : []),
    ...loaded.manifest.props.map(
      (prop) =>
        `PROP ${prop.id}: ${prop.description}. Identity reference: ${prop.reference ?? "none"}`,
    ),
  ].join("\n");
  const imagePrompt = `${imageTemplate.trim()}\n\nPROJECT: ${loaded.manifest.project.title}\nSHOT: ${shot.id} (${index + 1}/${loaded.manifest.shots.length})\nDURATION: ${shot.duration}s\n\nIDENTITY CONSTRAINTS\n${entityBlock || "No listed entities."}\n\nSHOT ACTION\n${shot.action}\n\nCAMERA\n${shot.camera}\n\nCONTINUITY\n${shot.continuity.map((item) => `- ${item}`).join("\n") || "- none"}\n\nCURRENT SHOT REFERENCES\n${references.map((item) => `- ${item}`).join("\n") || "- none"}\n`;
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
    const prompt = `${audioTemplate.trim()}\n\nSHOT: ${shot.id}\nTYPE: ${event.type}\nSPEAKER: ${event.character ?? "narrator/ensemble"}\nWINDOW: ${event.start}s–${event.end}s\nTEXT: ${event.text}\n`;
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

const report = {
  formatVersion: "1.0.0",
  kind: "storyboard-prompt-plan",
  sourceHash: loaded.sourceHash,
  templates: {
    image: {
      path: "scripts/prompts/storyboard-image.md",
      hash: hash(imageTemplate),
    },
    audio: {
      path: "scripts/prompts/storyboard-audio.md",
      hash: hash(audioTemplate),
    },
  },
  warnings,
  shots,
};
if (args.includes("--check") && warnings.length > 0)
  throw new Error(
    `storyboard prompt-plan validation failed:\n${warnings.join("\n")}`,
  );
const output = option("--out");
if (output) {
  await mkdir(path.dirname(path.resolve(output)), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`Wrote ${output}\n`);
} else process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
