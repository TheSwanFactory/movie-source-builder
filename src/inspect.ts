import {
  allCues,
  animaticStanding,
  computeLatest,
  ingestProject,
  listDailies,
  listShoots,
  listShotlists,
  scanTakePool,
  takeStandings,
  type ShootRecord,
  type TakeStanding,
} from "./project.js";
import { listUnreviewed } from "./dailies.js";
import type { Cue, Finding, Screenplay } from "./schema.js";

export interface ProjectReport {
  project: { id: string; title: string; description?: string };
  screenplay: { title: string; duration: number; scenes: number; cues: number };
  cast: Array<{ id: string; kind: string; modelSheet?: string }>;
  references: { modelSheets: number; boards: number };
  shotlists: { count: number; latest?: string };
  shoots: Array<{
    id: string;
    status: string;
    shotlist: string;
    engine: string;
    takes: number;
    reused: number;
    findings: number;
    actualCost: number;
  }>;
  takes: { total: number; unreviewed: number };
  dailies: { sessions: number; observations: number; verdicts: number };
  animatic: TakeStanding;
  findings: number;
  latest: Awaited<ReturnType<typeof computeLatest>>;
}

export async function inspectProject(root: string): Promise<ProjectReport> {
  const project = await ingestProject(root);
  const shoots = await listShoots(root);
  const dailies = await listDailies(root);
  const pool = await scanTakePool(root);
  const unreviewed = await listUnreviewed(root);
  const latest = await computeLatest(root);
  const shotlistIds = await listShotlists(root);
  const { header, screenplay, references } = project;
  return {
    project: {
      id: header.project.id,
      title: header.project.title,
      ...(header.project.description !== undefined
        ? { description: header.project.description }
        : {}),
    },
    screenplay: {
      title: screenplay.screenplay.title,
      duration: screenplay.screenplay.duration,
      scenes: screenplay.scenes.length,
      cues: allCues(screenplay).length,
    },
    cast: header.cast.map((member) => ({
      id: member.id,
      kind: member.kind,
      ...(member.modelSheet !== undefined
        ? { modelSheet: member.modelSheet }
        : {}),
    })),
    references: {
      modelSheets: references.images.filter(
        (image) => image.kind === "model-sheet",
      ).length,
      boards: references.images.filter((image) => image.kind === "board")
        .length,
    },
    shotlists: {
      count: shotlistIds.length,
      ...(shotlistIds.length > 0 ? { latest: shotlistIds.at(-1)! } : {}),
    },
    shoots: shoots.map(({ shoot }) => ({
      id: shoot.shoot.id,
      status: shoot.shoot.status,
      shotlist: shoot.shotlist.id,
      engine: shoot.engine.configName,
      takes: shoot.takes.length,
      reused: shoot.reused.length,
      findings: shoot.findings.length,
      actualCost: shoot.costs.actual,
    })),
    takes: { total: pool.length, unreviewed: unreviewed.length },
    dailies: {
      sessions: dailies.length,
      observations: dailies.reduce(
        (sum, record) => sum + record.dailies.observations.length,
        0,
      ),
      verdicts: dailies.reduce(
        (sum, record) =>
          sum +
          record.dailies.observations.filter(
            (observation) => observation.verdict !== undefined,
          ).length,
        0,
      ),
    },
    animatic: animaticStanding(dailies),
    findings: shoots.reduce(
      (sum, record) => sum + record.shoot.findings.length,
      0,
    ),
    latest,
  };
}

export function formatProjectReport(report: ProjectReport): string {
  const lines = [
    report.project.title,
    `Screenplay: ${report.screenplay.duration}s, ${report.screenplay.scenes} scene(s), ${report.screenplay.cues} cue(s)`,
    `Cast: ${report.cast.map((member) => member.id).join(", ") || "none"}`,
    `References: ${report.references.modelSheets} model sheet(s), ${report.references.boards} board(s)`,
    `Shot lists: ${report.shotlists.count}${report.shotlists.latest ? ` (latest ${report.shotlists.latest})` : ""}`,
    `Shoots: ${report.shoots.length}`,
    ...report.shoots.map(
      (shoot) =>
        `  ${shoot.id}  ${shoot.status}  shotlist ${shoot.shotlist}  ${shoot.takes} take(s), ${shoot.reused} reused, ${shoot.findings} finding(s), $${shoot.actualCost.toFixed(2)}`,
    ),
    `Takes: ${report.takes.total} in pool, ${report.takes.unreviewed} unreviewed`,
    `Dailies: ${report.dailies.sessions} session(s), ${report.dailies.observations} observation(s), ${report.dailies.verdicts} verdict(s)`,
    ...(report.animatic !== "unreviewed"
      ? [`Animatic: ${report.animatic}`]
      : []),
    `Findings: ${report.findings}`,
  ];
  return lines.join("\n");
}

