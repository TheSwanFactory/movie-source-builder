import { rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ingestProject,
  loadShotlist,
  validateShotlistSemantics,
} from "../src/project.js";
import { makeProject } from "./helpers.js";

describe("ingest validation", () => {
  it("accepts the default fixture and the real example project", async () => {
    const root = await makeProject();
    await expect(ingestProject(root)).resolves.toMatchObject({
      screenplayHash: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    await expect(
      ingestProject(path.resolve("examples/skit-poc")),
    ).resolves.toMatchObject({
      header: { project: { id: "skit-poc" } },
    });
  });

  it("rejects duplicate cue ids", async () => {
    const root = await makeProject((fixture) => {
      fixture.screenplay.scenes[0]!.cues.push({
        id: "c001",
        at: 11,
        kind: "action",
        text: "Again.",
      });
    });
    await expect(ingestProject(root)).rejects.toThrow("duplicate cue id");
  });

  it("rejects out-of-order cues", async () => {
    const root = await makeProject((fixture) => {
      fixture.screenplay.scenes[0]!.cues.push({
        id: "c004",
        at: 2,
        kind: "action",
        text: "Backwards.",
      });
    });
    await expect(ingestProject(root)).rejects.toThrow("out of order");
  });

  it("rejects cues running past the declared duration", async () => {
    const root = await makeProject((fixture) => {
      fixture.screenplay.scenes[0]!.cues.push({
        id: "c004",
        span: [11, 14],
        kind: "dialogue",
        character: "hero",
        text: "Too long.",
      });
    });
    await expect(ingestProject(root)).rejects.toThrow(
      "runs past the declared duration",
    );
  });

  it("rejects overlapping spans for the same speaker but allows different speakers", async () => {
    const overlapping = await makeProject((fixture) => {
      fixture.screenplay.scenes[0]!.cues.splice(2, 0, {
        id: "c002b",
        span: [3, 5],
        kind: "dialogue",
        character: "hero",
        text: "Interrupting myself.",
      });
    });
    await expect(ingestProject(overlapping)).rejects.toThrow(
      "overlap for the same speaker",
    );
    const duet = await makeProject((fixture) => {
      fixture.header.cast.push({
        id: "friend",
        kind: "character",
        name: "Friend",
        description: "Another test character",
        needsModelSheet: true,
      });
      fixture.screenplay.scenes[0]!.cues.splice(2, 0, {
        id: "c002b",
        span: [3, 5],
        kind: "dialogue",
        character: "friend",
        text: "Talking over.",
      });
    });
    await expect(ingestProject(duet)).resolves.toBeDefined();
  });

  it("rejects speakers that do not resolve to cast members", async () => {
    const root = await makeProject((fixture) => {
      fixture.screenplay.scenes[0]!.cues[1]!.character = "stranger";
    });
    await expect(ingestProject(root)).rejects.toThrow(
      "does not resolve to a cast member",
    );
  });

  it("requires every cast member to have a model sheet or the explicit flag", async () => {
    const missing = await makeProject((fixture) => {
      delete fixture.header.cast[0]!.modelSheet;
    });
    await expect(ingestProject(missing)).rejects.toThrow("has no model sheet");
    const flagged = await makeProject((fixture) => {
      delete fixture.header.cast[0]!.modelSheet;
      fixture.header.cast[0]!.needsModelSheet = true;
      fixture.references.images = fixture.references.images.filter(
        (image) => image.kind !== "model-sheet",
      );
    });
    await expect(ingestProject(flagged)).resolves.toBeDefined();
  });

  it("rejects a missing or tampered draft", async () => {
    const missing = await makeProject();
    await rm(path.join(missing, "drafts/draft.md"));
    await expect(ingestProject(missing)).rejects.toThrow("missing draft");
    const tampered = await makeProject();
    await writeFile(path.join(tampered, "drafts/draft.md"), "edited in place");
    await expect(ingestProject(tampered)).rejects.toThrow(
      "draftHash does not match",
    );
  });

  it("rejects boards anchored to unknown cues and indexes of missing files", async () => {
    const badAnchor = await makeProject((fixture) => {
      fixture.references.images[1]!.anchor!.cue = "c999";
    });
    await expect(ingestProject(badAnchor)).rejects.toThrow("unknown cue");
    const missingFile = await makeProject();
    await rm(path.join(missingFile, "references/t0007.0-mid.png"));
    await expect(ingestProject(missingFile)).rejects.toThrow("missing file");
  });
});

describe("shot list validation", () => {
  it("rejects gaps, overlaps, and incomplete coverage of the timeline", async () => {
    const gap = await makeProject((fixture) => {
      fixture.shotlist.scenes[0]!.shots[1]!.span = [7, 12];
    });
    const overlap = await makeProject((fixture) => {
      fixture.shotlist.scenes[0]!.shots[1]!.span = [5, 12];
    });
    const short = await makeProject((fixture) => {
      fixture.shotlist.scenes[0]!.shots[1]!.span = [6, 11];
    });
    for (const [root, message] of [
      [gap, "does not tile the timeline"],
      [overlap, "does not tile the timeline"],
      [short, "does not cover the timeline"],
    ] as const) {
      const project = await ingestProject(root);
      const { shotlist } = await loadShotlist(root, "001");
      expect(() =>
        validateShotlistSemantics(project.header, project.screenplay, shotlist),
      ).toThrow(message);
    }
  });

  it("rejects self, forward, and composition-less chains", async () => {
    const project = await ingestProject(await makeProject());
    const load = async (
      mutate: Parameters<typeof makeProject>[0],
    ): Promise<ReturnType<typeof loadShotlist>> => {
      const root = await makeProject(mutate);
      return loadShotlist(root, "001");
    };
    const selfChain = await load((fixture) => {
      fixture.shotlist.scenes[0]!.shots[0]!.chainFrom = "shot-001";
    });
    expect(() =>
      validateShotlistSemantics(
        project.header,
        project.screenplay,
        selfChain.shotlist,
      ),
    ).toThrow("cannot chain from itself");
    const forward = await load((fixture) => {
      fixture.shotlist.scenes[0]!.shots[0]!.chainFrom = "shot-002";
    });
    expect(() =>
      validateShotlistSemantics(
        project.header,
        project.screenplay,
        forward.shotlist,
      ),
    ).toThrow("must chain from an earlier shot");
    const bare = await load((fixture) => {
      const shot = fixture.shotlist.scenes[0]!.shots[1]!;
      shot.chainFrom = "shot-001";
      shot.references = { identity: [] };
    });
    expect(() =>
      validateShotlistSemantics(
        project.header,
        project.screenplay,
        bare.shotlist,
      ),
    ).toThrow("no references.composition to verify against");
  });
});
