import { createHash } from "node:crypto";
import { readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  dailiesSchema,
  msbHeaderSchema,
  referencesIndexSchema,
  screenplaySchema,
  shootSchema,
  shotlistSchema,
  takeIdPattern,
  type Cue,
  type Dailies,
  type MsbHeader,
  type ReferencesIndex,
  type Screenplay,
  type Shoot,
  type Shot,
  type Shotlist,
} from "./schema.js";

export const hash = (value: Buffer | string): string =>
  createHash("sha256").update(value).digest("hex");

/** Resolves a project-relative path, refusing anything outside the root. */
export function resolveInside(root: string, relative: string): string {
  const rootResolved = path.resolve(root);
  const resolved = path.resolve(rootResolved, relative);
  if (
    resolved !== rootResolved &&
    !resolved.startsWith(rootResolved + path.sep)
  )
    throw new Error(`path escapes the project root: ${relative}`);
  return resolved;
}

export async function atomicWrite(
  file: string,
  contents: Buffer | string,
): Promise<void> {
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, contents);
  await rename(temporary, file);
}

export const toJson = (value: unknown): string =>
  `${JSON.stringify(value, null, 2)}\n`;

export async function atomicJson(file: string, value: unknown): Promise<void> {
  await atomicWrite(file, toJson(value));
}