export interface AggregatedFinding extends Finding {
  shoot: string;
}

/** Cross-engine compatibility knowledge, queried from the ledger. */
export function aggregateFindings(shoots: ShootRecord[]): AggregatedFinding[] {
  return shoots.flatMap((record) =>
    record.shoot.findings.map((finding) => ({
      ...finding,
      shoot: record.shoot.shoot.id,
    })),
  );
}

export function formatFindings(findings: AggregatedFinding[]): string {
  if (findings.length === 0) return "No findings recorded.";
  return findings
    .map(
      (finding) =>
        `[${finding.shoot}] ${finding.scope}${finding.engine ? ` (${finding.engine})` : ""}: ${finding.claim}${
          finding.appliesTo.length
            ? `\n  applies to: ${finding.appliesTo.join(", ")}`
            : ""
        }${finding.evidence ? `\n  evidence: ${finding.evidence}` : ""}`,
    )
    .join("\n");
}

export interface ShotHistoryEntry {
  take: string;
  shoot: string;
  engine: string;
  status: "rendered" | "failed";
  standing: TakeStanding;
  cost: number;
  chainScore?: number;
  media?: string;
  notes?: string;
  error?: string;
}

/** Every take of one shot across all shoots and engines, oldest first. */
export async function shotHistory(
  root: string,
  shotId: string,
): Promise<ShotHistoryEntry[]> {
  const shoots = await listShoots(root);
  const standings = takeStandings(await listDailies(root));
  const pool = new Map(
    (await scanTakePool(root)).map((take) => [take.take, take]),
  );
  const entries: ShotHistoryEntry[] = [];
  for (const record of shoots)
    for (const take of record.shoot.takes) {
      if (take.shot !== shotId) continue;
      const poolTake = pool.get(take.take);
      entries.push({
        take: take.take,
        shoot: record.shoot.shoot.id,
        engine: record.shoot.engine.configName,
        status: take.status,
        standing: (standings.get(take.take) ?? "unreviewed") as TakeStanding,
        cost: take.cost,
        ...(take.chainScore !== undefined
          ? { chainScore: take.chainScore }
          : {}),
        ...(poolTake?.media !== undefined ? { media: poolTake.media } : {}),
        ...(poolTake?.notes !== undefined ? { notes: poolTake.notes } : {}),
        ...(take.error !== null ? { error: take.error } : {}),
      });
    }
  return entries;
}

export function formatShotHistory(
  shotId: string,
  entries: ShotHistoryEntry[],
): string {
  if (entries.length === 0) return `No takes recorded for ${shotId}.`;
  return entries
    .map(
      (entry) =>
        `${entry.take}  [${entry.shoot} / ${entry.engine}]  ${entry.status}, ${entry.standing}, $${entry.cost.toFixed(2)}${
          entry.chainScore !== undefined
            ? `, chain ${entry.chainScore.toFixed(3)}`
            : ""
        }${entry.media ? `\n  media: ${entry.media}` : "\n  media: (reclaimed)"}${
          entry.notes ? `\n  notes: ${entry.notes}` : ""
        }${entry.error ? `\n  error: ${entry.error}` : ""}`,
    )
    .join("\n");
}

const formatSeconds = (value: number): string =>
  Number.isInteger(value) ? `${value}` : value.toFixed(1);

function formatCue(cue: Cue): string {
  if (cue.kind === "action")
    return `  [${formatSeconds(cue.at!)}s]  ${cue.text}`;
  const speaker =
    cue.kind === "narration"
      ? "NARRATOR"
      : (cue.character ?? "ensemble").toUpperCase();
  const window = `${formatSeconds(cue.span![0])}-${formatSeconds(cue.span![1])}s`;
  const delivery = cue.delivery ? ` (${cue.delivery})` : "";
  return `  ${window}  ${speaker}${delivery}:\n      ${cue.text}`;
}

/**
 * The canonical screenplay rendered as readable, screenplay-formatted text —
 * how the Author confirms the Producer's canonicalization says what the
 * draft meant, without ever reading JSON.
 */
export function renderScreenplayText(screenplay: Screenplay): string {
  const lines = [
    screenplay.screenplay.title.toUpperCase(),
    `Duration: ${formatSeconds(screenplay.screenplay.duration)}s`,
    `Canonicalized from: ${screenplay.screenplay.draft}`,
    "",
  ];
  for (const scene of screenplay.scenes) {
    lines.push(
      `SCENE ${scene.id.toUpperCase()} — ${scene.slug.toUpperCase()}`,
      "",
    );
    for (const cue of scene.cues) lines.push(formatCue(cue), "");
  }
  return lines.join("\n").trimEnd() + "\n";
}
