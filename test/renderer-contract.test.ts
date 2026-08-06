import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { planShoot } from "../src/shoot.js";
import { falInput, falReferenceInput } from "../src/render.js";
import { makeProject } from "./helpers.js";

const falConfiguration = path.resolve("msbc/fal-hailuo-02-standard.msbc");
const falReferenceConfiguration = path.resolve(
  "msbc/fal-veo-3.1-fast-reference.msbc",
);

describe("renderer input contracts", () => {
  it("accepts the provider-ready smoke test for every image-to-video fal profile", async () => {
    for (const configuration of [
      "msbc/fal-hailuo-02-standard.msbc",
      "msbc/fal-veo-3.1-fast.msbc",
      "msbc/fal-ltx-2.3-fast.msbc",
    ]) {
      const { plan } = await planShoot("examples/smoke-test", {
        configuration,
      });
      expect(plan.planValid).toBe(true);
      expect(plan.units).toHaveLength(1);
      expect(plan.units[0]!.duration).toBe(6);
    }
  });

  it("accepts the provider-ready reference smoke test for Veo 3.1 Fast reference-to-video", async () => {
    const { plan } = await planShoot("examples/smoke-test-reference", {
      configuration: falReferenceConfiguration,
    });
    expect(plan.planValid).toBe(true);
    expect(plan.units[0]!.duration).toBe(8);
  });

  it.each([
    ["no composition reference", { identity: [] }],
    [
      "an identity reference instead of composition",
      { identity: ["references/hero.png"] },
    ],
  ])("rejects image-to-video shots with %s", async (_label, references) => {
    const root = await makeProject((fixture) => {
      fixture.shotlist.scenes[0]!.shots[0]!.references = references as never;
    });
    await expect(
      planShoot(root, { configuration: falConfiguration }),
    ).rejects.toThrow(
      /requires between 1 and 1 composition reference|does not accept a identity reference/,
    );
  });

  it("rejects non-raster fal inputs during preflight", async () => {
    const root = await makeProject((fixture) => {
      fixture.files["references/reference.svg"] = Buffer.from("<svg></svg>");
      fixture.shotlist.scenes[0]!.shots[0]!.references = {
        identity: [],
        composition: "references/reference.svg",
      };
    });
    await expect(
      planShoot(root, { configuration: falConfiguration }),
    ).rejects.toThrow("fal reference must be PNG, JPEG, WebP, or AVIF");
  });

  it("rejects raster extensions with invalid content", async () => {
    const root = await makeProject((fixture) => {
      fixture.files["references/fake.png"] = Buffer.from("not a png");
      fixture.shotlist.scenes[0]!.shots[0]!.references = {
        identity: [],
        composition: "references/fake.png",
      };
    });
    await expect(
      planShoot(root, { configuration: falConfiguration }),
    ).rejects.toThrow("is not a valid PNG, JPEG, WebP, or AVIF");
  });

  it.each([
    ["no identity references", { identity: [] }],
    [
      "more than three identity references",
      {
        identity: [
          "references/hero.png",
          "references/hero.png",
          "references/hero.png",
          "references/hero.png",
        ],
      },
    ],
    [
      "a composition reference in addition to identity",
      {
        identity: ["references/hero.png"],
        composition: "references/hero.png",
      },
    ],
  ])("rejects reference-to-video shots with %s", async (_label, references) => {
    const root = await makeProject((fixture) => {
      for (const shot of fixture.shotlist.scenes[0]!.shots)
        shot.references = references as never;
    });
    await expect(
      planShoot(root, { configuration: falReferenceConfiguration }),
    ).rejects.toThrow(
      /requires between 1 and 3 identity reference|does not accept a composition reference/,
    );
  });

  it("treats an unsupported duration as a plan finding, not a validation error", async () => {
    // Veo reference-to-video only renders 8s; the fixture's shots are 6s.
    const root = await makeProject((fixture) => {
      for (const shot of fixture.shotlist.scenes[0]!.shots)
        shot.references = { identity: ["references/hero.png"] };
    });
    const { plan } = await planShoot(root, {
      configuration: falReferenceConfiguration,
    });
    expect(plan.planValid).toBe(false);
    expect(plan.findings[0]).toMatchObject({
      scope: "engine-compatibility",
      appliesTo: ["shot-001", "shot-002"],
    });
  });

  it("rejects an msbc mode that does not match the model's registered mode", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "msb-mode-mismatch-"));
    const configuration = path.join(root, "mismatch.msbc");
    await writeFile(
      configuration,
      JSON.stringify({
        version: "1.0.0",
        output: {
          aspectRatio: "16:9",
          width: 1280,
          height: 720,
          frameRate: 24,
        },
        renderer: {
          provider: "fal",
          model: "fal-ai/veo3.1/fast/reference-to-video",
          mode: "image-to-video",
          requiredEnvironmentVariables: ["FAL_KEY"],
        },
      }),
    );
    await expect(
      planShoot(await makeProject(), { configuration }),
    ).rejects.toThrow('renderer mode mismatch: msbc declares "image-to-video"');
  });

  it("requires every future provider and fal model to register a contract", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "msb-new-renderer-"));
    const output = {
      aspectRatio: "16:9",
      width: 1280,
      height: 720,
      frameRate: 24,
    };
    const provider = path.join(root, "future.msbc");
    await writeFile(
      provider,
      JSON.stringify({
        version: "1.0.0",
        output,
        renderer: {
          provider: "future-provider",
          model: "future-model",
          requiredEnvironmentVariables: [],
        },
      }),
    );
    await expect(
      planShoot(await makeProject(), { configuration: provider }),
    ).rejects.toThrow("unsupported renderer provider: future-provider");
    const falModel = path.join(root, "future-fal.msbc");
    await writeFile(
      falModel,
      JSON.stringify({
        version: "1.0.0",
        output,
        renderer: {
          provider: "fal",
          model: "fal-ai/future-provider/future-model",
          requiredEnvironmentVariables: ["FAL_KEY"],
        },
      }),
    );
    await expect(
      planShoot(await makeProject(), { configuration: falModel }),
    ).rejects.toThrow(
      "unsupported fal renderer model: fal-ai/future-provider/future-model",
    );
  });

  it("allows the mock renderer to operate without image references", async () => {
    const root = await makeProject((fixture) => {
      for (const shot of fixture.shotlist.scenes[0]!.shots)
        shot.references = { identity: [] };
    });
    const { plan } = await planShoot(root, {
      configuration: path.resolve("msbc/mock.msbc"),
    });
    expect(plan.planValid).toBe(true);
    expect(plan.estimatedCost).toBe(0);
  });

  it("maps durations and prompts to model-specific fal inputs", () => {
    expect(
      falInput(
        "fal-ai/minimax/hailuo-02/standard/image-to-video",
        { aspectRatio: "16:9", width: 1366, height: 768, frameRate: 25 },
        6,
        "a prompt",
        "https://example.test/start.png",
      ),
    ).toMatchObject({ duration: "6", resolution: "768P", prompt: "a prompt" });
    expect(
      falInput(
        "fal-ai/ltx-2.3/image-to-video/fast",
        { aspectRatio: "16:9", width: 1920, height: 1080, frameRate: 25 },
        6,
        "a prompt",
        "https://example.test/start.png",
      ),
    ).toMatchObject({ duration: 6, resolution: "1080p", fps: 25 });
    const imageUrls = ["https://example.test/a.png"];
    expect(
      falReferenceInput(
        "fal-ai/veo3.1/fast/reference-to-video",
        { aspectRatio: "16:9", width: 1280, height: 720, frameRate: 24 },
        8,
        "a prompt",
        imageUrls,
      ),
    ).toMatchObject({
      image_urls: imageUrls,
      duration: "8s",
      resolution: "720p",
      generate_audio: true,
    });
    expect(() =>
      falReferenceInput(
        "fal-ai/future-provider/future-model",
        { aspectRatio: "16:9", width: 1280, height: 720, frameRate: 24 },
        8,
        "a prompt",
        imageUrls,
      ),
    ).toThrow("unsupported fal reference-to-video model");
  });
});
