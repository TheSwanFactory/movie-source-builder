import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  CHAIN_DRIFT_MAX_ATTEMPTS,
  CHAIN_SIMILARITY_THRESHOLD,
  compareFrameSimilarity,
  extractLastFrame,
} from "./chain.js";
import {
  atomicJson,
  cuesInSpan,
  flattenShots,
  hash,
  ingestProject,
  latestShotlistId,
  listDailies,
  listShoots,
  loadShotlist,
  nextOrdinal,
  resolveInside,
  shotDuration,
  takeFileName,
  takeNumberSeed,
  takeStandings,
  validateShotlistSemantics,
  type FlatShot,
  type LoadedProject,
  type ShootRecord,
  type TimedLine,
} from "./project.js";
import {
  FALLBACK_COST_PER_SECOND,
  buildShotPrompt,
  falUnitPrice,
  loadMsbc,
  renderFalClip,
  renderMockClip,
  rendererCapabilities,
  roundCurrency,
  shotReferencePaths,
  validateShotReferences,
  type RendererCapabilities,
} from "./render.js";
import type { Finding, MsbcConfiguration, Shoot, ShootTake } from "./schema.js";

const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);

export interface ShootPlanUnit {
  shot: FlatShot;
  duration: number;
  prompt: string;
  lines: TimedLine[];
  cacheKey: string;
  estimatedCost: number;
  reuse?: { take: string; from: string; mediaHash: string };
  chainFrom?: string;
}

export interface ShootPlan {
  shotlistId: string;
  shotlistHash: string;
  configName: string;
  configuration: MsbcConfiguration;
  configurationHash: string;
  units: ShootPlanUnit[];
  findings: Finding[];
  estimatedCost: number;
  planValid: boolean;
}

export interface ShootOptions {
  /** Path to the .msbc engine configuration. */
  configuration: string;
  dryRun?: boolean;
  maxCost?: number;
  concurrency?: number;
  /** Ignore reusable takes and render every shot fresh. */
  fresh?: boolean;
}

export interface ShootResult {
  plan: ShootPlan;
  shoot?: Shoot;
  file?: string;
}

interface PreparedShoot {
  project: LoadedProject;
  plan: ShootPlan;
  assets: Map<string, Buffer>;
}

/**
 * Plan a shoot without contacting a provider: validates the shot list's
 * tiling against the screenplay (hard error — the shot list itself is
 * malformed) and against the engine's duration menu (a compatibility
 * finding — the shot list is fine, this engine cannot render it), resolves
 * prompts and cues, computes cache keys, and marks reusable takes.
 */
export async function planShoot(
  root: string,
  options: ShootOptions,
): Promise<PreparedShoot> {
  const project = await ingestProject(root);
  const shotlistId = await latestShotlistId(root);
  if (shotlistId === undefined)
    throw new Error("project has no shot list; author shotlists/001.json first");
  const { shotlist, shotlistHash } = await loadShotlist(root, shotlistId);
  validateShotlistSemantics(project.header, project.screenplay, shotlist);
  if (shotlist.shotlist.screenplayHash !== project.screenplayHash)
    throw new Error(
      `shot list ${shotlistId} tiles a different screenplay (hash mismatch); write the next shot list version against the current screenplay`,
    );
  const { configuration, configurationHash, configName } = await loadMsbc(
    options.configuration,
  );
  const capabilities = rendererCapabilities(configuration);
  const shots = flattenShots(shotlist);
  for (const shot of shots)
    if (
      (shot.chainFrom ?? undefined) !== undefined &&
      configuration.renderer.mode !== "image-to-video"
    )
      throw new Error(
        `shot ${shot.id} chains from another shot, which requires renderer.mode "image-to-video" (configured mode: "${configuration.renderer.mode}")`,
      );

  const assets = new Map<string, Buffer>();
  for (const shot of shots)
    for (const reference of shotReferencePaths(shot)) {
      if (assets.has(reference)) continue;
      const bytes = await readFile(resolveInside(root, reference)).catch(
        () => null,
      );
      if (bytes === null)
        throw new Error(`referenced asset is missing: ${reference}`);
      assets.set(reference, bytes);
    }
  for (const shot of shots)
    validateShotReferences(
      capabilities,
      configuration.renderer.provider,
      shot,
      (reference) => assets.get(reference)!,
    );

  const findings = durationMenuFindings(shots, capabilities, configuration);

  const shoots = await listShoots(root);
  const standings = takeStandings(await listDailies(root));
  const reusable = options.fresh
    ? new Map<string, { take: string; from: string; mediaHash: string }>()
    : await reusableTakes(root, shoots, standings);

  const cacheKeyByShotId = new Map<string, string>();
  const units: ShootPlanUnit[] = shots.map((shot) => {
    const duration = shotDuration(shot);
    const lines = cuesInSpan(project.screenplay, shot.span);
    const prompt = buildShotPrompt(shot, lines, configName, configuration);
    const chainFrom = shot.chainFrom ?? undefined;
    const cacheKey = hash(
      JSON.stringify({
        shot: { ...shot, sceneId: undefined },
        lines,
        prompt,
        refs: shotReferencePaths(shot).map((name) => [
          name,
          hash(assets.get(name)!),
        ]),
        engine: configuration,
        chainFrom:
          chainFrom !== undefined ? cacheKeyByShotId.get(chainFrom) : undefined,
      }),
    );
    cacheKeyByShotId.set(shot.id, cacheKey);
    const reuse = reusable.get(cacheKey);
    return {
      shot,
      duration,
      prompt,
      lines,
      cacheKey,
      estimatedCost:
        configuration.renderer.provider === "mock" || reuse
          ? 0
          : duration * FALLBACK_COST_PER_SECOND,
      ...(reuse !== undefined ? { reuse } : {}),
      ...(chainFrom !== undefined ? { chainFrom } : {}),
    };
  });

  const plan: ShootPlan = {
    shotlistId,
    shotlistHash,
    configName,
    configuration,
    configurationHash,
    units,
    findings,
    estimatedCost: roundCurrency(
      units.reduce((sum, unit) => sum + unit.estimatedCost, 0),
    ),
    planValid: findings.length === 0,
  };
  return { project, plan, assets };
}

