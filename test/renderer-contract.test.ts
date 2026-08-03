import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readArchive, writeArchive } from "../src/archive.js";
import { createPlan, renderMovie } from "../src/render.js";
import { msbManifestSchema, type MsbManifest } from "../src/schema.js";

const falConfiguration = path.resolve("msbc/fal-hailuo-02-standard.msbc");
const falReferenceConfiguration = path.resolve(
  "msbc/fal-veo-3.1-fast-reference.msbc",
);

async function bundleWith(
  base: string,
  change: (manifest: MsbManifest, entries: Map<string, Buffer>) => void,
): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "msb-renderer-contract-"));
  const entries = await readArchive(base);
  const manifest = msbManifestSchema.parse(
    JSON.parse(entries.get("msb.json")!.toString()),
  );
  change(manifest, entries);
  entries.set("msb.json", Buffer.from(JSON.stringify(manifest)));
  const bundle = path.join(root, "fixture.msb");
  await writeArchive(entries, bundle);
  return bundle;
}

const compositionBundleWith = (
  change: (manifest: MsbManifest, entries: Map<string, Buffer>) => void,
) => bundleWith("examples/smoke-test.msb", change);

const identityBundleWith = (
  change: (manifest: MsbManifest, entries: Map<string, Buffer>) => void,
) => bundleWith("examples/smoke-test-reference.msb", change);

function setReferences(
  manifest: MsbManifest,
  index: number,
  references: Record<string, unknown>,
): void {
  (manifest.shots[index] as unknown as { references: unknown }).references =
    references;
}

describe("renderer input contracts", () => {
  it("accepts the provider-ready smoke test for every image-to-video fal profile", async () => {
    for (const configuration of [
      "msbc/fal-hailuo-02-standard.msbc",
      "msbc/fal-veo-3.1-fast.msbc",
      "msbc/fal-ltx-2.3-fast.msbc",
    ])
      await expect(
        createPlan("examples/smoke-test.msb", configuration),
      ).resolves.toMatchObject({ units: [{ duration: 6 }] });
  });

  it("accepts the provider-ready reference smoke test for Veo 3.1 Fast reference-to-video", async () => {
    await expect(
      createPlan(
        "examples/smoke-test-reference.msb",
        "msbc/fal-veo-3.1-fast-reference.msbc",
      ),
    ).resolves.toMatchObject({ units: [{ duration: 8 }] });
  });

  it.each([
    ["no composition reference", {}],
    [
      "an identity reference instead of composition",
      { identity: ["start.png"] },
    ],
  ])("rejects image-to-video shots with %s", async (_label, references) => {
    const bundle = await compositionBundleWith((manifest) => {
      setReferences(manifest, 0, references);
    });
    await expect(createPlan(bundle, falConfiguration)).rejects.toThrow(
      /requires between 1 and 1 composition reference|does not accept a identity reference/,
    );
  });

  it("rejects non-raster fal inputs during preflight", async () => {
    const bundle = await compositionBundleWith((manifest, entries) => {
      entries.set("reference.svg", Buffer.from("<svg></svg>"));
      setReferences(manifest, 0, { composition: "reference.svg" });
    });
    await expect(createPlan(bundle, falConfiguration)).rejects.toThrow(
      "fal reference must be PNG, JPEG, WebP, or AVIF",
    );
  });

  it("rejects raster extensions with invalid content", async () => {
    const bundle = await compositionBundleWith((manifest, entries) => {
      entries.set("fake.png", Buffer.from("not a png"));
      setReferences(manifest, 0, { composition: "fake.png" });
    });
    await expect(createPlan(bundle, falConfiguration)).rejects.toThrow(
      "is not a valid PNG, JPEG, WebP, or AVIF",
    );
  });

  it("fails pipeline preflight before credentials or provider work", async () => {
    const bundle = await compositionBundleWith((manifest) => {
      setReferences(manifest, 0, {});
    });
    const previous = process.env.FAL_KEY;
    delete process.env.FAL_KEY;
    try {
      await expect(
        renderMovie(bundle, {
          configuration: falConfiguration,
          output: `${bundle}.msbo`,
          dryRun: true,
        }),
      ).rejects.toThrow("requires between 1 and 1 composition reference");
    } finally {
      if (previous === undefined) delete process.env.FAL_KEY;
      else process.env.FAL_KEY = previous;
    }
  });

  it.each([
    ["no identity references", { identity: [] }],
    [
      "more than three identity references",
      {
        identity: [
          "identity-1.png",
          "identity-1.png",
          "identity-1.png",
          "identity-1.png",
        ],
      },
    ],
    [
      "a composition reference in addition to identity",
      { identity: ["identity-1.png"], composition: "identity-1.png" },
    ],
  ])("rejects reference-to-video shots with %s", async (_label, references) => {
    const bundle = await identityBundleWith((manifest) => {
      setReferences(manifest, 0, references);
    });
    await expect(createPlan(bundle, falReferenceConfiguration)).rejects.toThrow(
      /requires between 1 and 3 identity reference|does not accept a composition reference/,
    );
  });

  it("rejects a reference-to-video shot with an unsupported duration", async () => {
    const bundle = await identityBundleWith((manifest) => {
      manifest.shots[0]!.duration = 6;
    });
    await expect(createPlan(bundle, falReferenceConfiguration)).rejects.toThrow(
      "duration 6s is unsupported for this renderer mode",
    );
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
      createPlan("examples/smoke-test-reference.msb", configuration),
    ).rejects.toThrow('renderer mode mismatch: msbc declares "image-to-video"');
  });

  it("requires every future provider to register an input contract", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "msb-new-renderer-"));
    const configuration = path.join(root, "future.msbc");
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
          provider: "future-provider",
          model: "future-model",
          requiredEnvironmentVariables: [],
        },
      }),
    );
    await expect(
      createPlan("examples/smoke-test.msb", configuration),
    ).rejects.toThrow("unsupported renderer provider: future-provider");
  });

  it("requires every future fal model to register capabilities", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "msb-new-fal-model-"));
    const configuration = path.join(root, "future-fal.msbc");
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
          model: "fal-ai/future-provider/future-model",
          requiredEnvironmentVariables: ["FAL_KEY"],
        },
      }),
    );
    await expect(
      createPlan("examples/smoke-test.msb", configuration),
    ).rejects.toThrow(
      "unsupported fal renderer model: fal-ai/future-provider/future-model",
    );
  });

  it("allows the mock renderer to operate without image references", async () => {
    const bundle = await compositionBundleWith((manifest) => {
      setReferences(manifest, 0, {});
    });
    await expect(
      createPlan(bundle, path.resolve("msbc/mock.msbc")),
    ).resolves.toMatchObject({ estimatedCost: 0 });
  });
});