async function readProjectJson(root: string, relative: string): Promise<{
  raw: Buffer;
  value: unknown;
}> {
  const file = resolveInside(root, relative);
  let raw: Buffer;
  try {
    raw = await readFile(file);
  } catch {
    throw new Error(`missing project file: ${relative}`);
  }
  try {
    return { raw, value: JSON.parse(raw.toString("utf8")) };
  } catch (error) {
    throw new Error(
      `invalid JSON in ${relative}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function fileExists(root: string, relative: string): Promise<boolean> {
  const info = await stat(resolveInside(root, relative)).catch(() => null);
  return info?.isFile() ?? false;
}

async function listFiles(root: string, directory: string): Promise<string[]> {
  const entries = await readdir(resolveInside(root, directory), {
    withFileTypes: true,
  }).catch(() => []);
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort();
}

// --- loading the working set -------------------------------------------------

export async function loadHeader(root: string): Promise<MsbHeader> {
  const { value } = await readProjectJson(root, "msb.json");
  return msbHeaderSchema.parse(value);
}

export async function loadScreenplay(root: string): Promise<{
  screenplay: Screenplay;
  screenplayHash: string;
}> {
  const { raw, value } = await readProjectJson(root, "screenplay.json");
  return { screenplay: screenplaySchema.parse(value), screenplayHash: hash(raw) };
}

export async function loadReferencesIndex(
  root: string,
): Promise<ReferencesIndex> {
  const { value } = await readProjectJson(root, "references/references.json");
  return referencesIndexSchema.parse(value);
}

export interface LoadedProject {
  root: string;
  header: MsbHeader;
  screenplay: Screenplay;
  screenplayHash: string;
  references: ReferencesIndex;
}

/** The time a cue begins: `at` for point cues, `span[0]` for span cues. */
export const cueStart = (cue: Cue): number => cue.at ?? cue.span![0];
export const cueEnd = (cue: Cue): number => cue.span?.[1] ?? cue.at!;

export function allCues(screenplay: Screenplay): Cue[] {
  return screenplay.scenes.flatMap((scene) => scene.cues);
}

/**
 * Ingest semantics: unique monotonic cues within the declared duration, no
 * same-speaker dialogue overlap, and every speaker resolving to the cast.
 */
export function validateScreenplaySemantics(
  header: MsbHeader,
  screenplay: Screenplay,
): void {
  const duration = screenplay.screenplay.duration;
  const castIds = new Set(header.cast.map((member) => member.id));
  const sceneIds = new Set<string>();
  const cueIds = new Set<string>();
  let previousStart = -Infinity;
  for (const scene of screenplay.scenes) {
    if (sceneIds.has(scene.id))
      throw new Error(`duplicate scene id: ${scene.id}`);
    sceneIds.add(scene.id);
    for (const cue of scene.cues) {
      if (cueIds.has(cue.id)) throw new Error(`duplicate cue id: ${cue.id}`);
      cueIds.add(cue.id);
      const start = cueStart(cue);
      if (start < previousStart)
        throw new Error(
          `cue ${cue.id} is out of order: starts at ${start}s after a cue starting at ${previousStart}s`,
        );
      previousStart = start;
      if (cueEnd(cue) > duration)
        throw new Error(
          `cue ${cue.id} runs past the declared duration of ${duration}s`,
        );
      if (cue.character !== undefined && !castIds.has(cue.character))
        throw new Error(
          `cue ${cue.id} speaker does not resolve to a cast member: ${cue.character}`,
        );
    }
  }
  const spansBySpeaker = new Map<string, Array<{ id: string; span: [number, number] }>>();
  for (const cue of allCues(screenplay)) {
    if (cue.span === undefined) continue;
    const speaker = cue.character ?? "(ensemble)";
    const spans = spansBySpeaker.get(speaker) ?? [];
    for (const other of spans)
      if (cue.span[0] < other.span[1] && other.span[0] < cue.span[1])
        throw new Error(
          `cues ${other.id} and ${cue.id} overlap for the same speaker: ${speaker}`,
        );
    spans.push({ id: cue.id, span: cue.span });
    spansBySpeaker.set(speaker, spans);
  }
}

/**
 * Full ingest: schema + semantic validation of the working set. Nothing
 * downstream (boards, shot lists, shoots) runs against a project that has
 * not passed this.
 */
export async function ingestProject(root: string): Promise<LoadedProject> {
  const info = await stat(root).catch(() => null);
  if (!info?.isDirectory()) throw new Error(`not a project folder: ${root}`);
  const header = await loadHeader(root);
  const { screenplay, screenplayHash } = await loadScreenplay(root);
  validateScreenplaySemantics(header, screenplay);
  const draft = screenplay.screenplay.draft;
  const draftBytes = await readFile(resolveInside(root, draft)).catch(() => null);
  if (draftBytes === null)
    throw new Error(`screenplay names a missing draft: ${draft}`);
  if (hash(draftBytes) !== screenplay.screenplay.draftHash)
    throw new Error(
      `screenplay draftHash does not match ${draft}; the draft is append-only — add a revised draft and re-canonicalize instead of editing in place`,
    );
  const references = await loadReferencesIndex(root);
  const indexed = new Set<string>();
  const cueIds = new Set(allCues(screenplay).map((cue) => cue.id));
  for (const image of references.images) {
    if (indexed.has(image.file))
      throw new Error(`references.json indexes ${image.file} twice`);
    indexed.add(image.file);
    if (!(await fileExists(root, image.file)))
      throw new Error(`references.json indexes a missing file: ${image.file}`);
    if (image.anchor && !cueIds.has(image.anchor.cue))
      throw new Error(
        `board ${image.file} anchors to an unknown cue: ${image.anchor.cue}`,
      );
  }
  const castIds = new Set(header.cast.map((member) => member.id));
  for (const image of references.images)
    for (const subject of image.subjects)
      if (!castIds.has(subject))
        throw new Error(
          `${image.file} names an unknown subject: ${subject}`,
        );
  for (const member of header.cast) {
    if (member.modelSheet !== undefined) {
      if (!(await fileExists(root, member.modelSheet)))
        throw new Error(
          `cast member ${member.id} names a missing model sheet: ${member.modelSheet}`,
        );
    } else if (!member.needsModelSheet)
      throw new Error(
        `cast member ${member.id} has no model sheet; add one or flag needsModelSheet`,
      );
  }
  return { root, header, screenplay, screenplayHash, references };
}

// --- shot lists ----------------------------------------------------------------

export interface FlatShot extends Shot {
  sceneId: string;
}

export function flattenShots(shotlist: Shotlist): FlatShot[] {
  return shotlist.scenes.flatMap((scene) =>
    scene.shots.map((shot) => ({ ...shot, sceneId: scene.id })),
  );
}

export const shotDuration = (shot: Shot): number => shot.span[1] - shot.span[0];

/**
 * Structural shot-list validation: unique ids, a contiguous non-overlapping
 * tiling of [0, duration], resolvable characters, and well-formed chains.
 */
export function validateShotlistSemantics(
  header: MsbHeader,
  screenplay: Screenplay,
  shotlist: Shotlist,
): void {
  const duration = screenplay.screenplay.duration;
  const shots = flattenShots(shotlist);
  if (shots.length === 0) throw new Error("shot list contains no shots");
  const castIds = new Set(header.cast.map((member) => member.id));
  const seen = new Map<string, number>();
  let cursor = 0;
  for (const [index, shot] of shots.entries()) {
    if (seen.has(shot.id)) throw new Error(`duplicate shot id: ${shot.id}`);
    seen.set(shot.id, index);
    if (shot.span[1] <= shot.span[0])
      throw new Error(`shot ${shot.id} span end must follow its start`);
    if (shot.span[0] !== cursor)
      throw new Error(
        `shot list does not tile the timeline: shot ${shot.id} starts at ${shot.span[0]}s but the previous shot ended at ${cursor}s`,
      );
    cursor = shot.span[1];
    for (const characterId of shot.characters)
      if (!castIds.has(characterId))
        throw new Error(
          `shot ${shot.id} references unknown cast member: ${characterId}`,
        );
    if (shot.location !== undefined && !castIds.has(shot.location))
      throw new Error(
        `shot ${shot.id} references unknown location: ${shot.location}`,
      );
    const chainFrom = shot.chainFrom ?? undefined;
    if (chainFrom !== undefined) {
      if (chainFrom === shot.id)
        throw new Error(`shot ${shot.id} cannot chain from itself`);
      const predecessorIndex = seen.get(chainFrom);
      if (predecessorIndex === undefined)
        throw new Error(
          `shot ${shot.id} must chain from an earlier shot: ${chainFrom}`,
        );
      if (!shot.references.composition)
        throw new Error(
          `shot ${shot.id} chains from another shot but has no references.composition to verify against`,
        );
    }
  }
  if (cursor !== duration)
    throw new Error(
      `shot list does not cover the timeline: shots end at ${cursor}s but the screenplay declares ${duration}s`,
    );
}

export async function listShotlists(root: string): Promise<string[]> {
  return (await listFiles(root, "shotlists"))
    .filter((name) => /^\d{3}\.json$/.test(name))
    .map((name) => name.slice(0, 3));
}

export async function latestShotlistId(
  root: string,
): Promise<string | undefined> {
  return (await listShotlists(root)).at(-1);
}

export async function loadShotlist(
  root: string,
  shotlistId: string,
): Promise<{ shotlist: Shotlist; shotlistHash: string }> {
  const relative = `shotlists/${shotlistId}.json`;
  const { raw, value } = await readProjectJson(root, relative);
  const shotlist = shotlistSchema.parse(value);
  if (shotlist.shotlist.id !== shotlistId)
    throw new Error(
      `${relative} declares mismatched shot list id: ${shotlist.shotlist.id}`,
    );
  return { shotlist, shotlistHash: hash(raw) };
}

// --- ledgers ---------------------------------------------------------------------

export interface ShootRecord {
  file: string;
  shoot: Shoot;
}

export async function listShoots(root: string): Promise<ShootRecord[]> {
  const records: ShootRecord[] = [];
  for (const name of await listFiles(root, "shoots")) {
    if (!/^\d{4}-[a-z0-9][a-z0-9.-]*\.json$/.test(name)) continue;
    const { value } = await readProjectJson(root, `shoots/${name}`);
    const shoot = shootSchema.parse(value);
    if (`${shoot.shoot.id}.json` !== name)
      throw new Error(`shoots/${name} declares mismatched id: ${shoot.shoot.id}`);
    records.push({ file: `shoots/${name}`, shoot });
  }
  return records;
}

export interface DailiesRecord {
  file: string;
  dailies: Dailies;
}

export async function listDailies(root: string): Promise<DailiesRecord[]> {
  const records: DailiesRecord[] = [];
  for (const name of await listFiles(root, "dailies")) {
    if (!/^\d{4}\.json$/.test(name)) continue;
    const { value } = await readProjectJson(root, `dailies/${name}`);
    const dailies = dailiesSchema.parse(value);
    if (`${dailies.dailies.id}.json` !== name)
      throw new Error(
        `dailies/${name} declares mismatched id: ${dailies.dailies.id}`,
      );
    records.push({ file: `dailies/${name}`, dailies });
  }
  return records;
}

export type TakeStanding = "circled" | "rejected" | "unreviewed";

/** A take's current standing is its latest verdict across all dailies. */
export function takeStandings(
  dailies: DailiesRecord[],
): Map<string, "circled" | "rejected"> {
  const standings = new Map<string, "circled" | "rejected">();
  for (const record of dailies)
    for (const verdict of record.dailies.verdicts)
      standings.set(verdict.take, verdict.verdict);
  return standings;
}

export function parseTakeId(takeId: string): { shot: string; number: number } {
  const match = takeIdPattern.exec(takeId);
  if (!match) throw new Error(`not a take id: ${takeId}`);
  return { shot: match[1]!, number: Number(match[2]!) };
}

export const takeFileName = (shot: string, number: number): string =>
  `${shot}.t${String(number).padStart(2, "0")}`;

export interface PoolTake {
  take: string;
  shot: string;
  number: number;
  media?: string;
  lastFrame?: string;
  notes?: string;
}

/** Scans the flat takes/ pool by filename convention. */
export async function scanTakePool(root: string): Promise<PoolTake[]> {
  const byTake = new Map<string, PoolTake>();
  for (const name of await listFiles(root, "takes")) {
    const match = /^(.+\.t\d{2,})\.(mp4|last\.png|notes\.md)$/.exec(name);
    if (!match) continue;
    const takeId = match[1]!;
    let parsed: { shot: string; number: number };
    try {
      parsed = parseTakeId(takeId);
    } catch {
      continue;
    }
    const take =
      byTake.get(takeId) ??
      ({ take: takeId, shot: parsed.shot, number: parsed.number } as PoolTake);
    if (match[2] === "mp4") take.media = `takes/${name}`;
    else if (match[2] === "last.png") take.lastFrame = `takes/${name}`;
    else take.notes = `takes/${name}`;
    byTake.set(takeId, take);
  }
  return [...byTake.values()].sort((a, b) =>
    a.take.localeCompare(b.take),
  );
}

/**
 * Take numbers are per-shot monotonic across all shoots: the allocator seeds
 * from both the pool (files) and the ledger (recorded takes), so a gc'd
 * take's number is never reissued.
 */
export async function takeNumberSeed(
  root: string,
  shoots: ShootRecord[],
): Promise<Map<string, number>> {
  const seed = new Map<string, number>();
  const bump = (takeId: string) => {
    try {
      const { shot, number } = parseTakeId(takeId);
      seed.set(shot, Math.max(seed.get(shot) ?? 0, number));
    } catch {
      // ignore foreign files
    }
  };
  for (const pool of await scanTakePool(root)) bump(pool.take);
  for (const record of shoots)
    for (const take of record.shoot.takes) bump(take.take);
  return seed;
}

// --- latest and the cut rule -----------------------------------------------------

export interface LedgerTake {
  take: string;
  shot: string;
  number: number;
  status: "rendered" | "failed";
  mediaHash?: string;
  media?: string;
  shootId: string;
}

/** Every take the shoot ledger knows about, in creation order. */
export function ledgerTakes(shoots: ShootRecord[]): LedgerTake[] {
  const takes: LedgerTake[] = [];
  for (const record of shoots)
    for (const take of record.shoot.takes) {
      const { shot, number } = parseTakeId(take.take);
      takes.push({
        take: take.take,
        shot,
        number,
        status: take.status,
        ...(take.mediaHash !== undefined ? { mediaHash: take.mediaHash } : {}),
        ...(take.media !== undefined ? { media: take.media } : {}),
        shootId: record.shoot.shoot.id,
      });
    }
  return takes;
}

/**
 * The cut rule: the circled take if one exists, else the newest rendered,
 * never-rejected take. Returns undefined when no eligible take exists.
 */
export function currentTake(
  shotId: string,
  shoots: ShootRecord[],
  standings: Map<string, "circled" | "rejected">,
): LedgerTake | undefined {
  const rendered = ledgerTakes(shoots).filter(
    (take) => take.shot === shotId && take.status === "rendered",
  );
  const circled = rendered
    .filter((take) => standings.get(take.take) === "circled")
    .sort((a, b) => b.number - a.number);
  if (circled[0]) return circled[0];
  return rendered
    .filter((take) => standings.get(take.take) !== "rejected")
    .sort((a, b) => b.number - a.number)[0];
}

export async function latestCompleteShoot(
  root: string,
  shoots?: ShootRecord[],
): Promise<ShootRecord | undefined> {
  const records = shoots ?? (await listShoots(root));
  return records.filter((record) => record.shoot.shoot.status === "complete").at(-1);
}

export interface LatestReport {
  shotlist?: string;
  shoot?: string;
  current: Array<{ shot: string; take?: string; standing: TakeStanding }>;
}

/** Everything `msb latest` prints, computed from folder contents alone. */
export async function computeLatest(root: string): Promise<LatestReport> {
  const shotlistId = await latestShotlistId(root);
  const shoots = await listShoots(root);
  const standings = takeStandings(await listDailies(root));
  const complete = await latestCompleteShoot(root, shoots);
  const current: LatestReport["current"] = [];
  if (shotlistId !== undefined) {
    const { shotlist } = await loadShotlist(root, shotlistId);
    for (const shot of flattenShots(shotlist)) {
      const take = currentTake(shot.id, shoots, standings);
      current.push({
        shot: shot.id,
        ...(take !== undefined ? { take: take.take } : {}),
        standing:
          take !== undefined
            ? ((standings.get(take.take) ?? "unreviewed") as TakeStanding)
            : "unreviewed",
      });
    }
  }
  return {
    ...(shotlistId !== undefined ? { shotlist: shotlistId } : {}),
    ...(complete !== undefined ? { shoot: complete.shoot.shoot.id } : {}),
    current,
  };
}

// --- ordinal allocation ------------------------------------------------------------

export async function nextOrdinal(
  root: string,
  directory: "shoots" | "dailies" | "shotlists",
): Promise<string> {
  const width = directory === "shotlists" ? 3 : 4;
  let highest = 0;
  for (const name of await listFiles(root, directory)) {
    const match = /^(\d+)[.-]/.exec(name) ?? /^(\d+)\.json$/.exec(name);
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  return String(highest + 1).padStart(width, "0");
}

// --- cues within a shot span --------------------------------------------------------

export interface TimedLine {
  kind: "dialogue" | "narration";
  character?: string;
  delivery?: string;
  text: string;
  /** Relative to the shot's start, clipped to the shot span. */
  start: number;
  end: number;
}

/**
 * Dialogue lives in the screenplay and only there: a shot picks up whatever
 * span cues start inside its [start, end) span, clipped and re-based to the
 * shot's own clock.
 */
export function cuesInSpan(
  screenplay: Screenplay,
  span: [number, number],
): TimedLine[] {
  const lines: TimedLine[] = [];
  for (const cue of allCues(screenplay)) {
    if (cue.span === undefined) continue;
    if (cue.span[0] < span[0] || cue.span[0] >= span[1]) continue;
    lines.push({
      kind: cue.kind as "dialogue" | "narration",
      ...(cue.character !== undefined ? { character: cue.character } : {}),
      ...(cue.delivery !== undefined ? { delivery: cue.delivery } : {}),
      text: cue.text,
      start: cue.span[0] - span[0],
      end: Math.min(cue.span[1], span[1]) - span[0],
    });
  }
  return lines.sort((a, b) => a.start - b.start);
}