function durationMenuFindings(
  shots: FlatShot[],
  capabilities: RendererCapabilities,
  configuration: MsbcConfiguration,
): Finding[] {
  if (capabilities.durations === undefined) return [];
  const menu = capabilities.durations;
  const offending = shots.filter(
    (shot) => !menu.includes(shotDuration(shot)),
  );
  if (offending.length === 0) return [];
  const engine = `${configuration.renderer.provider}/${configuration.renderer.model} ${configuration.renderer.mode}`;
  return [
    {
      scope: "engine-compatibility",
      engine,
      claim: `duration menu is ${menu.map((d) => `${d}s`).join("/")} only; no valid tiling for spans of ${[
        ...new Set(offending.map((shot) => `${shotDuration(shot)}s`)),
      ].join(", ")}`,
      evidence: offending
        .map(
          (shot) =>
            `shot ${shot.id} span [${shot.span[0]}, ${shot.span[1]}] is ${shotDuration(shot)}s`,
        )
        .join("; "),
      appliesTo: offending.map((shot) => shot.id),
    },
  ];
}

/**
 * Cache-key reuse across the shoot ledger: the newest rendered take per
 * cache key wins, provided it has not been rejected in dailies and its pool
 * media still exists with a matching hash.
 */
async function reusableTakes(
  root: string,
  shoots: ShootRecord[],
  standings: Map<string, "circled" | "rejected">,
): Promise<Map<string, { take: string; from: string; mediaHash: string }>> {
  const reusable = new Map<
    string,
    { take: string; from: string; mediaHash: string }
  >();
  for (const record of shoots) {
    for (const take of record.shoot.takes) {
      if (take.status !== "rendered") continue;
      if (take.media === undefined || take.mediaHash === undefined) continue;
      if (standings.get(take.take) === "rejected") continue;
      const media = await readFile(resolveInside(root, take.media)).catch(
        () => null,
      );
      if (media === null || hash(media) !== take.mediaHash) continue;
      reusable.set(take.cacheKey, {
        take: take.take,
        from: record.shoot.shoot.id,
        mediaHash: take.mediaHash,
      });
    }
    for (const reused of record.shoot.reused) {
      // Carry reuse links forward so a chain of all-reused shoots keeps working.
      if (reusable.has(reused.cacheKey)) continue;
      const poolMedia = `takes/${reused.take}.mp4`;
      const media = await readFile(resolveInside(root, poolMedia)).catch(
        () => null,
      );
      if (media === null || hash(media) !== reused.mediaHash) continue;
      if (standings.get(reused.take) === "rejected") continue;
      reusable.set(reused.cacheKey, {
        take: reused.take,
        from: reused.from,
        mediaHash: reused.mediaHash,
      });
    }
  }
  return reusable;
}

