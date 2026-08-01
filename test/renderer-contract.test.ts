import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readArchive, writeArchive } from "../src/archive.js";
import { createPlan, renderMovie } from "../src/render.js";
import { msbManifestSchema, type MsbManifest } from "../src/schema.js";

const falConfiguration = path.resolve("msbc/fal-hailuo-02-standard.msbc");

async function bundleWith(
  change: (manifest: MsbManifest, entries: Map<string, Buffer>) => void,
): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "msb-renderer-contract-"));
  const entries = await readArchive("examples/smoke-test.msb");
  const manifest = msbManifestSchema.parse(
    JSON.parse(entries.get("msb.json")!.toString()),
  );
  change(manifest, entries);
  entries.set("msb.json", Buffer.from(JSON.stringify(manifest)));
  const bundle = path.join(root, "fixture.msb");
  await writeArchive(entries, bundle);
  return bundle;
}

describe("renderer input contracts", () => {
  it("accepts the provider-ready smoke test for every fal profile", async () => {
    for (const configuration of [
      "msbc/fal-hailuo-02-standard.msbc",
      "msbc/fal-veo-3.1-fast.msbc",
      "msbc/fal-ltx-2.3-fast.msbc",
    ])
      await expect(
        createPlan("examples/smoke-test.msb", configuration),
      ).resolves.toMatchObject({ units: [{ duration: 6 }] });
  });

  it.each([
    ["no references", []],
    ["multiple references", ["start.png", "start.png"]],
  ])("rejects fal shots with %s", async (_label, references) => {
    const bundle = await bundleWith((manifest) => {
      manifest.shots[0]!.references = references;
    });
    await expect(createPlan(bundle, falConfiguration)).rejects.toThrow(
      "requires exactly one explicit raster reference in shot.references",
    );
  });

  it("rejects non-raster fal inputs during preflight", async () => {
    const bundle = await bundleWith((manifest, entries) => {
      entries.set("reference.svg", Buffer.from("<svg></svg>"));
      manifest.shots[0]!.references = ["reference.svg"];
    });
    await expect(createPlan(bundle, falConfiguration)).rejects.toThrow(
      "fal reference must be PNG, JPEG, WebP, or AVIF",
    );
  });

  it("rejects raster extensions with invalid content", async () => {
    const bundle = await bundleWith((manifest, entries) => {
      entries.set("fake.png", Buffer.from("not a png"));
      manifest.shots[0]!.references = ["fake.png"];
    });
    await expect(createPlan(bundle, falConfiguration)).rejects.toThrow(
      "is not a valid PNG, JPEG, WebP, or AVIF",
    );
  });

  it("fails pipeline preflight before credentials or provider work", async () => {
    const bundle = await bundleWith((manifest) => {
      manifest.shots[0]!.references = [];
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
      ).rejects.toThrow(
        "requires exactly one explicit raster reference in shot.references",
      );
    } finally {
      if (previous === undefined) delete process.env.FAL_KEY;
      else process.env.FAL_KEY = previous;
    }
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

  it("allows the mock renderer to operate without image references", async () => {
    const bundle = await bundleWith((manifest) => {
      manifest.shots[0]!.references = [];
    });
    await expect(
      createPlan(bundle, path.resolve("msbc/mock.msbc")),
    ).resolves.toMatchObject({ estimatedCost: 0 });
  });
});
