import { mkdir, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  atomicJson,
  atomicWrite,
  ledgerTakes,
  listDailies,
  listShoots,
  nextOrdinal,
  parseTakeId,
  resolveInside,
  takeStandings,
  toJson,
  type LedgerTake,
} from "./project.js";
import {
  dailiesSchema,
  type Dailies,
  type Observation,
  type ObservationSubject,
} from "./schema.js";

export interface UnreviewedTake extends LedgerTake {
  standing: "unreviewed";
}

/** Takes the shoot ledger knows about that no dailies session has judged. */
export async function listUnreviewed(root: string): Promise<LedgerTake[]> {
  const shoots = await listShoots(root);
  const standings = takeStandings(await listDailies(root));
  return ledgerTakes(shoots).filter(
    (take) => take.status === "rendered" && !standings.has(take.take),
  );
}

export interface ObservationOptions {
  /** Subject: at most one of take, cut, or animatic; none = session-scoped. */
  take?: string | undefined;
  cut?: string | undefined;
  animatic?: boolean | undefined;
  /** Seconds on the screenplay timeline; cut and animatic subjects only. */
  span?: [number, number] | undefined;
  /** Verdicts are legal on take and animatic subjects only. */
  verdict?: "circled" | "rejected" | undefined;
  /** The observation itself, inline. */
  text?: string | undefined;
  /**
   * Optional file whose contents become the observation's notes document:
   * takes/<take>.notes.md for a take subject, dailies/<session>/notes.md
   * otherwise.
   */
  notesFile?: string | undefined;
  /** Files copied verbatim into dailies/<session>/ as review evidence. */
  attach?: string[] | undefined;
  by?: string | undefined;
}

export interface ObservationResult {
  file: string;
  dailies: Dailies;
  notes?: string;
  attachments?: string[];
}

async function projectFileExists(
  root: string,
  relative: string,
): Promise<boolean> {
  return stat(resolveInside(root, relative)).then(
    (stats) => stats.isFile(),
    () => false,
  );
}

/**
 * Append one review session to the dailies ledger: an observation about a
 * take, a cut, the animatic, or the session itself, optionally carrying a
 * verdict. Attachments (screenshots, marked-up frames) are copied into the
 * session's asset directory, dailies/<ordinal>/, so review evidence lives
 * in the folder rather than dying with a chat transcript.
 */