/**
 * Run one shoot: plan, validate, render new takes directly into the takes/
 * pool, and append one shoot JSON to the ledger. A failed plan is still a
 * real shoot — zero takes, zero cost, structured findings — and failures
 * mid-render leave every rendered take in the pool with the shoot recording
 * what happened.
 */
export async function runShoot(
  root: string,
  options: ShootOptions,
): Promise<ShootResult> {
  const { plan, assets } = await planShoot(root, options);
  const configuration = plan.configuration;

  if (!plan.planValid && !options.dryRun) {
    const { file } = await appendShoot(root, plan, {
      status: "failed",
      reused: [],
      takes: [],
      actualCost: 0,
      estimatedCost: 0,
      warnings: [],
    });
    throw new Error(
      `shoot plan failed and was recorded as ${file}: ${plan.findings
        .map((finding) => finding.claim)
        .join("; ")}`,
    );
  }

  const missingEnvironmentVariables =
    configuration.renderer.requiredEnvironmentVariables.filter(
      (name) => !process.env[name]?.trim(),
    );
  if (missingEnvironmentVariables.length > 0)
    throw new Error(
      `missing required renderer environment variables: ${missingEnvironmentVariables.join(", ")}`,
    );

  if (options.dryRun) return { plan };

  const isFal = configuration.renderer.provider === "fal";
  if (isFal) {
    const unitPrice = await falUnitPrice(configuration.renderer.model);
    for (const unit of plan.units)
      unit.estimatedCost = unit.reuse
        ? 0
        : roundCurrency(unit.duration * unitPrice);
    plan.estimatedCost = roundCurrency(
      plan.units.reduce((sum, unit) => sum + unit.estimatedCost, 0),
    );
  }
  if (options.maxCost !== undefined && plan.estimatedCost > options.maxCost)
    throw new Error(
      `estimated cost $${plan.estimatedCost.toFixed(2)} exceeds --max-cost $${options.maxCost.toFixed(2)}`,
    );

  const ffmpeg = (await import("ffmpeg-static")).default as unknown as
    | string
    | null;
  if (!ffmpeg) throw new Error("bundled ffmpeg is unavailable");
  await mkdir(resolveInside(root, "takes"), { recursive: true });
  const scratch = await mkdtemp(path.join(tmpdir(), "msb-shoot-"));

  const anyChained = plan.units.some((unit) => unit.chainFrom !== undefined);
  const concurrency = anyChained
    ? 1
    : Math.max(1, options.concurrency ?? 1);
  const warnings =
    anyChained && (options.concurrency ?? 1) > 1
      ? [
          "concurrency clamped to 1: chained shots (chainFrom) require strictly sequential rendering",
        ]
      : [];

  const shoots = await listShoots(root);
  const numberSeed = await takeNumberSeed(root, shoots);
  const allocateTake = (shotId: string): string => {
    const next = (numberSeed.get(shotId) ?? 0) + 1;
    numberSeed.set(shotId, next);
    return takeFileName(shotId, next);
  };

  interface UnitState {
    status: "pending" | "complete" | "failed";
    media?: string;
    lastFrame?: string;
    startingImage?: Buffer;
  }
  const states: UnitState[] = plan.units.map(() => ({ status: "pending" }));
  const unitIndexById = new Map(
    plan.units.map((unit, index) => [unit.shot.id, index]),
  );
  const reusedLinks: Shoot["reused"] = [];
  const takeEntries: ShootTake[] = [];
  let actualCost = 0;
  let stopped = false;
  let firstRenderError: unknown;

  const CHAIN_POLL_INTERVAL_MS = 50;
  const sleep = (ms: number) =>
    new Promise((resolve) => setTimeout(resolve, ms));

  const renderTakeMedia = async (
    unitIndex: number,
    startingImage: Buffer | undefined,
  ): Promise<ShootTake> => {
    const unit = plan.units[unitIndex]!;
    const takeId = allocateTake(unit.shot.id);
    const media = `takes/${takeId}.mp4`;
    const lastFrame = `takes/${takeId}.last.png`;
    const mediaAbsolute = resolveInside(root, media);
    const requestId = isFal
      ? await renderFalClip(
          {
            shotId: unit.shot.id,
            duration: unit.duration,
            prompt: unit.prompt,
            configuration,
            ...(startingImage !== undefined
              ? {
                  composition: startingImage,
                  compositionName: unit.shot.references.composition!,
                }
              : {}),
            identity: unit.shot.references.identity.map((name) => ({
              name,
              bytes: assets.get(name)!,
            })),
          },
          mediaAbsolute,
          ffmpeg,
        )
      : await renderMockClip(
          unit.duration,
          configuration.output,
          mediaAbsolute,
          ffmpeg,
        );
    const bytes = await readFile(mediaAbsolute);
    await extractLastFrame(
      mediaAbsolute,
      resolveInside(root, lastFrame),
      ffmpeg,
    );
    const cost = isFal ? unit.estimatedCost : 0;
    actualCost = roundCurrency(actualCost + cost);
    return {
      shot: unit.shot.id,
      take: takeId,
      status: "rendered",
      cacheKey: unit.cacheKey,
      media,
      mediaHash: hash(bytes),
      lastFrame,
      requestId,
      cost,
      error: null,
      warnings: [],
    };
  };

  const waitForChainPredecessor = async (unit: ShootPlanUnit) => {
    if (unit.chainFrom === undefined) return;
    const predecessorIndex = unitIndexById.get(unit.chainFrom);
    if (predecessorIndex === undefined)
      throw new Error(
        `shot ${unit.shot.id} chains from unknown shot: ${unit.chainFrom}`,
      );
    while (true) {
      if (stopped)
        throw new Error(
          `shoot stopped before predecessor ${unit.chainFrom} of chained shot ${unit.shot.id} completed`,
        );
      const state = states[predecessorIndex]!;
      if (state.status === "complete") return;
      if (state.status === "failed")
        throw new Error(
          `chained shot ${unit.shot.id} cannot render: predecessor ${unit.chainFrom} failed`,
        );
      await sleep(CHAIN_POLL_INTERVAL_MS);
    }
  };

  /**
   * Verifies the predecessor's actual last rendered frame against this
   * shot's own authored composition board. A close match promotes the real
   * frame as the render input; a miss re-renders the predecessor — each
   * retry an additional numbered take in the pool — up to
   * CHAIN_DRIFT_MAX_ATTEMPTS total predecessor renders before failing.
   */
  const resolveChainedComposition = async (
    unit: ShootPlanUnit,
  ): Promise<{ composition: Buffer; chainScore: number }> => {
    const predecessorIndex = unitIndexById.get(unit.chainFrom!)!;
    const compositionPath = unit.shot.references.composition!;
    const compositionAbsolute = resolveInside(root, compositionPath);
    const scores: number[] = [];
    for (let attempt = 1; attempt <= CHAIN_DRIFT_MAX_ATTEMPTS; attempt++) {
      if (stopped)
        throw new Error(
          `shoot stopped before predecessor ${unit.chainFrom} of chained shot ${unit.shot.id} completed`,
        );
      const predecessorState = states[predecessorIndex]!;
      if (!predecessorState.media)
        throw new Error(
          `chained shot ${unit.shot.id}: predecessor ${unit.chainFrom} has no rendered media to chain from`,
        );
      let lastFrame = predecessorState.lastFrame;
      if (lastFrame === undefined) {
        lastFrame = path.join(
          scratch,
          `${unit.shot.id}-predecessor-frame-attempt${attempt}.png`,
        );
        await extractLastFrame(predecessorState.media, lastFrame, ffmpeg);
      }
      const score = await compareFrameSimilarity(
        lastFrame,
        compositionAbsolute,
        ffmpeg,
      );
      scores.push(score);
      if (score >= CHAIN_SIMILARITY_THRESHOLD)
        return { composition: await readFile(lastFrame), chainScore: score };
      if (attempt === CHAIN_DRIFT_MAX_ATTEMPTS)
        throw new Error(
          `shot ${unit.shot.id} failed its chain drift check against predecessor ${unit.chainFrom} after ${CHAIN_DRIFT_MAX_ATTEMPTS} predecessor render attempt(s) (similarities: ${scores.map((s) => s.toFixed(3)).join(", ")}), all below threshold ${CHAIN_SIMILARITY_THRESHOLD}`,
        );
      const startingImage = predecessorState.startingImage;
      if (startingImage === undefined)
        throw new Error(
          `cannot retry predecessor ${unit.chainFrom}: its starting image was not resolved during this shoot (its take was reused from an earlier shoot) — rerun with --fresh to enable retry`,
        );
      const retryTake = await renderTakeMedia(predecessorIndex, startingImage);
      retryTake.warnings.push(
        `chain retry (attempt ${attempt + 1}/${CHAIN_DRIFT_MAX_ATTEMPTS}): downstream drift check for successor ${unit.shot.id} scored ${score.toFixed(3)} (below ${CHAIN_SIMILARITY_THRESHOLD})`,
      );
      takeEntries.push(retryTake);
      predecessorState.media = resolveInside(root, retryTake.media!);
      predecessorState.lastFrame = resolveInside(root, retryTake.lastFrame!);
    }
    throw new Error(
      `unreachable: chain drift retry loop exited without resolving ${unit.shot.id}`,
    );
  };

  let nextIndex = 0;
  const renderWorker = async () => {
    while (true) {
      if (stopped) return;
      const index = nextIndex++;
      if (index >= plan.units.length) return;
      const unit = plan.units[index]!;
      const state = states[index]!;
      try {
        if (unit.reuse) {
          reusedLinks.push({
            shot: unit.shot.id,
            take: unit.reuse.take,
            from: unit.reuse.from,
            mediaHash: unit.reuse.mediaHash,
            cacheKey: unit.cacheKey,
          });
          state.media = resolveInside(root, `takes/${unit.reuse.take}.mp4`);
          const poolLastFrame = resolveInside(
            root,
            `takes/${unit.reuse.take}.last.png`,
          );
          if (await readFile(poolLastFrame).then(() => true, () => false))
            state.lastFrame = poolLastFrame;
          state.status = "complete";
          continue;
        }
        await waitForChainPredecessor(unit);
        let startingImage: Buffer | undefined;
        let chainScore: number | undefined;
        if (isFal && configuration.renderer.mode === "image-to-video") {
          if (unit.chainFrom !== undefined) {
            const resolved = await resolveChainedComposition(unit);
            startingImage = resolved.composition;
            chainScore = resolved.chainScore;
          } else {
            startingImage = assets.get(unit.shot.references.composition!);
            if (startingImage === undefined)
              throw new Error(
                `referenced asset is missing: ${unit.shot.references.composition}`,
              );
          }
          state.startingImage = startingImage;
        }
        const take = await renderTakeMedia(index, startingImage);
        if (chainScore !== undefined) {
          take.chainScore = chainScore;
          take.warnings.push(
            `composition promoted from predecessor ${unit.chainFrom}'s rendered frame (similarity ${chainScore.toFixed(3)})`,
          );
        }
        takeEntries.push(take);
        state.media = resolveInside(root, take.media!);
        state.lastFrame = resolveInside(root, take.lastFrame!);
        state.status = "complete";
      } catch (error) {
        stopped = true;
        firstRenderError ??= error;
        state.status = "failed";
        takeEntries.push({
          shot: unit.shot.id,
          take: allocateTake(unit.shot.id),
          status: "failed",
          cacheKey: unit.cacheKey,
          cost: 0,
          error: error instanceof Error ? error.message : String(error),
          warnings: [],
        });
        return;
      }
    }
  };

  try {
    const workerResults = await Promise.allSettled(
      Array.from(
        { length: Math.min(concurrency, plan.units.length) },
        renderWorker,
      ),
    );
    firstRenderError ??= workerResults.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    )?.reason;
    const { file } = await appendShoot(root, plan, {
      status: firstRenderError ? "failed" : "complete",
      reused: reusedLinks,
      takes: takeEntries,
      actualCost,
      estimatedCost: plan.estimatedCost,
      warnings,
    });
    if (firstRenderError) throw firstRenderError;
    const written = await listShoots(root);
    const record = written.find((item) => item.file === file)!;
    return { plan, shoot: record.shoot, file };
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

async function appendShoot(
  root: string,
  plan: ShootPlan,
  outcome: {
    status: "complete" | "failed";
    reused: Shoot["reused"];
    takes: ShootTake[];
    actualCost: number;
    estimatedCost: number;
    warnings: string[];
  },
): Promise<{ shoot: Shoot; file: string }> {
  await mkdir(resolveInside(root, "shoots"), { recursive: true });
  const ordinal = await nextOrdinal(root, "shoots");
  const slug = plan.configName
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, "-")
    .replace(/^[^a-z0-9]+/, "");
  const id = `${ordinal}-${slug || "engine"}`;
  const shoot: Shoot = {
    formatVersion: "2.0.0",
    shoot: { id, createdAt: new Date().toISOString(), status: outcome.status },
    shotlist: { id: plan.shotlistId, hash: plan.shotlistHash },
    engine: {
      configName: plan.configName,
      hash: plan.configurationHash,
      resolved: plan.configuration,
    },
    tool: { name: "movie-source-builder", version: packageJson.version },
    costs: {
      estimated: outcome.estimatedCost,
      actual: outcome.actualCost,
    },
    reused: outcome.reused,
    takes: outcome.takes,
    findings: plan.findings,
    warnings: outcome.warnings,
  };
  const file = `shoots/${id}.json`;
  await atomicJson(resolveInside(root, file), shoot);
  return { shoot, file };
}
