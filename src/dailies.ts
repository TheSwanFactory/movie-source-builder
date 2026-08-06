import { mkdir, readFile } from "node:fs/promises";
import os from "node:os";
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
import { dailiesSchema, type Dailies } from "./schema.js";

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

export interface VerdictOptions {
  verdict: "circled" | "rejected";
  /** Optional file whose contents become takes/<take>.notes.md. */
  notesFile?: string;
  by?: string;
}

/**
 * Append one review session to the dailies ledger. A take's current
 * standing is always the latest verdict across all dailies, so re-judging a
 * take is just another appended session — nothing is ever rewritten.
 */
export async function appendVerdict(
  root: string,
  takeId: string,
  options: VerdictOptions,
): Promise<{ file: string; dailies: Dailies; notes?: string }> {
  const { shot } = parseTakeId(takeId);
  const shoots = await listShoots(root);
  const known = ledgerTakes(shoots).find((take) => take.take === takeId);
  if (!known)
    throw new Error(`no shoot records take ${takeId} (shot ${shot})`);
  if (options.verdict === "circled" && known.status !== "rendered")
    throw new Error(`cannot circle a failed take: ${takeId}`);
  let notes: string | undefined;
  if (options.notesFile !== undefined) {
    const contents = await readFile(options.notesFile, "utf8");
    notes = `takes/${takeId}.notes.md`;
    await atomicWrite(resolveInside(root, notes), contents);
  }
  await mkdir(resolveInside(root, "dailies"), { recursive: true });
  const ordinal = await nextOrdinal(root, "dailies");
  const dailies: Dailies = dailiesSchema.parse({
    formatVersion: "2.0.0",
    dailies: {
      id: ordinal,
      at: new Date().toISOString(),
      by: options.by ?? os.userInfo().username,
    },
    verdicts: [
      {
        take: takeId,
        verdict: options.verdict,
        ...(notes !== undefined ? { notes } : {}),
      },
    ],
  });
  const file = `dailies/${ordinal}.json`;
  await atomicJson(resolveInside(root, file), dailies);
  return { file, dailies, ...(notes !== undefined ? { notes } : {}) };
}

export { toJson };
