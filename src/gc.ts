import { rm } from "node:fs/promises";
import {
  latestCompleteShoot,
  ledgerTakes,
  listDailies,
  listShoots,
  resolveInside,
  scanTakePool,
  takeStandings,
} from "./project.js";

export interface GcReport {
  /** Pool media (`takes/*.mp4`) that is (or would be) deleted. */
  reclaimed: string[];
  /** Pool media retained, with the rule that kept it. */
  kept: Array<{ media: string; reason: string }>;
  dryRun: boolean;
}

/**
 * Opt-in, rule-bound garbage collection: deletes take media (`.mp4`) only —
 * never ledger JSON, notes, or last frames. A take's media is reclaimable
 * exactly when the take is rejected, or is none of: circled, the newest
 * take of its shot, or linked (reused or new) by the latest complete shoot.
 */
export async function collectGarbage(
  root: string,
  options: { dryRun?: boolean } = {},
): Promise<GcReport> {
  const dryRun = options.dryRun ?? false;
  const shoots = await listShoots(root);
  const standings = takeStandings(await listDailies(root));
  const pool = await scanTakePool(root);
  const newestByShot = new Map<string, number>();
  for (const take of [...pool, ...ledgerTakes(shoots)])
    newestByShot.set(
      take.shot,
      Math.max(newestByShot.get(take.shot) ?? 0, take.number),
    );
  const latest = await latestCompleteShoot(root, shoots);
  const linkedByLatest = new Set<string>([
    ...(latest?.shoot.reused.map((reuse) => reuse.take) ?? []),
    ...(latest?.shoot.takes
      .filter((take) => take.status === "rendered")
      .map((take) => take.take) ?? []),
  ]);

  const report: GcReport = { reclaimed: [], kept: [], dryRun };
  for (const take of pool) {
    if (take.media === undefined) continue;
    const standing = standings.get(take.take);
    let keep: string | undefined;
    if (standing === "rejected") keep = undefined;
    else if (standing === "circled") keep = "circled";
    else if (take.number === newestByShot.get(take.shot))
      keep = "newest take of its shot";
    else if (linkedByLatest.has(take.take))
      keep = "linked by the latest complete shoot";
    if (keep !== undefined) {
      report.kept.push({ media: take.media, reason: keep });
      continue;
    }
    report.reclaimed.push(take.media);
    if (!dryRun) await rm(resolveInside(root, take.media), { force: true });
  }
  return report;
}
