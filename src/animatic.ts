import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execa } from "execa";
import ffmpegStatic from "ffmpeg-static";
import {
  allCues,
  cueEnd,
  cueStart,
  ingestProject,
  resolveInside,
} from "./project.js";
import type { Cue, ReferenceImage } from "./schema.js";

const wrap = (value: string, width = 52): string[] => {
  const words = value.split(/\s+/);
  const lines: string[] = [];
  for (const word of words) {
    const last = lines.at(-1);
    if (!last || last.length + word.length + 1 > width) lines.push(word);
    else lines[lines.length - 1] = `${last} ${word}`;
  }
  return lines;
};

const srtTimestamp = (seconds: number): string => {
  const milliseconds = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const secs = Math.floor((milliseconds % 60_000) / 1000);
  const millis = milliseconds % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")},${String(millis).padStart(3, "0")}`;
};

const ACTION_CUE_DISPLAY_SECONDS = 3;

function cueText(cue: Cue): string {
  if (cue.kind === "action") return `[${cue.text}]`;
  const speaker =
    cue.kind === "narration"
      ? "NARRATOR"
      : (cue.character ?? "ensemble").toUpperCase();
  const delivery = cue.delivery ? ` (${cue.delivery})` : "";
  return `${speaker}${delivery}: ${cue.text}`;
}

interface Segment {
  start: number;
  end: number;
  board?: ReferenceImage;
}

/**
 * The animatic is a cut assembled from the canonical screenplay's timed cues
 * and the time-anchored boards — zero provider requests, regenerable at any
 * time, and available before any shot list exists. Each stretch of the
 * timeline shows the most recent board at or before it, with the cues that
 * fall inside rendered as subtitles.
 */
export async function createAnimatic(
  root: string,
  options: { out?: string } = {},
): Promise<string> {
  const ffmpeg = ffmpegStatic as unknown as string | null;
  if (!ffmpeg) throw new Error("bundled ffmpeg is unavailable");
  const project = await ingestProject(root);
  const duration = project.screenplay.screenplay.duration;
  const boards = project.references.images
    .filter((image) => image.kind === "board" && image.anchor !== undefined)
    .sort((a, b) => a.anchor!.at - b.anchor!.at);

  const boundaries = [
    ...new Set(
      [
        0,
        ...boards
          .map((board) => board.anchor!.at)
          .filter((at) => at < duration),
        duration,
      ].sort((a, b) => a - b),
    ),
  ];
  const segments: Segment[] = [];
  for (let index = 0; index < boundaries.length - 1; index++) {
    const start = boundaries[index]!;
    const end = boundaries[index + 1]!;
    const board = [...boards]
      .reverse()
      .find((candidate) => candidate.anchor!.at <= start);
    segments.push({ start, end, ...(board !== undefined ? { board } : {}) });
  }
  if (segments.length === 0)
    throw new Error("screenplay has no duration to assemble");

  const cues = allCues(project.screenplay);
  const outputFile = options.out
    ? path.resolve(options.out)
    : resolveInside(root, "cuts/animatic.mp4");
  await mkdir(path.dirname(outputFile), { recursive: true });
  const work = await mkdtemp(path.join(tmpdir(), "msb-animatic-"));
  try {
    const clips: string[] = [];
    for (const [index, segment] of segments.entries()) {
      const segmentDuration = segment.end - segment.start;
      const events = cues
        .map((cue) => {
          const start = cueStart(cue);
          const end =
            cue.kind === "action"
              ? Math.min(start + ACTION_CUE_DISPLAY_SECONDS, duration)
              : cueEnd(cue);
          return { cue, start, end };
        })
        .filter(
          (event) => event.start < segment.end && event.end > segment.start,
        )
        .map((event) => ({
          text: cueText(event.cue),
          start: Math.max(event.start, segment.start) - segment.start,
          end: Math.min(event.end, segment.end) - segment.start,
        }));
      const srtFile = path.join(work, `segment-${index}.srt`);
      const srt = events
        .map(
          (event, eventIndex) =>
            `${eventIndex + 1}\n${srtTimestamp(event.start)} --> ${srtTimestamp(event.end)}\n${wrap(event.text).join("\n")}\n`,
        )
        .join("\n");
      await writeFile(
        srtFile,
        srt ||
          `1\n${srtTimestamp(0)} --> ${srtTimestamp(segmentDuration)}\n \n`,
      );
      const inputArgs = segment.board
        ? ["-loop", "1", "-i", resolveInside(root, segment.board.file)]
        : ["-f", "lavfi", "-i", "color=c=0x202a3c:s=1280x720"];
      const clip = path.join(work, `segment-${index}.mp4`);
      await execa(ffmpeg, [
        "-y",
        ...inputArgs,
        "-f",
        "lavfi",
        "-i",
        `anullsrc=r=48000:cl=stereo:d=${segmentDuration}`,
        "-t",
        String(segmentDuration),
        "-vf",
        `scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=0x111827,subtitles='${srtFile.replaceAll("'", "'\\''")}':force_style='FontName=DejaVu Sans,FontSize=18,PrimaryColour=&H00FFFFFF,Outline=1,Shadow=0,Alignment=2,MarginV=28'`,
        "-r",
        "24",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-map_metadata",
        "-1",
        "-shortest",
        clip,
      ]);
      clips.push(clip);
    }
    const list = path.join(work, "concat.txt");
    await writeFile(
      list,
      clips
        .map((clip) => `file '${clip.replaceAll("'", "'\\''")}'`)
        .join("\n") + "\n",
    );
    await execa(ffmpeg, [
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      list,
      "-c",
      "copy",
      "-map_metadata",
      "-1",
      outputFile,
    ]);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
  return outputFile;
}
