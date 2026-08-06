import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { hash, toJson } from "../src/project.js";
import type {
  MsbHeader,
  ReferencesIndex,
  Screenplay,
  Shotlist,
} from "../src/schema.js";

/** A tiny valid 1x1 PNG, good enough for raster sniffing and ffmpeg. */
export const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

export interface Fixture {
  header: MsbHeader;
  screenplay: Screenplay;
  references: ReferencesIndex;
  shotlist: Shotlist;
  /** Extra raster files to write under the project root, path -> bytes. */
  files: Record<string, Buffer>;
}

export function defaultFixture(): Fixture {
  return {
    header: {
      formatVersion: "2.0.0",
      project: { id: "fixture", title: "Fixture Project" },
      cast: [
        {
          id: "hero",
          kind: "character",
          name: "Hero",
          description: "A test character",
          modelSheet: "references/hero.png",
          needsModelSheet: false,
        },
      ],
    },
    screenplay: {
      formatVersion: "2.0.0",
      screenplay: {
        title: "Fixture Project",
        duration: 12,
        draft: "drafts/draft.md",
        draftHash: "0".repeat(64), // recomputed at write time
      },
      scenes: [
        {
          id: "scene-001",
          slug: "somewhere",
          cues: [
            { id: "c001", at: 0, kind: "action", text: "It begins." },
            {
              id: "c002",
              span: [1, 4],
              kind: "dialogue",
              character: "hero",
              text: "First line.",
            },
            {
              id: "c003",
              span: [7, 10],
              kind: "dialogue",
              character: "hero",
              text: "Second line.",
            },
          ],
        },
      ],
    },
    references: {
      formatVersion: "2.0.0",
      images: [
        {
          file: "references/hero.png",
          kind: "model-sheet",
          subjects: ["hero"],
        },
        {
          file: "references/t0000.0-open.png",
          kind: "board",
          subjects: ["hero"],
          anchor: { cue: "c001", at: 0, screenplayHash: "0".repeat(64) },
        },
        {
          file: "references/t0007.0-mid.png",
          kind: "board",
          subjects: ["hero"],
          anchor: { cue: "c003", at: 7, screenplayHash: "0".repeat(64) },
        },
      ],
    },
    shotlist: {
      formatVersion: "2.0.0",
      shotlist: {
        id: "001",
        screenplayHash: "0".repeat(64), // recomputed at write time
        createdAt: "2026-08-05T00:00:00.000Z",
      },
      scenes: [
        {
          id: "scene-001",
          shots: [
            {
              id: "shot-001",
              span: [0, 6],
              characters: ["hero"],
              action: "The hero does something.",
              camera: "Wide shot.",
              references: {
                identity: [],
                composition: "references/t0000.0-open.png",
              },
              continuity: [],
              prompts: { default: null },
            },
            {
              id: "shot-002",
              span: [6, 12],
              characters: ["hero"],
              action: "The hero does something else.",
              camera: "Close shot.",
              references: {
                identity: [],
                composition: "references/t0007.0-mid.png",
              },
              continuity: [],
              prompts: { default: null },
            },
          ],
        },
      ],
    },
    files: {
      "references/hero.png": TINY_PNG,
      "references/t0000.0-open.png": TINY_PNG,
      "references/t0007.0-mid.png": TINY_PNG,
    },
  };
}

/**
 * Writes a fixture project to a fresh temp folder, recomputing the draft
 * hash, board anchors' screenplay hash, and the shot list's screenplay hash
 * after any mutation — so tests mutate content, not bookkeeping.
 */
export async function makeProject(
  mutate?: (fixture: Fixture) => void,
): Promise<string> {
  const fixture = defaultFixture();
  mutate?.(fixture);
  const root = await mkdtemp(path.join(tmpdir(), "msb-fixture-"));
  for (const directory of [
    "drafts",
    "references",
    "shotlists",
    "takes",
    "shoots",
    "dailies",
    "cuts",
  ])
    await mkdir(path.join(root, directory), { recursive: true });
  const draft = "# Fixture draft\n\nIt begins. Lines are spoken.\n";
  await writeFile(path.join(root, fixture.screenplay.screenplay.draft), draft);
  fixture.screenplay.screenplay.draftHash = hash(draft);
  const screenplayText = toJson(fixture.screenplay);
  await writeFile(path.join(root, "screenplay.json"), screenplayText);
  const screenplayHash = hash(screenplayText);
  for (const image of fixture.references.images)
    if (image.anchor) image.anchor.screenplayHash = screenplayHash;
  fixture.shotlist.shotlist.screenplayHash = screenplayHash;
  await writeFile(path.join(root, "msb.json"), toJson(fixture.header));
  await writeFile(
    path.join(root, "references/references.json"),
    toJson(fixture.references),
  );
  await writeFile(
    path.join(root, `shotlists/${fixture.shotlist.shotlist.id}.json`),
    toJson(fixture.shotlist),
  );
  for (const [name, bytes] of Object.entries(fixture.files))
    await writeFile(path.join(root, name), bytes);
  return root;
}

export const MOCK_CONFIGURATION = path.resolve("msbc/mock.msbc");