export async function appendObservation(
  root: string,
  options: ObservationOptions,
): Promise<ObservationResult> {
  const named = [
    options.take !== undefined,
    options.cut !== undefined,
    options.animatic === true,
  ].filter(Boolean).length;
  if (named > 1)
    throw new Error(
      "an observation has at most one subject: a take, a cut, or the animatic",
    );

  let subject: ObservationSubject | undefined;
  if (options.take !== undefined) {
    if (options.span !== undefined)
      throw new Error("span applies to cut and animatic subjects only");
    const { shot } = parseTakeId(options.take);
    const known = ledgerTakes(await listShoots(root)).find(
      (take) => take.take === options.take,
    );
    if (!known)
      throw new Error(`no shoot records take ${options.take} (shot ${shot})`);
    if (options.verdict === "circled" && known.status !== "rendered")
      throw new Error(`cannot circle a failed take: ${options.take}`);
    subject = { take: options.take };
  } else if (options.cut !== undefined) {
    if (options.verdict !== undefined)
      throw new Error(
        "verdicts apply to takes and the animatic; record cut findings as verdict-less observations",
      );
    if (!(await projectFileExists(root, `cuts/${options.cut}.mp4`)))
      throw new Error(`no such cut: cuts/${options.cut}.mp4`);
    subject = {
      cut: options.cut,
      ...(options.span !== undefined ? { span: options.span } : {}),
    };
  } else if (options.animatic === true) {
    if (!(await projectFileExists(root, "cuts/animatic.mp4")))
      throw new Error("no animatic to review; run msb animatic first");
    subject = {
      animatic: true,
      ...(options.span !== undefined ? { span: options.span } : {}),
    };
  } else {
    if (options.verdict !== undefined)
      throw new Error("a verdict needs a take or animatic subject");
    if (options.span !== undefined)
      throw new Error("span applies to cut and animatic subjects only");
  }

  await mkdir(resolveInside(root, "dailies"), { recursive: true });
  const ordinal = await nextOrdinal(root, "dailies");
  const sessionDir = `dailies/${ordinal}`;

  let notes: string | undefined;
  if (options.notesFile !== undefined) {
    const contents = await readFile(options.notesFile, "utf8");
    notes =
      options.take !== undefined
        ? `takes/${options.take}.notes.md`
        : `${sessionDir}/notes.md`;
    await mkdir(path.dirname(resolveInside(root, notes)), { recursive: true });
    await atomicWrite(resolveInside(root, notes), contents);
  }

  let attachments: string[] | undefined;
  if (options.attach !== undefined && options.attach.length > 0) {
    await mkdir(resolveInside(root, sessionDir), { recursive: true });
    attachments = [];
    for (const source of options.attach) {
      const name = path.basename(source);
      const destination = `${sessionDir}/${name}`;
      if (attachments.includes(destination))
        throw new Error(`duplicate attachment name: ${name}`);
      await atomicWrite(
        resolveInside(root, destination),
        await readFile(source),
      );
      attachments.push(destination);
    }
  }

  const observation: Observation = {
    ...(subject !== undefined ? { subject } : {}),
    ...(options.verdict !== undefined ? { verdict: options.verdict } : {}),
    ...(options.text !== undefined ? { text: options.text } : {}),
    ...(notes !== undefined ? { notes } : {}),
    ...(attachments !== undefined ? { attachments } : {}),
  };
  const dailies: Dailies = dailiesSchema.parse({
    formatVersion: "2.0.0",
    dailies: {
      id: ordinal,
      at: new Date().toISOString(),
      by: options.by ?? os.userInfo().username,
    },
    observations: [observation],
  });
  const file = `dailies/${ordinal}.json`;
  await atomicJson(resolveInside(root, file), dailies);
  return {
    file,
    dailies,
    ...(notes !== undefined ? { notes } : {}),
    ...(attachments !== undefined ? { attachments } : {}),
  };
}

export interface VerdictOptions {
  verdict: "circled" | "rejected";
  /** Optional file whose contents become takes/<take>.notes.md. */
  notesFile?: string;
  attach?: string[];
  by?: string;
}

/**
 * Append a verdict on a take — sugar for an observation carrying a verdict.
 * A take's current standing is always the latest verdict across all
 * dailies, so re-judging a take is just another appended session — nothing
 * is ever rewritten.
 */
export async function appendVerdict(
  root: string,
  takeId: string,
  options: VerdictOptions,
): Promise<ObservationResult> {
  return appendObservation(root, {
    take: takeId,
    verdict: options.verdict,
    notesFile: options.notesFile,
    attach: options.attach,
    by: options.by,
  });
}

export interface SessionObservation extends Observation {
  session: string;
  at: string;
  by: string;
}

/** Every observation across all dailies sessions, oldest session first. */
export async function listObservations(
  root: string,
): Promise<SessionObservation[]> {
  const records = await listDailies(root);
  return records.flatMap((record) =>
    record.dailies.observations.map((observation) => ({
      ...observation,
      session: record.dailies.dailies.id,
      at: record.dailies.dailies.at,
      by: record.dailies.dailies.by,
    })),
  );
}

/** Human-readable one-line label for an observation's subject. */
export function describeSubject(subject?: ObservationSubject): string {
  if (subject === undefined) return "session";
  if ("take" in subject) return `take ${subject.take}`;
  const span =
    subject.span !== undefined
      ? ` @ ${subject.span[0]}-${subject.span[1]}s`
      : "";
  return "cut" in subject ? `cut ${subject.cut}${span}` : `animatic${span}`;
}

export { toJson };
